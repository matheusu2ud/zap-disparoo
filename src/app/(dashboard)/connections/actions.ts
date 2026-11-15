"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createEvolutionInstance, connectEvolutionInstance, deleteEvolutionInstance, getEvolutionConnectionState, logoutEvolutionInstance } from "@/lib/evolution";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type ConnectionActionState = {
  error?: string;
  success?: string;
  qrCode?: string;
  status?: string;
};

type OwnedConnection = {
  id: string;
  label: string;
  provider_instance_id: string | null;
  provider_instance_name: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  phone_number: string | null;
  connected_at: string | null;
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

async function getAuthenticatedContext() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) {
    throw new Error("Não foi possível verificar a sessão.");
  }
  if (!user) redirect("/login");

  return { supabase, user };
}

async function getOwnedConnection(id: string): Promise<{
  supabase: Awaited<ReturnType<typeof createClient>>;
  userId: string;
  connection: OwnedConnection;
}> {
  if (!isUuid(id)) throw new Error("Identificador de conexão inválido.");

  const { supabase, user } = await getAuthenticatedContext();
  const { data, error } = await supabase
    .from("whatsapp_connections")
    .select(
      "id, label, provider_instance_id, provider_instance_name, status, phone_number, connected_at",
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(
      "Não foi possível carregar a conexão. Verifique se as migrations foram aplicadas.",
    );
  }
  if (!data) throw new Error("Conexão não encontrada ou sem permissão.");

  return {
    supabase,
    userId: user.id,
    connection: data as OwnedConnection,
  };
}

function mapCreateError(message: string) {
  if (message.includes("active_plan_required")) {
    return "É necessário ter um plano ativo antes de criar conexões.";
  }
  if (message.includes("connection_limit_reached")) {
    return "O limite de conexões do seu plano foi atingido.";
  }
  if (message.includes("account_inactive")) {
    return "Esta conta está desativada.";
  }
  if (message.includes("invalid_connection_label")) {
    return "Informe um nome de conexão válido (1 a 100 caracteres).";
  }
  return "Não foi possível reservar a conexão. Confira o plano e as migrations do banco.";
}

function providerError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "A Evolution API não concluiu a operação.";
}

async function updateConnection(
  userId: string,
  id: string,
  update: Record<string, unknown>,
) {
  const admin = createAdminClient();
  const { error } = await admin
    .from("whatsapp_connections")
    .update(update)
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      "A Evolution API respondeu, mas não foi possível salvar o status da conexão.",
    );
  }
}

export async function createConnection(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const label = getValue(formData, "label");
  if (label.length < 1 || label.length > 100) {
    return { error: "O nome deve ter entre 1 e 100 caracteres." };
  }

  const { supabase, user } = await getAuthenticatedContext();
  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return { error: providerError(error) };
  }

  const { data, error: reserveError } = await supabase.rpc(
    "reserve_whatsapp_connection",
    { p_label: label },
  );

  if (reserveError || !data?.[0]) {
    return {
      error: mapCreateError(reserveError?.message ?? "reservation_failed"),
    };
  }

  const reservation = data[0] as {
    id: string;
    provider_instance_name: string;
  };
  let createdRemotely = false;

  try {
    const instance = await createEvolutionInstance(
      reservation.provider_instance_name,
    );
    createdRemotely = true;

    const { error: updateError } = await admin
      .from("whatsapp_connections")
      .update({
        provider_instance_id: instance.instanceId,
        status: "connecting",
      })
      .eq("id", reservation.id)
      .eq("user_id", user.id);

    if (updateError) {
      await deleteEvolutionInstance(reservation.provider_instance_name);
      createdRemotely = false;
      throw new Error(
        "A instância foi criada, mas não foi possível associá-la à conta. A instância remota foi removida.",
      );
    }

    revalidatePath("/connections");
    revalidatePath("/painel");
    return {
      success: instance.qrCode
        ? "Instância criada. Escaneie o QR Code com o WhatsApp."
        : "Instância criada. Use Gerar QR Code para iniciar a conexão.",
      qrCode: instance.qrCode ?? undefined,
      status: "connecting",
    };
  } catch (error) {
    if (!createdRemotely) {
      const { error: cleanupError } = await admin
        .from("whatsapp_connections")
        .delete()
        .eq("id", reservation.id)
        .eq("user_id", user.id);

      if (cleanupError) {
        return {
          error: `${providerError(error)} A reserva local também não pôde ser removida; contate o suporte.`,
        };
      }
    }

    return { error: providerError(error) };
  }
}

