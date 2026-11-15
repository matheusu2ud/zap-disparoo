import Link from "next/link";
import { Radio, ShieldCheck, Sparkles } from "lucide-react";
import { AuthFooter, AuthForm } from "./auth-form";
import { getSupabaseConfig } from "@/lib/supabase/config";

type AuthMode = "login" | "signup" | "recovery" | "reset";

const modes: Record<
  AuthMode,
  { eyebrow: string; title: string; description: string }
> = {
  login: {
    eyebrow: "SUA CENTRAL DE COMUNICAÇÃO",
    title: "Campanhas com mais clareza. Conversas com mais propósito.",
    description:
      "Gerencie seus contatos e acompanhe suas campanhas em um painel organizado.",
  },
  signup: {
    eyebrow: "COMECE POR AQUI",
    title: "Um espaço organizado para suas campanhas.",
    description:
      "Crie sua conta para preparar seu espaço de trabalho no ZapFlow.",
  },
  recovery: {
    eyebrow: "ACESSO SEGURO",
    title: "Recupere o acesso à sua conta.",
    description:
      "Vamos ajudar você a voltar ao seu espaço com segurança.",
  },
  reset: {
    eyebrow: "ACESSO SEGURO",
    title: "Escolha uma nova senha.",
    description:
      "Atualize sua senha para voltar ao seu espaço de trabalho.",
  },
};

export function AuthShell({
  mode,
  nextPath,
  selectedPlanId,
  authError,
  accountDisabled,
}: {
  mode: AuthMode;
  nextPath?: string;
  selectedPlanId?: string;
  authError?: boolean;
  accountDisabled?: boolean;
}) {
  const content = modes[mode];
  const supabaseConfigured = Boolean(getSupabaseConfig());
  const formHeading =
    mode === "login"
      ? "Boas-vindas de volta"
      : mode === "signup"
        ? "Crie sua conta"
        : mode === "recovery"
          ? "Recuperar senha"
          : "Definir nova senha";

  return (
    <main className="auth-page">
      <section className="auth-showcase">
        <Link className="auth-brand" href="/" aria-label="ZapFlow">
          <span className="brand-mark">
            <Radio size={21} strokeWidth={2.2} />
          </span>
          <span className="brand-name">
            Zap<span>Flow</span>
          </span>
        </Link>

        <div className="auth-showcase-copy">
          <span className="auth-eyebrow">
            <Sparkles size={14} />
            {content.eyebrow}
          </span>
          <h1>{content.title}</h1>
          <p>{content.description}</p>
          <div className="auth-visual" aria-hidden="true">
            <div className="auth-visual-grid" />
            <div className="auth-visual-orbit auth-orbit-a" />
            <div className="auth-visual-orbit auth-orbit-b" />
            <div className="auth-visual-core">
              <Radio size={36} strokeWidth={1.5} />
            </div>
            <span className="auth-visual-pill pill-top">
              <span /> Seu espaço, em um só lugar
            </span>
            <span className="auth-visual-pill pill-bottom">
              <ShieldCheck size={14} /> Acesso protegido
            </span>
          </div>
        </div>

        <p className="auth-showcase-footer">
          Comunicação organizada, com responsabilidade.
        </p>
      </section>

      <section className="auth-panel">
        <div className="auth-form-wrap">
          <div className="auth-mobile-brand">
            <span className="brand-mark">
              <Radio size={20} strokeWidth={2.2} />
            </span>
            <span className="brand-name">
              Zap<span>Flow</span>
            </span>
          </div>
          <span className="auth-form-eyebrow">ZapFlow</span>
          <h2>{formHeading}</h2>
          <p className="auth-form-description">
            {mode === "login"
              ? "Acesse seu painel com seus dados de cadastro."
              : mode === "signup"
                ? "Preencha os dados para criar seu acesso."
                : mode === "recovery"
                  ? "Informe seu e-mail e enviaremos as instruções."
                  : "Informe e confirme sua nova senha."}
          </p>
          {!supabaseConfigured && (
            <p className="auth-message auth-setup" role="status">
              Para ativar o acesso, configure{" "}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> e{" "}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> no arquivo{" "}
              <code>.env.local</code>. Veja o <code>.env.example</code>.
            </p>
          )}
          {authError && (
            <p className="auth-message auth-error" role="alert">
              O link de acesso expirou ou não é válido. Solicite um novo e tente
              novamente.
            </p>
          )}
          {accountDisabled && (
            <p className="auth-message auth-error" role="alert">
              Esta conta está desativada. Fale com a equipe responsável pelo
              serviço para obter ajuda.
            </p>
          )}
          {mode === "signup" && selectedPlanId && (
            <p className="auth-message auth-success" role="status">
              Plano escolhido. Conclua o cadastro para continuar.
            </p>
          )}
          <AuthForm
            mode={mode}
            nextPath={nextPath}
            selectedPlanId={selectedPlanId}
          />
          <AuthFooter mode={mode} selectedPlanId={selectedPlanId} />
          <p className="auth-legal">
            Ao continuar, você concorda em usar o serviço de forma responsável e
            em respeitar as regras aplicáveis de comunicação.
          </p>
        </div>
      </section>
    </main>
  );
}
