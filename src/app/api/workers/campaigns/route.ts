import { NextResponse, type NextRequest } from "next/server";
import { sendEvolutionMessage } from "@/lib/evolution";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  constantTimeSecretMatches,
  mapSupportedMediaType,
  normalizeWhatsAppNumber,
} from "@/lib/campaign-worker-utils";

type ClaimedRecipient = {
  outcome: "claimed" | "skipped";
  recipient_id: string;
  attempt_token: string | null;
  campaign_id: string;
  user_id: string;
  provider_instance_name: string | null;
  phone_number: string | null;
  message_body: string | null;
  media_storage_path: string | null;
  media_content_type: string | null;
  media_file_name: string | null;
};

function isAuthorized(request: NextRequest, expectedSecret: string) {
  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return match ? constantTimeSecretMatches(match[1], expectedSecret) : false;
}

async function finalizeRecipient(
  admin: ReturnType<typeof createAdminClient>,
  job: ClaimedRecipient,
  result: {
    status: "sent" | "failed" | "skipped";
    messageId?: string | null;
    errorCode?: string;
    errorMessage?: string;
  },
) {
  if (!job.attempt_token) {
    throw new Error("A tentativa reivindicada não possui token.");
  }
  const { data, error } = await admin.rpc("finish_campaign_recipient", {
    p_recipient_id: job.recipient_id,
    p_attempt_token: job.attempt_token,
    p_status: result.status,
    p_provider_message_id: result.messageId ?? null,
    p_error_code: result.errorCode ?? null,
    p_error_message: result.errorMessage ?? null,
  });

  if (error || data !== true) {
    throw new Error(
      "Não foi possível registrar o resultado da tentativa. Ela não será reenviada automaticamente.",
    );
  }
}

export async function POST(request: NextRequest) {
  const secret = process.env.CAMPAIGN_WORKER_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    return NextResponse.json(
      { error: "Worker de campanhas exige segredo de pelo menos 32 bytes." },
      { status: 503 },
    );
  }
  if (process.env.CAMPAIGN_SEND_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Envios estão desativados. Configure CAMPAIGN_SEND_ENABLED=true." },
      { status: 503 },
    );
  }
  if (!isAuthorized(request, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Worker de campanhas sem acesso ao banco." },
      { status: 503 },
    );
  }

  const { data, error: claimError } = await admin.rpc(
    "claim_campaign_recipient",
  );
  if (claimError) {
    return NextResponse.json(
      { error: "Não foi possível reivindicar um item da fila." },
      { status: 500 },
    );
  }

  const job = (data?.[0] ?? null) as ClaimedRecipient | null;
  if (!job) return NextResponse.json({ processed: false, outcome: "idle" });
  if (job.outcome === "skipped") {
    return NextResponse.json({ processed: true, outcome: "skipped" });
  }

  const [profileResult, connectionResult, contactResult] = await Promise.all([
    admin
      .from("profiles")
      .select("is_active")
      .eq("id", job.user_id)
      .maybeSingle(),
    admin
      .from("whatsapp_connections")
      .select("status")
      .eq("user_id", job.user_id)
      .eq("provider_instance_name", job.provider_instance_name ?? "")
      .maybeSingle(),
    admin
      .from("contacts")
      .select("id")
      .eq("user_id", job.user_id)
      .eq("phone", job.phone_number ?? "")
      .eq("consent_status", "opted_in")
      .not("consented_at", "is", null)
      .is("opted_out_at", null)
      .maybeSingle(),
  ]);

  if (
    profileResult.error ||
    !profileResult.data?.is_active ||
    contactResult.error ||
    !contactResult.data
  ) {
    try {
      await finalizeRecipient(admin, job, {
        status: "skipped",
        errorCode: "consent_or_account_changed",
        errorMessage:
          "Conta inativa ou consentimento do contato deixou de ser válido antes do envio.",
      });
    } catch {
      return NextResponse.json(
        { error: "Não foi possível registrar o item bloqueado." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      processed: true,
      outcome: "skipped",
      reason: "consent_or_account_changed",
    });
  }

  if (
    connectionResult.error ||
    connectionResult.data?.status !== "connected" ||
    !job.provider_instance_name
  ) {
    try {
      await finalizeRecipient(admin, job, {
        status: "skipped",
        errorCode: "connection_unavailable",
        errorMessage: "A conexão WhatsApp não está disponível antes do envio.",
      });
    } catch {
      return NextResponse.json(
        { error: "Não foi possível registrar o item sem conexão." },
        { status: 500 },
      );
    }
    return NextResponse.json({
      processed: true,
      outcome: "skipped",
      reason: "connection_unavailable",
    });
  }

  const phoneNumber = normalizeWhatsAppNumber(job.phone_number ?? "");
  if (!phoneNumber || !job.message_body) {
    try {
      await finalizeRecipient(admin, job, {
        status: "failed",
        errorCode: "invalid_campaign_payload",
        errorMessage: "Telefone ou conteúdo da campanha inválido.",
      });
    } catch {
      return NextResponse.json(
        { error: "Não foi possível registrar a mensagem inválida." },
        { status: 500 },
      );
    }
    return NextResponse.json({ processed: true, outcome: "failed" });
  }

  let outboundMedia:
    | { media: string; mimeType: string; fileName: string }
    | undefined;
  if (job.media_storage_path) {
    const mimeType = job.media_content_type ?? "";
    if (!mapSupportedMediaType(mimeType)) {
      try {
        await finalizeRecipient(admin, job, {
          status: "failed",
          errorCode: "unsupported_media_type",
          errorMessage: "O arquivo de mídia não tem um tipo permitido para envio.",
        });
      } catch {
        return NextResponse.json(
          { error: "Não foi possível registrar a mídia inválida." },
          { status: 500 },
        );
      }
      return NextResponse.json({ processed: true, outcome: "failed" });
    }

    const { data: signedFile, error: signedUrlError } = await admin.storage
      .from("broadcast-media")
      .createSignedUrl(job.media_storage_path, 300);
    if (signedUrlError || !signedFile?.signedUrl) {
      try {
        await finalizeRecipient(admin, job, {
          status: "failed",
          errorCode: "media_unavailable",
          errorMessage: "Não foi possível preparar a mídia privada para envio.",
        });
      } catch {
        return NextResponse.json(
          { error: "Não foi possível registrar a mídia indisponível." },
          { status: 500 },
        );
      }
      return NextResponse.json({ processed: true, outcome: "failed" });
    }

    outboundMedia = {
      media: signedFile.signedUrl,
      mimeType,
      fileName: job.media_file_name ?? "arquivo",
    };
  }

  try {
    const result = await sendEvolutionMessage(
      job.provider_instance_name,
      phoneNumber,
      job.message_body,
      outboundMedia,
    );
    await finalizeRecipient(admin, job, {
      status: "sent",
      messageId: result.messageId,
    });
    return NextResponse.json({ processed: true, outcome: "sent" });
  } catch (error) {
    try {
      await finalizeRecipient(admin, job, {
        status: "failed",
        errorCode: "provider_send_failed",
        errorMessage:
          error instanceof Error
            ? error.message
            : "O resultado do provedor não pôde ser confirmado.",
      });
    } catch {
      return NextResponse.json(
        {
          error:
            "O provedor pode ter recebido a mensagem, mas o resultado não pôde ser registrado. Reenvio automático bloqueado.",
        },
        { status: 500 },
      );
    }
    return NextResponse.json({ processed: true, outcome: "failed" });
  }
}