export async function generateConnectionQr(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const id = getValue(formData, "id");
  let context: Awaited<ReturnType<typeof getOwnedConnection>>;

  try {
    context = await getOwnedConnection(id);
  } catch (error) {
    return { error: providerError(error) };
  }

  if (!context.connection.provider_instance_name) {
    return { error: "Esta conexão não possui uma instância Evolution associada." };
  }

  try {
    const qrCode = await connectEvolutionInstance(
      context.connection.provider_instance_name,
    );
    await updateConnection(context.userId, id, { status: "connecting" });
    revalidatePath("/connections");
    return qrCode
      ? {
          success: "QR Code atualizado. Escaneie-o com o WhatsApp.",
          qrCode,
          status: "connecting",
        }
      : {
          error: "A Evolution API não retornou um QR Code válido. Tente novamente.",
        };
  } catch (error) {
    return { error: providerError(error) };
  }
}

export async function refreshConnectionStatus(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const id = getValue(formData, "id");
  let context: Awaited<ReturnType<typeof getOwnedConnection>>;

  try {
    context = await getOwnedConnection(id);
  } catch (error) {
    return { error: providerError(error) };
  }

  if (!context.connection.provider_instance_name) {
    return { error: "Esta conexão não possui uma instância Evolution associada." };
  }

  try {
    const result = await getEvolutionConnectionState(
      context.connection.provider_instance_name,
    );
    await updateConnection(context.userId, id, {
      status: result.status,
      phone_number: result.phoneNumber,
      connected_at:
        result.status === "connected"
          ? context.connection.connected_at ?? new Date().toISOString()
          : null,
      last_seen_at: new Date().toISOString(),
    });
    revalidatePath("/connections");
    revalidatePath("/painel");
    return {
      success:
        result.status === "connected"
          ? "WhatsApp conectado."
          : `Status atualizado: ${result.status}.`,
      status: result.status,
    };
  } catch (error) {
    return { error: providerError(error) };
  }
}

export async function disconnectConnection(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const id = getValue(formData, "id");
  let context: Awaited<ReturnType<typeof getOwnedConnection>>;

  try {
    context = await getOwnedConnection(id);
  } catch (error) {
    return { error: providerError(error) };
  }
  if (!context.connection.provider_instance_name) {
    return { error: "Esta conexão não possui uma instância Evolution associada." };
  }

  try {
    await logoutEvolutionInstance(context.connection.provider_instance_name);
    await updateConnection(context.userId, id, {
      status: "disconnected",
      phone_number: null,
      connected_at: null,
      last_seen_at: new Date().toISOString(),
    });
    revalidatePath("/connections");
    revalidatePath("/painel");
    return { success: "WhatsApp desconectado.", status: "disconnected" };
  } catch (error) {
    return { error: providerError(error) };
  }
}

export async function deleteConnection(
  _previousState: ConnectionActionState,
  formData: FormData,
): Promise<ConnectionActionState> {
  const id = getValue(formData, "id");
  let context: Awaited<ReturnType<typeof getOwnedConnection>>;

  try {
    context = await getOwnedConnection(id);
  } catch (error) {
    return { error: providerError(error) };
  }

  let admin: ReturnType<typeof createAdminClient>;
  try {
    admin = createAdminClient();
  } catch (error) {
    return { error: providerError(error) };
  }
  if (context.connection.provider_instance_name) {
    try {
      await deleteEvolutionInstance(context.connection.provider_instance_name);
    } catch (error) {
      return {
        error: `A instância remota não foi removida; a conexão foi mantida. ${providerError(error)}`,
      };
    }
  }

  const { error } = await admin
    .from("whatsapp_connections")
    .delete()
    .eq("id", id)
    .eq("user_id", context.userId);

  if (error) {
    return {
      error:
        "A instância remota foi removida, mas o registro local não pôde ser excluído. Atualize o status e contate o suporte.",
    };
  }

  revalidatePath("/connections");
  revalidatePath("/painel");
  return { success: "Conexão excluída." };
}
