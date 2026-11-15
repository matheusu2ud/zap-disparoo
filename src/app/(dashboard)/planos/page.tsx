import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Suspense } from "react";
import { ArrowRight, Check, Radio, Sparkles } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isUnauthenticatedError } from "@/lib/supabase/auth-errors";
import { FreePlanButton } from "./free-plan-button";

export const metadata: Metadata = {
  title: "Planos | ZapFlow",
  description: "Compare os planos do ZapFlow e escolha o ideal para você.",
};

type Plan = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  messages_limit: number;
  campaigns_limit: number;
  contacts_limit: number;
  connections_limit: number;
  storage_limit: number;
  unlimited_messages: boolean;
  unlimited_campaigns: boolean;
  unlimited_contacts: boolean;
  unlimited_connections: boolean;
};

function displayName(name: string) {
  return name.replace(/^BROADCAST HUB - /, "");
}

function formatPrice(value: number) {
  if (value === 0) return "Grátis";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function formatLimit(
  value: number,
  unlimited: boolean,
  singular: string,
  plural: string,
) {
  return unlimited
    ? `Sem limite de ${plural}`
    : `${value.toLocaleString("pt-BR")} ${value === 1 ? singular : plural}`;
}

function formatStorage(bytes: number) {
  const gigabyte = 1024 ** 3;
  return bytes >= gigabyte
    ? `${bytes / gigabyte} GB de armazenamento`
    : `${bytes / 1024 ** 2} MB de armazenamento`;
}

function getBenefits(plan: Plan) {
  return [
    formatLimit(
      plan.messages_limit,
      plan.unlimited_messages,
      "mensagem/mês",
      "mensagens/mês",
    ),
    formatLimit(
      plan.campaigns_limit,
      plan.unlimited_campaigns,
      "campanha/mês",
      "campanhas/mês",
    ),
    formatLimit(plan.contacts_limit, plan.unlimited_contacts, "contato", "contatos"),
    formatLimit(
      plan.connections_limit,
      plan.unlimited_connections,
      "conexão WhatsApp",
      "conexões WhatsApp",
    ),
    formatStorage(plan.storage_limit),
  ];
}

async function PlansContent() {
  await connection();
  const config = getSupabaseConfig();
  const supabase = config ? await createClient() : null;
  const [authResult, plansResult] = await Promise.all([
    supabase
      ? supabase.auth.getUser()
      : Promise.resolve({ data: { user: null }, error: null }),
    supabase
      ? supabase
        .from("plans")
        .select(
          "id, name, description, price, currency, messages_limit, campaigns_limit, contacts_limit, connections_limit, storage_limit, unlimited_messages, unlimited_campaigns, unlimited_contacts, unlimited_connections",
        )
        .eq("is_active", true)
        .eq("currency", "BRL")
        .like("name", "BROADCAST HUB - %")
        .order("sort_order")
        .order("name")
        .limit(10)
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (authResult.error && !isUnauthenticatedError(authResult.error)) {
    throw new Error("Não foi possível verificar sua sessão.");
  }
  const user = authResult.data.user;
  const { data: plans, error } = plansResult;
  const planRows = (plans ?? []) as Plan[];

  return (
    <main className="pricing-page">
      <header className="pricing-header">
        <Link className="pricing-brand" href="/" aria-label="ZapFlow">
          <span className="brand-mark">
            <Radio size={20} />
          </span>
          <span className="brand-name">
            Zap<span>Flow</span>
          </span>
        </Link>
        <div className="pricing-header-actions">
          {user ? (
            <>
              <Link className="pricing-login" href="/painel">
                Abrir painel
              </Link>
              <Link className="pricing-login" href="/billing">
                Minha assinatura
              </Link>
              <form action={signOut}>
                <button className="pricing-login pricing-logout" type="submit">
                  Sair da conta
                </button>
              </form>
            </>
          ) : (
            <Link className="pricing-login" href="/login">
              Entrar
            </Link>
          )}
        </div>
      </header>

      <section className="pricing-hero">
        <span className="pricing-eyebrow">
          <Sparkles size={14} />
          PLANOS PARA CADA MOMENTO
        </span>
        <h1>Escolha o plano certo para suas conversas</h1>
        <p>
          Compare os recursos, escolha sua assinatura e comece a organizar suas
          campanhas.
        </p>
      </section>

      {!config ? (
        <p className="billing-error" role="alert">
          Não foi possível consultar os planos. Configure a conexão do
          Supabase para disponibilizá-los.
        </p>
      ) : error ? (
        <p className="billing-error" role="alert">
          Não foi possível carregar os planos. Atualize a página ou tente mais
          tarde.
        </p>
      ) : planRows.length ? (
        <section className="pricing-grid" aria-label="Planos disponíveis">
          {planRows.map((plan) => {
            const free = Number(plan.price) === 0;
            const featured = plan.name.endsWith("Profissional");
            const href = user
              ? `/billing?plan=${encodeURIComponent(plan.id)}`
              : `/cadastro?plan=${encodeURIComponent(plan.id)}`;
            return (
              <article
                className={`pricing-card${featured ? " pricing-card-featured" : ""}`}
                key={plan.id}
              >
                {featured && (
                  <span className="pricing-popular">MAIS RECURSOS</span>
                )}
                <h2>{displayName(plan.name)}</h2>
                <p className="pricing-description">{plan.description}</p>
                <p className="pricing-price">
                  <strong>{formatPrice(Number(plan.price))}</strong>
                  {!free && <span>/mês</span>}
                </p>
                <ul>
                  {getBenefits(plan).map((benefit) => (
                    <li key={benefit}>
                      <Check size={15} aria-hidden="true" />
                      {benefit}
                    </li>
                  ))}
                </ul>
                {free && user ? (
                  <FreePlanButton />
                ) : (
                  <Link
                    className={free ? "pricing-button pricing-button-secondary" : "pricing-button"}
                    href={href}
                  >
                    {free ? "Começar grátis" : "Escolher plano"}
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                )}
                {!free && (
                  <small className="pricing-footnote">
                    O acesso é liberado após a confirmação do pagamento.
                  </small>
                )}
              </article>
            );
          })}
        </section>
      ) : (
        <p className="billing-empty">
          Os planos não estão disponíveis no momento. Avise o administrador.
        </p>
      )}

      <p className="pricing-footer">
        O plano Grátis é ativado sem cobrança. Planos pagos são mensais e
        processados pela PoseidonPay.
      </p>
    </main>
  );
}

export default function PlansPage() {
  return (
    <Suspense
      fallback={
        <main className="pricing-page">
          <p className="pricing-footer" role="status">
            Carregando planos...
          </p>
        </main>
      }
    >
      <PlansContent />
    </Suspense>
  );
}
