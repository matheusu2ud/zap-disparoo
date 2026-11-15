"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type CampaignActionState = {
  error?: string;
  success?: string;
};

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  return { supabase, user };
}

export async function createCampaign(
  _previousState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const name = getValue(formData, "name");
  const messageBodyValue = formData.get("message_body");
  const messageBody =
    typeof messageBodyValue === "string" ? messageBodyValue.trim() : "";
  const connectionId = getValue(formData, "connection_id");
  const mediaFileId = getValue(formData, "media_file_id");
  const recipientValues = formData.getAll("contact_ids");
  const recipientIds = recipientValues.filter(
    (value): value is string => typeof value === "string" && isUuid(value),
  );

  if (name.length < 1 || name.length > 200) {
    return { error: "O nome deve ter entre 1 e 200 caracteres." };
  }
  if (messageBody.length < 1 || messageBody.length > 5000) {
    return { error: "A mensagem deve ter entre 1 e 5.000 caracteres." };
  }
  if (recipientValues.length !== recipientIds.length) {
    return { error: "A lista de contatos selecionados é inválida." };
  }
  const uniqueRecipientIds = [...new Set(recipientIds)];
  if (uniqueRecipientIds.length > 500) {
    return { error: "Cada campanha aceita até 500 contatos autorizados." };
  }
  if (connectionId && !isUuid(connectionId)) {
    return { error: "Selecione uma conexão válida." };
  }
  if (mediaFileId && !isUuid(mediaFileId)) {
    return { error: "Selecione um arquivo de mídia válido." };
  }

  const { supabase, user } = await getAuthenticatedClient();
  if (connectionId) {
    const { data: connection, error } = await supabase
      .from("whatsapp_connections")
      .select("id, status")
      .eq("id", connectionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (error) return { error: "Não foi possível validar a conexão selecionada." };
    if (!connection) return { error: "Conexão não encontrada ou sem permissão." };
    if (connection.status !== "connected") {
      return { error: "A conexão selecionada precisa estar conectada para agendar." };
    }
  }

  if (mediaFileId) {
    const { data: media, error } = await supabase
      .from("media_files")
      .select("id")
      .eq("id", mediaFileId)
      .eq("user_id", user.id)
      .maybeSingle();
    if (error) return { error: "Não foi possível validar a mídia selecionada." };
    if (!media) return { error: "Arquivo de mídia não encontrado ou sem permissão." };
  }

  let contacts: { id: string; phone: string }[] = [];
  if (uniqueRecipientIds.length > 0) {
    const { data, error } = await supabase
      .from("contacts")
      .select("id, phone")
      .eq("user_id", user.id)
      .eq("consent_status", "opted_in")
      .not("consented_at", "is", null)
      .is("opted_out_at", null)
      .in("id", uniqueRecipientIds);

    if (error) return { error: "Não foi possível validar o consentimento dos contatos." };
    contacts = data ?? [];
    if (contacts.length !== uniqueRecipientIds.length) {
      return {
        error:
          "Um ou mais contatos não têm consentimento ativo. Atualize a seleção antes de salvar.",
      };
    }
  }

  const { data: campaign, error: campaignError } = await supabase
    .from("campaigns")
    .insert({
      user_id: user.id,
      name,
      message_body: messageBody,
      connection_id: connectionId || null,
      media_file_id: mediaFileId || null,
      status: "draft",
    })
    .select("id")
    .single();

  if (campaignError || !campaign) {
    return {
      error: campaignError
        ? `Não foi possível criar a campanha: ${campaignError.message}`
        : "Não foi possível confirmar a criação da campanha.",
    };
  }

  if (contacts.length > 0) {
    const { error: recipientError } = await supabase
      .from("campaign_recipients")
      .insert(
        contacts.map((contact) => ({
          user_id: user.id,
          campaign_id: campaign.id,
          contact_id: contact.id,
          phone_snapshot: contact.phone,
          status: "queued",
        })),
      );

    if (recipientError) {
      const { error: cleanupError } = await supabase
        .from("campaigns")
        .delete()
        .eq("id", campaign.id)
        .eq("user_id", user.id);
      return {
        error: cleanupError
          ? `A campanha foi criada, mas a fila não pôde ser salva e a campanha não pôde ser removida: ${recipientError.message}`
          : `Não foi possível adicionar os contatos à fila: ${recipientError.message}`,
      };
    }
  }

  revalidatePath("/campaigns");
  revalidatePath("/painel");
  return {
    success:
      contacts.length > 0
        ? `Rascunho criado com ${contacts.length} contato(s) autorizado(s) na fila. Nenhuma mensagem foi enviada.`
        : "Rascunho criado. Nenhum contato foi adicionado à fila.",
  };
}

export async function scheduleCampaign(
  _previousState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const campaignId = getValue(formData, "campaign_id");
  if (!isUuid(campaignId)) return { error: "Identificador de campanha inválido." };

  const localSchedule = getValue(formData, "scheduled_at");
  let scheduledAt: string | null = null;
  if (localSchedule) {
    const rawOffset = Number(getValue(formData, "timezone_offset"));
    if (!Number.isInteger(rawOffset) || Math.abs(rawOffset) > 14 * 60) {
      return { error: "Fuso horário do agendamento inválido." };
    }
    const sign = rawOffset > 0 ? "-" : "+";
    const hours = String(Math.floor(Math.abs(rawOffset) / 60)).padStart(2, "0");
    const minutes = String(Math.abs(rawOffset) % 60).padStart(2, "0");
    const parsedDate = new Date(
      `${localSchedule}:00${sign}${hours}:${minutes}`,
    );
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
      return { error: "O agendamento deve ser em uma data e horário futuros." };
    }
    scheduledAt = parsedDate.toISOString();
  }

  const { supabase } = await getAuthenticatedClient();
  const { error } = await supabase.rpc("schedule_campaign", {
    p_campaign_id: campaignId,
    p_scheduled_at: scheduledAt,
  });

  if (error) {
    const message = error.message;
    if (message.includes("campaign_recipients_consent_changed")) {
      return { error: "A autorização de um contato mudou. Revise a lista da campanha." };
    }
    if (message.includes("campaign_connection_not_connected")) {
      return { error: "Conecte um WhatsApp antes de agendar a campanha." };
    }
    if (message.includes("campaign_empty_queue")) {
      return { error: "Adicione ao menos um contato autorizado antes de agendar." };
    }
    if (message.includes("campaign_not_editable")) {
      return { error: "Somente rascunhos podem ser agendados." };
    }
    return { error: `Não foi possível agendar: ${message}` };
  }

  revalidatePath("/campaigns");
  revalidatePath("/painel");
  return {
    success:
      scheduledAt === null
        ? "Campanha adicionada à fila para processamento."
        : "Campanha agendada. O envio depende do processador de filas.",
  };
}

