"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { normalizeBrazilianCpf } from "@/lib/poseidonpay-utils";

export type AuthActionState = {
  error?: string;
  success?: string;
};

function getText(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getPassword(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

function validEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function missingConfiguration(): AuthActionState | null {
  if (getSupabaseConfig()) {
    return null;
  }

  return {
    error:
      "Configure o Supabase antes de continuar. Copie .env.example para .env.local e informe a URL do projeto e a chave anon/public.",
  };
}

async function getSiteUrl() {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto") ?? "http";

  if (!host) {
    throw new Error("Não foi possível determinar o endereço deste site.");
  }

  return `${protocol}://${host}`;
}

export async function signIn(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const configError = missingConfiguration();
  if (configError) return configError;

  const email = getText(formData, "email");
  const password = getPassword(formData, "password");

  if (!validEmail(email) || !password) {
    return { error: "Informe um e-mail válido e sua senha." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return { error: "E-mail ou senha inválidos. Confira os dados e tente novamente." };
  }

  const requestedNext = getText(formData, "next");
  const destination =
    requestedNext.startsWith("/") &&
    !requestedNext.startsWith("//") &&
    requestedNext !== "/"
      ? requestedNext
      : "/planos";
  redirect(destination);
}

export async function signUp(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const configError = missingConfiguration();
  if (configError) return configError;

  const name = getText(formData, "name");
  const rawCpf = getText(formData, "cpf");
  const email = getText(formData, "email");
  const password = getPassword(formData, "password");
  const confirmPassword = getPassword(formData, "confirmPassword");
  const selectedPlanId = getText(formData, "selected_plan_id");

  if (name.length < 2) {
    return { error: "Informe seu nome (pelo menos 2 caracteres)." };
  }

  const normalizedCpf = normalizeBrazilianCpf(rawCpf);
  if (normalizedCpf.error || !normalizedCpf.cpf) {
    return { error: normalizedCpf.error ?? "Informe um CPF válido." };
  }

  if (!validEmail(email)) {
    return { error: "Informe um endereço de e-mail válido." };
  }

  if (password.length < 8) {
    return { error: "A senha deve ter pelo menos 8 caracteres." };
  }

  if (password !== confirmPassword) {
    return { error: "As senhas não conferem." };
  }

  const supabase = await createClient();
  if (
    selectedPlanId &&
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      selectedPlanId,
    )
  ) {
    return { error: "O plano escolhido não é válido. Volte à página de planos." };
  }

  if (selectedPlanId) {
    const { data: plan, error: planError } = await supabase
      .from("plans")
      .select("id")
      .eq("id", selectedPlanId)
      .eq("is_active", true)
      .eq("currency", "BRL")
      .like("name", "BROADCAST HUB - %")
      .maybeSingle();

    if (planError || !plan) {
      return {
        error:
          "O plano escolhido não está mais disponível. Volte à página de planos e selecione outro.",
      };
    }
  }

  const siteUrl = await getSiteUrl();
  const nextPath = selectedPlanId
    ? `/billing?plan=${encodeURIComponent(selectedPlanId)}`
    : "/billing";
  const callbackUrl = new URL("/auth/callback", siteUrl);
  callbackUrl.searchParams.set("next", nextPath);
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        full_name: name,
        cpf: normalizedCpf.cpf,
        ...(selectedPlanId ? { selected_plan_id: selectedPlanId } : {}),
      },
      emailRedirectTo: callbackUrl.toString(),
    },
  });

  if (error) {
    return { error: "Não foi possível criar a conta. Verifique os dados e tente novamente." };
  }

  if (data.session) {
    redirect(nextPath);
  }

  return {
    success:
      "Cadastro recebido. Confira seu e-mail para ativar a conta e continuar com o plano escolhido.",
  };
}

export async function requestPasswordReset(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const configError = missingConfiguration();
  if (configError) return configError;

  const email = getText(formData, "email");
  if (!validEmail(email)) {
    return { error: "Informe um endereço de e-mail válido." };
  }

  const siteUrl = await getSiteUrl();
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${siteUrl}/auth/callback?next=/redefinir-senha`,
  });

  if (error) {
    return { error: "Não foi possível solicitar a recuperação. Tente novamente." };
  }

  return {
    success:
      "Se houver uma conta com esse e-mail, enviaremos as instruções para redefinir a senha.",
  };
}

export async function updatePassword(
  _previousState: AuthActionState,
  formData: FormData,
): Promise<AuthActionState> {
  const configError = missingConfiguration();
  if (configError) return configError;

  const password = getPassword(formData, "password");
  const confirmPassword = getPassword(formData, "confirmPassword");

  if (password.length < 8) {
    return { error: "A senha deve ter pelo menos 8 caracteres." };
  }

  if (password !== confirmPassword) {
    return { error: "As senhas não conferem." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });

  if (error) {
    return { error: "Não foi possível atualizar a senha. Solicite um novo link de recuperação." };
  }

  redirect("/planos");
}

export async function signOut() {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut();

  if (error) {
    throw new Error("Não foi possível encerrar sua sessão. Tente novamente.");
  }

  redirect("/login");
}
