"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AdminActionState = {
  error?: string;
  success?: string;
};

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getBoolean(formData: FormData, key: string) {
  return formData.get(key) === "true";
}

function getInteger(formData: FormData, key: string, maximum = Number.MAX_SAFE_INTEGER) {
  const raw = getValue(formData, key);
  if (!/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value <= maximum ? value : null;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

async function getAdminClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) throw new Error("Não foi possível verificar suas permissões.");
  if (!profile?.is_active || profile.role !== "admin") {
    return { supabase, user, isAdmin: false };
  }
  return { supabase, user, isAdmin: true };
}

function parsePlan(formData: FormData) {
  const name = getValue(formData, "name");
  const description = getValue(formData, "description");
  const currency = getValue(formData, "currency").toUpperCase();
  const priceValue = getValue(formData, "price");
  const price = Number(priceValue);
  const messagesLimit = getInteger(formData, "messages_limit");
  const campaignsLimit = getInteger(formData, "campaigns_limit");
  const contactsLimit = getInteger(formData, "contacts_limit");
  const connectionsLimit = getInteger(formData, "connections_limit", 2_147_483_647);
  const storageLimit = getInteger(formData, "storage_limit");
  const sortOrder = getInteger(formData, "sort_order", 2_147_483_647);

  if (name.length < 1 || name.length > 100) {
    return { error: "O nome do plano deve ter entre 1 e 100 caracteres." } as const;
  }
  if (description.length > 1000) {
    return { error: "A descrição pode ter no máximo 1.000 caracteres." } as const;
  }
  if (!/^[A-Z]{3}$/.test(currency)) {
    return { error: "Informe uma moeda ISO de três letras, como BRL." } as const;
  }
  if (!Number.isFinite(price) || price < 0 || price > 1_000_000_000) {
    return { error: "Informe um preço válido, entre zero e 1 bilhão." } as const;
  }
  if (
    messagesLimit === null ||
    campaignsLimit === null ||
    contactsLimit === null ||
    connectionsLimit === null ||
    storageLimit === null ||
    sortOrder === null
  ) {
    return { error: "Limites e ordem devem ser números inteiros não negativos." } as const;
  }

  return {
    values: {
      name,
      description,
      currency,
      price: Math.round(price * 100) / 100,
      messages_limit: messagesLimit,
      campaigns_limit: campaignsLimit,
      contacts_limit: contactsLimit,
      connections_limit: connectionsLimit,
      monthly_credits: messagesLimit,
      max_devices: connectionsLimit,
      storage_limit: storageLimit,
      unlimited_messages: getBoolean(formData, "unlimited_messages"),
      unlimited_campaigns: getBoolean(formData, "unlimited_campaigns"),
      unlimited_contacts: getBoolean(formData, "unlimited_contacts"),
      unlimited_connections: getBoolean(formData, "unlimited_connections"),
      is_active: getBoolean(formData, "is_active"),
      active: getBoolean(formData, "is_active"),
      sort_order: sortOrder,
    },
  } as const;
}

export async function savePlan(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const parsed = parsePlan(formData);
  if ("error" in parsed) return { error: parsed.error };

  const id = getValue(formData, "id");
  if (id && !isUuid(id)) return { error: "Identificador de plano inválido." };

  const { supabase, isAdmin } = await getAdminClient();
  if (!isAdmin) return { error: "Apenas administradores podem gerenciar planos." };

  if (id) {
    const { data, error } = await supabase
      .from("plans")
      .update(parsed.values)
      .eq("id", id)
      .select("id")
      .maybeSingle();

    if (error) {
      return {
        error:
          error.code === "23505"
            ? "Já existe um plano com esse nome."
            : `Não foi possível salvar o plano: ${error.message}`,
      };
    }
    if (!data) return { error: "Plano não encontrado ou sem permissão." };
  } else {
    const { error } = await supabase.from("plans").insert(parsed.values);
    if (error) {
      return {
        error:
          error.code === "23505"
            ? "Já existe um plano com esse nome."
            : `Não foi possível salvar o plano: ${error.message}`,
      };
    }
  }

  revalidatePath("/admin");
  revalidatePath("/campaigns");
  revalidatePath("/connections");
  revalidatePath("/painel");
  return { success: id ? "Plano atualizado." : "Plano criado." };
}

export async function setUserActive(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = getValue(formData, "user_id");
  if (!isUuid(userId)) return { error: "Identificador de usuário inválido." };

  const { supabase, user, isAdmin } = await getAdminClient();
  if (!isAdmin) return { error: "Apenas administradores podem alterar contas." };
  if (userId === user.id) {
    return { error: "Não é possível alterar o status da própria conta nesta tela." };
  }

  const { data, error } = await supabase
    .from("profiles")
    .update({ is_active: getBoolean(formData, "is_active") })
    .eq("id", userId)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: `Não foi possível atualizar a conta: ${error.message}` };
  }
  if (!data) return { error: "Usuário não encontrado ou sem permissão." };

  revalidatePath("/admin");
  return { success: "Status da conta atualizado." };
}

export async function assignSubscription(
  _previousState: AdminActionState,
  formData: FormData,
): Promise<AdminActionState> {
  const userId = getValue(formData, "user_id");
  const planId = getValue(formData, "plan_id");
  const endsAtValue = getValue(formData, "ends_at");

  if (!isUuid(userId) || !isUuid(planId)) {
    return { error: "Selecione um usuário e um plano válidos." };
  }

  let endsAt: string | null = null;
  if (endsAtValue) {
    const parsedDate = new Date(endsAtValue);
    if (!Number.isFinite(parsedDate.getTime()) || parsedDate.getTime() <= Date.now()) {
      return { error: "A validade deve ser uma data futura." };
    }
    endsAt = parsedDate.toISOString();
  }

  const { supabase, isAdmin } = await getAdminClient();
  if (!isAdmin) {
    return { error: "Apenas administradores podem atribuir planos." };
  }

  const { error } = await supabase.rpc("admin_assign_subscription", {
    p_user_id: userId,
    p_plan_id: planId,
    p_ends_at: endsAt,
  });

  if (error) {
    return {
      error: error.message.includes("admin_active_plan_required")
        ? "O plano selecionado não está ativo."
        : error.message.includes("admin_user_not_found")
          ? "Usuário não encontrado."
          : `Não foi possível atribuir o plano: ${error.message}`,
    };
  }

  revalidatePath("/admin");
  revalidatePath("/connections");
  revalidatePath("/campaigns");
  revalidatePath("/painel");
  return { success: "Assinatura atribuída. A assinatura anterior foi encerrada." };
}