export async function cancelCampaign(
  _previousState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const campaignId = getValue(formData, "campaign_id");
  if (!isUuid(campaignId)) return { error: "Identificador de campanha inválido." };

  const { supabase } = await getAuthenticatedClient();
  const { error } = await supabase.rpc("cancel_campaign", {
    p_campaign_id: campaignId,
  });

  if (error) {
    return {
      error: error.message.includes("campaign_not_cancelable")
        ? "Esta campanha não pode mais ser cancelada."
        : `Não foi possível cancelar: ${error.message}`,
    };
  }

  revalidatePath("/campaigns");
  revalidatePath("/painel");
  return { success: "Campanha cancelada." };
}

export async function deleteDraftCampaign(
  _previousState: CampaignActionState,
  formData: FormData,
): Promise<CampaignActionState> {
  const campaignId = getValue(formData, "campaign_id");
  if (!isUuid(campaignId)) return { error: "Identificador de campanha inválido." };

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("campaigns")
    .delete()
    .eq("id", campaignId)
    .eq("user_id", user.id)
    .eq("status", "draft")
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: `Não foi possível excluir o rascunho: ${error.message}` };
  }
  if (!data) return { error: "Rascunho não encontrado ou não pode ser excluído." };

  revalidatePath("/campaigns");
  return { success: "Rascunho excluído." };
}
