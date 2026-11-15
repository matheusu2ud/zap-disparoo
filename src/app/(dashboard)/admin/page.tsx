import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { AdminManager, type AdminPlan, type AdminUser } from "./admin-manager";

export const metadata: Metadata = {
  title: "Administração | ZapFlow",
};

async function AdminContent() {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user: authUser },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!authUser) redirect("/login");

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("role, is_active")
    .eq("id", authUser.id)
    .maybeSingle();
  if (profileError) {
    throw new Error("Não foi possível verificar suas permissões administrativas.");
  }
  if (!profile?.is_active || profile.role !== "admin") redirect("/painel");

  const [
    { data: plans, error: plansError },
    { data: profiles, error: usersError },
    { data: subscriptions, error: subscriptionsError },
  ] = await Promise.all([
    supabase
      .from("plans")
      .select(
        "id, name, description, price, currency, messages_limit, campaigns_limit, contacts_limit, connections_limit, storage_limit, unlimited_messages, unlimited_campaigns, unlimited_contacts, unlimited_connections, is_active, sort_order",
      )
      .like("name", "BROADCAST HUB - %")
      .order("sort_order")
      .order("name"),
    supabase
      .from("profiles")
      .select("id, email, full_name, is_active")
      .order("created_at", { ascending: false })
      .limit(200),
    supabase
      .from("subscriptions")
      .select("user_id, plan_id, status, ends_at, starts_at")
      .in("status", ["active", "trialing", "past_due"])
      .lte("starts_at", new Date().toISOString())
      .or(`ends_at.is.null,ends_at.gt.${new Date().toISOString()}`)
      .order("starts_at", { ascending: false }),
  ]);

  const loadError = plansError || usersError || subscriptionsError;
  const planRows = (plans ?? []) as AdminPlan[];
  const subscriptionByUser = new Map<string, AdminUser["subscription"]>();
  for (const subscription of subscriptions ?? []) {
    if (!subscriptionByUser.has(subscription.user_id)) {
      subscriptionByUser.set(subscription.user_id, {
        plan_id: subscription.plan_id,
        status: subscription.status,
        ends_at: subscription.ends_at,
      });
    }
  }
  const userRows: AdminUser[] = (profiles ?? []).map((item) => ({
    ...item,
    subscription: subscriptionByUser.get(item.id) ?? null,
  }));

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <span className="contacts-user">{authUser.email}</span>
      </header>
      <section className="contacts-content admin-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <ShieldCheck size={14} />
              ÁREA RESTRITA
            </span>
            <h1>Administração</h1>
            <p>Gerencie planos, assinaturas e acesso de usuários.</p>
          </div>
        </div>
        {loadError ? (
          <p className="admin-load-error" role="alert">
            Não foi possível carregar todos os dados administrativos. Verifique
            as migrations e as permissões do banco antes de fazer alterações.
          </p>
        ) : (
          <AdminManager
            plans={planRows}
            users={userRows}
            currentUserId={authUser.id}
          />
        )}
      </section>
    </main>
  );
}

function AdminLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Verificando permissões...
      </div>
    </main>
  );
}

export default function AdminPage() {
  return (
    <Suspense fallback={<AdminLoading />}>
      <AdminContent />
    </Suspense>
  );
}
