"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type TemplateActionState = {
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

function parseTemplate(formData: FormData) {
  const name = getValue(formData, "name");
  const category = getValue(formData, "category") || "general";
  const bodyValue = formData.get("body");
  const body = typeof bodyValue === "string" ? bodyValue : "";

  if (name.length < 1 || name.length > 160) {
    return { error: "O nome deve ter entre 1 e 160 caracteres." } as const;
  }
  if (category.length > 80) {
    return { error: "A categoria deve ter até 80 caracteres." } as const;
  }
  if (body.length > 5000) {
    return { error: "O conteúdo deve ter até 5.000 caracteres." } as const;
  }

  return { values: { name, category, body } } as const;
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

export async function createTemplate(
  _previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const parsed = parseTemplate(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { supabase, user } = await getAuthenticatedClient();
  const { error } = await supabase.from("message_templates").insert({
    user_id: user.id,
    ...parsed.values,
  });

  if (error) {
    return {
      error:
        error.code === "42501"
          ? "Você não tem permissão para criar templates."
          : `Não foi possível salvar o template: ${error.message}`,
    };
  }

  revalidatePath("/templates");
  return { success: "Template criado." };
}

export async function updateTemplate(
  _previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const id = getValue(formData, "id");
  if (!isUuid(id)) return { error: "Identificador de template inválido." };

  const parsed = parseTemplate(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("message_templates")
    .update(parsed.values)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return {
      error: `Não foi possível atualizar o template: ${error.message}`,
    };
  }
  if (!data) return { error: "Template não encontrado ou sem permissão." };

  revalidatePath("/templates");
  return { success: "Template atualizado." };
}

export async function deleteTemplate(
  _previousState: TemplateActionState,
  formData: FormData,
): Promise<TemplateActionState> {
  const id = getValue(formData, "id");
  if (!isUuid(id)) return { error: "Identificador de template inválido." };

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("message_templates")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { error: `Não foi possível excluir o template: ${error.message}` };
  }
  if (!data) return { error: "Template não encontrado ou sem permissão." };

  revalidatePath("/templates");
  return { success: "Template excluído." };
}
