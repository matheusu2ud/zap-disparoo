import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { CreditCard } from "lucide-react";
import { signOut } from "@/app/(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isUnauthenticatedError } from "@/lib/supabase/auth-errors";
import type { BillingPayment } from "./actions";
import { BillingManager, type BillingPlan } from "./billing-manager";

export const metadata: Metadata = {
  title: "Assinatura e pagamentos | ZapFlow",
};

async function BillingContent({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; plan?: string }>;
}) {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const { next, plan: requestedPlanId } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError && !isUnauthenticatedError(authError)) {
    throw new Error("Não foi possível verificar sua sessão.");
  }
  if (!user) redirect("/login");

  const [
    { data: plans, error: plansError },
    { data: openIntents, error: intentsError },
    { data: profile, error: profileError },
    { data: hasPlanAccess, error: accessError },
  ] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id, name, description, price, currency, messages_limit, campaigns_limit, contacts_limit, connections_limit, storage_limit, unlimited_messages, unlimited_campaigns, unlimited_contacts, unlimited_connections",
      )
      .eq("is_active", true)
      .eq("currency", "BRL")
      .like("name", "BROADCAST HUB - %")
      .order("sort_order")
      .order("name")
      .limit(100),
    supabase
      .from("billing_intents")
      .select(
        "id, identifier, plan_id, amount, pix_code, pix_expires_at, checkout_url, status, provider_subscription_id",
      )
      .in("status", ["creating", "pending", "manual_review", "confirmed"])
      .order("created_at", { ascending: false })
      .limit(1),
    supabase
      .from("profiles")
      .select("plan_selected, role, full_name, cpf")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.rpc("has_broadcast_hub_access"),
  ]);

  const isAdmin = ["admin", "administração", "administracion"].includes(
    profile?.role?.trim().toLowerCase() ?? "",
  );
  const isOnboarding =
    !profile?.plan_selected || (!hasPlanAccess && !isAdmin);
  const selectedPlanId = (plans ?? []).some(
    (availablePlan) => availablePlan.id === requestedPlanId,
  )
    ? requestedPlanId
    : undefined;
  if (isOnboarding && !selectedPlanId && !openIntents?.length) {
    redirect("/planos");
  }
  const buyerName =
    profile?.full_name?.trim() ||
    (typeof user.user_metadata.full_name === "string"
      ? user.user_metadata.full_name.trim()
      : "") ||
    user.email?.split("@")[0] ||
    "";
  const returnTo =
    next?.startsWith("/") && !next.startsWith("//") && !next.startsWith("/billing")
      ? next
      : "/painel";
  let initialPayment: BillingPayment | null = null;
  let manualReviewIdentifier: string | null = null;
  let pendingSetup = false;
  let checkoutBlocked = false;
  const currentIntent = openIntents?.[0];
  if (currentIntent) {
    if (currentIntent.status === "manual_review") {
      manualReviewIdentifier = currentIntent.identifier;
    }
    if (currentIntent.status === "creating") {
      pendingSetup = true;
      checkoutBlocked = true;
    } else {
      const currentPlan = (plans ?? []).find(
        (plan) => plan.id === currentIntent.plan_id,
      );
      initialPayment = {
        id: currentIntent.id,
        identifier: currentIntent.identifier,
        planName:
          currentPlan?.name.replace(/^BROADCAST HUB - /, "") ?? "Seu plano",
        amount: Number(currentIntent.amount),
        pixCode: currentIntent.pix_code,
        pixExpiresAt: currentIntent.pix_expires_at,
        checkoutUrl: currentIntent.checkout_url,
        status:
          currentIntent.status === "confirmed"
            ? "confirmed"
            : currentIntent.status === "manual_review"
              ? "manual_review"
              : "pending",
      };
      checkoutBlocked = currentIntent.status !== "pending";
    }
  }

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <div className="billing-account-actions">
          <span className="contacts-user">{user.email}</span>
          <form action={signOut}>
            <button className="billing-signout" type="submit">
              Sair da conta
            </button>
          </form>
        </div>
      </header>
      <section className="contacts-content billing-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <CreditCard size={14} />
              PLANOS E PAGAMENTO
            </span>
            <h1>{isOnboarding ? "Escolha seu plano" : "Assinatura"}</h1>
            <p>
              {isOnboarding
                ? "Veja as vantagens de cada plano. Escolha um para liberar o acesso ao site."
                : "Gere ou consulte sua cobrança via Pix pela PoseidonPay."}
            </p>
          </div>
        </div>

        {(plansError || intentsError || profileError || accessError) && (
          <p className="billing-error" role="alert">
            Não foi possível consultar os planos, pagamentos ou seu acesso.
            Verifique se as migrations do banco foram aplicadas.
          </p>
        )}

        {manualReviewIdentifier && (
          <div className="billing-warning" role="alert">
            <strong>Pagamento precisa de conferência</strong>
            <p>
              Não gere outro Pix ainda. Informe ao suporte o identificador{" "}
              <code>{manualReviewIdentifier}</code> para verificar a cobrança
              diretamente na PoseidonPay. Você também pode usar o botão de
              verificação abaixo.
            </p>
          </div>
        )}

        {pendingSetup && (
          <div className="billing-warning" role="status">
            Uma cobrança está sendo preparada. Atualize esta página em alguns
            instantes antes de tentar novamente.
          </div>
        )}

        {!plansError && !intentsError && !profileError && !accessError && (
          <BillingManager
            plans={(plans ?? [])
              .filter((plan) => Number(plan.price) > 0) as BillingPlan[]}
            freePlan={
              ((plans ?? []).find((plan) => Number(plan.price) === 0) as
                | BillingPlan
                | undefined) ?? null
            }
            onboarding={isOnboarding}
            returnTo={returnTo}
            selectedPlanId={selectedPlanId}
            buyerName={buyerName}
            buyerEmail={user.email ?? ""}
            buyerCpf={profile?.cpf ?? ""}
            initialPayment={initialPayment}
            blocked={checkoutBlocked || Boolean(manualReviewIdentifier && !initialPayment)}
          />
        )}

        <div className="billing-confirmation-note">
          <strong>Verificação segura pela PoseidonPay</strong>
          <p>
            A verificação consulta a assinatura diretamente na PoseidonPay.
            O plano só é liberado se ela estiver ativa e corresponder ao
            produto e à cobrança mensal deste pedido. Estados inativos não
            liberam acesso.
          </p>
        </div>
      </section>
    </main>
  );
}

function BillingLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando planos...
      </div>
    </main>
  );
}

export default function BillingPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; plan?: string }>;
}) {
  return (
    <Suspense fallback={<BillingLoading />}>
      <BillingContent searchParams={searchParams} />
    </Suspense>
  );
}
