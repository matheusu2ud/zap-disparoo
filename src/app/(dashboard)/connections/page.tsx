import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Smartphone } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  ConnectionManager,
  NewConnectionForm,
  type ConnectionRow,
} from "./connection-manager";

export const metadata: Metadata = {
  title: "Conexões WhatsApp | ZapFlow",
};

async function ConnectionsContent() {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error("Não foi possível verificar sua sessão. Tente novamente.");
  }
  if (!user) redirect("/login");

  const [{ data: connectionRows, error: connectionsError }, { data: plans, error: planError }] =
    await Promise.all([
      supabase
        .from("whatsapp_connections")
        .select("id, label, phone_number, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase
        .from("subscriptions")
        .select("plan_id, status, starts_at, ends_at")
        .eq("user_id", user.id)
        .in("status", ["trialing", "active", "past_due"])
        .lte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: false })
        .limit(1),
    ]);

  const planErrorMessage = planError
    ? "Não foi possível consultar seu plano. Verifique as migrations do banco."
    : null;
  const planSubscription = plans?.[0];
  const { data: plan, error: planDetailsError } = planSubscription
    ? await supabase
        .from("plans")
        .select("connections_limit, unlimited_connections")
        .eq("id", planSubscription.plan_id)
        .maybeSingle()
    : { data: null, error: null };
  const limitError =
    planErrorMessage || planDetailsError
      ? "Não foi possível consultar o limite do plano. Verifique as migrations do banco."
      : null;
  const connectionError = connectionsError
    ? "Não foi possível carregar as conexões. Verifique se as migrations foram aplicadas."
    : null;
  const connections = (connectionRows ?? []) as ConnectionRow[];
  const hasPlan = Boolean(planSubscription && plan);
  const atLimit =
    hasPlan &&
    !plan?.unlimited_connections &&
    connections.length >= (plan?.connections_limit ?? 0);

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <span className="contacts-user">{user.email}</span>
      </header>

      <section className="contacts-content connections-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <Smartphone size={14} />
              CANAIS DE ATENDIMENTO
            </span>
            <h1>Conexões WhatsApp</h1>
            <p>Gerencie suas instâncias conectadas à Evolution API.</p>
          </div>
          <NewConnectionForm atLimit={!hasPlan || Boolean(limitError) || atLimit} />
        </div>

        {limitError && (
          <p className="connections-notice is-error" role="alert">
            {limitError}
          </p>
        )}
        {connectionError && (
          <p className="connections-notice is-error" role="alert">
            {connectionError}
          </p>
        )}
        {!limitError && !hasPlan && (
          <p className="connections-notice">
            Para criar uma conexão, sua conta precisa ter um plano ativo.
          </p>
        )}
        {plan && !plan.unlimited_connections && (
          <p className="connections-limit">
            {connections.length} de {plan.connections_limit} conexões utilizadas
          </p>
        )}

        {!connectionError && connections.length > 0 ? (
          <div className="connections-list">
            {connections.map((connectionRow) => (
              <ConnectionManager
                key={connectionRow.id}
                connection={connectionRow}
              />
            ))}
          </div>
        ) : !connectionError ? (
          <div className="connections-empty">
            <span className="connections-empty-icon">
              <Smartphone size={22} />
            </span>
            <h2>Nenhuma conexão configurada</h2>
            <p>Crie sua primeira conexão para vincular um número de WhatsApp.</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function ConnectionsLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando conexões...
      </div>
    </main>
  );
}

export default function ConnectionsPage() {
  return (
    <Suspense fallback={<ConnectionsLoading />}>
      <ConnectionsContent />
    </Suspense>
  );
}
