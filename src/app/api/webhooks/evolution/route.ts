import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  mapEvolutionWebhookState,
  type EvolutionConnectionState,
} from "@/lib/evolution";
import { createAdminClient } from "@/lib/supabase/admin";

const maxBodyBytes = 32 * 1024;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function matchesSecret(request: NextRequest, expectedSecret: string) {
  const provided =
    request.headers.get("x-evolution-secret") ??
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!provided) return false;

  const expected = Buffer.from(expectedSecret);
  const actual = Buffer.from(provided);
  return (
    expected.length === actual.length && timingSafeEqual(expected, actual)
  );
}

async function readBoundedBody(request: NextRequest) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > maxBodyBytes) return null;

  const reader = request.body?.getReader();
  if (!reader) return null;

  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function getWebhookValues(payload: unknown) {
  if (!isRecord(payload)) return null;
  const data = isRecord(payload.data) ? payload.data : {};
  const instance =
    typeof payload.instance === "string"
      ? payload.instance
      : typeof data.instance === "string"
        ? data.instance
        : "";
  const state =
    mapEvolutionWebhookState(data.state) ??
    mapEvolutionWebhookState(payload.state);
  const owner =
    typeof data.owner === "string"
      ? data.owner.replace(/@.*/, "")
      : null;

  return instance && state ? { instance, state, owner } : null;
}

export async function POST(request: NextRequest) {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    return NextResponse.json(
      { error: "Webhook Evolution exige um segredo de pelo menos 32 bytes." },
      { status: 503 },
    );
  }
  if (!matchesSecret(request, secret)) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  let rawBody: string | null;
  try {
    rawBody = await readBoundedBody(request);
  } catch {
    return NextResponse.json(
      { error: "Não foi possível ler o corpo do webhook." },
      { status: 400 },
    );
  }
  if (rawBody === null) {
    return NextResponse.json(
      { error: "Corpo do webhook ausente ou maior que 32 KB." },
      { status: 413 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "JSON inválido." }, { status: 400 });
  }
  const values = getWebhookValues(payload);
  if (!values) {
    return NextResponse.json({ received: true, ignored: true });
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json(
      { error: "Webhook Evolution sem acesso ao banco." },
      { status: 503 },
    );
  }
  const { data: connection, error: lookupError } = await admin
    .from("whatsapp_connections")
    .select("id, user_id, status, connected_at")
    .eq("provider_instance_name", values.instance)
    .maybeSingle();

  if (lookupError) {
    return NextResponse.json(
      { error: "Não foi possível localizar a conexão." },
      { status: 500 },
    );
  }
  if (!connection) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const update: {
    status: EvolutionConnectionState;
    last_seen_at: string;
    phone_number?: string | null;
    connected_at?: string | null;
  } = {
    status: values.state,
    last_seen_at: new Date().toISOString(),
  };
  if (values.state === "connected") {
    if (values.owner) update.phone_number = values.owner;
    update.connected_at = connection.connected_at ?? new Date().toISOString();
  } else {
    update.phone_number = null;
    update.connected_at = null;
  }

  const { error: updateError } = await admin
    .from("whatsapp_connections")
    .update(update)
    .eq("id", connection.id)
    .eq("user_id", connection.user_id);

  if (updateError) {
    return NextResponse.json(
      { error: "Não foi possível atualizar o status da conexão." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
