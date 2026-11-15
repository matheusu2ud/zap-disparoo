"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  signIn,
  signUp,
  updatePassword,
  type AuthActionState,
} from "./actions";

type AuthMode = "login" | "signup" | "recovery" | "reset";
type AuthAction = (
  state: AuthActionState,
  formData: FormData,
) => Promise<AuthActionState>;

const actions: Record<AuthMode, AuthAction> = {
  login: signIn,
  signup: signUp,
  recovery: requestPasswordReset,
  reset: updatePassword,
};

const copy: Record<
  AuthMode,
  { title: string; description: string; button: string }
> = {
  login: {
    title: "Boas-vindas de volta",
    description: "Entre na sua conta para continuar.",
    button: "Entrar na minha conta",
  },
  signup: {
    title: "Crie sua conta",
    description: "Comece a organizar suas campanhas em um só lugar.",
    button: "Criar conta",
  },
  recovery: {
    title: "Recuperar senha",
    description: "Enviaremos um link para o e-mail associado à sua conta.",
    button: "Enviar link de recuperação",
  },
  reset: {
    title: "Definir nova senha",
    description: "Escolha uma senha segura com pelo menos 8 caracteres.",
    button: "Salvar nova senha",
  },
};

function SubmitButton({
  children,
  pending,
}: {
  children: string;
  pending: boolean;
}) {
  return (
    <button className="auth-submit" type="submit" disabled={pending}>
      {children}
      <span aria-hidden="true">→</span>
    </button>
  );
}

export function AuthForm({
  mode,
  nextPath,
  selectedPlanId,
}: {
  mode: AuthMode;
  nextPath?: string;
  selectedPlanId?: string;
}) {
  const [state, formAction, pending] = useActionState(actions[mode], {});
  const text = copy[mode];

  return (
    <form className="auth-form" action={formAction}>
      {mode === "signup" && (
        <label className="auth-field">
          <span>Nome completo</span>
          <input
            autoComplete="name"
            name="name"
            placeholder="Como podemos te chamar?"
            required
            minLength={2}
          />
        </label>
      )}

      {mode === "signup" && (
        <label className="auth-field">
          <span>CPF</span>
          <input
            autoComplete="off"
            inputMode="numeric"
            name="cpf"
            placeholder="000.000.000-00"
            required
            minLength={11}
            maxLength={14}
          />
        </label>
      )}

      {(mode === "login" || mode === "signup" || mode === "recovery") && (
        <label className="auth-field">
          <span>E-mail</span>
          <input
            autoComplete="email"
            name="email"
            type="email"
            placeholder="voce@empresa.com"
            required
          />
        </label>
      )}

      {(mode === "login" || mode === "signup" || mode === "reset") && (
        <label className="auth-field">
          <span>{mode === "login" ? "Senha" : "Nova senha"}</span>
          <input
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            name="password"
            type="password"
            placeholder="Mínimo de 8 caracteres"
            required
            minLength={8}
          />
        </label>
      )}

      {(mode === "signup" || mode === "reset") && (
        <label className="auth-field">
          <span>Confirme a senha</span>
          <input
            autoComplete="new-password"
            name="confirmPassword"
            type="password"
            placeholder="Digite a senha novamente"
            required
            minLength={8}
          />
        </label>
      )}

      {mode === "login" && nextPath && (
        <input type="hidden" name="next" value={nextPath} />
      )}
      {mode === "signup" && selectedPlanId && (
        <input type="hidden" name="selected_plan_id" value={selectedPlanId} />
      )}

      {state.error && (
        <p className="auth-message auth-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="auth-message auth-success" role="status">
          {state.success}
        </p>
      )}

      <SubmitButton pending={pending}>
        {pending ? "Aguarde..." : text.button}
      </SubmitButton>
      <p className="auth-submit-pending" aria-live="polite">
        {pending ? "Processando sua solicitação..." : ""}
      </p>
    </form>
  );
}

export function AuthFooter({
  mode,
  selectedPlanId,
}: {
  mode: AuthMode;
  selectedPlanId?: string;
}) {
  if (mode === "login") {
    return (
      <div className="auth-links">
        <Link href="/recuperar-senha">Esqueci minha senha</Link>
        <span>
          Ainda não tem conta? <Link href="/planos">Ver planos</Link>
        </span>
      </div>
    );
  }

  if (mode === "signup") {
    return (
      <p className="auth-bottom-link">
        Já tem uma conta?{" "}
        <Link
          href={
            selectedPlanId
              ? `/login?next=${encodeURIComponent(`/billing?plan=${selectedPlanId}`)}`
              : "/login"
          }
        >
          Entrar
        </Link>
      </p>
    );
  }

  if (mode === "recovery") {
    return (
      <p className="auth-bottom-link">
        Lembrou a senha? <Link href="/login">Voltar para o login</Link>
      </p>
    );
  }

  return (
    <p className="auth-bottom-link">
      <Link href="/login">Voltar para o login</Link>
    </p>
  );
}
