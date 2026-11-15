import {
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Check,
  CircleHelp,
  Clock3,
  FileText,
  Image,
  LayoutDashboard,
  MessageCircle,
  Plus,
  Radio,
  Send,
  ShieldCheck,
  Smartphone,
  Sparkles,
  Users,
  WalletCards,
  WandSparkles,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { signOut } from "../(auth)/actions";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { isUnauthenticatedError } from "@/lib/supabase/auth-errors";
import { getDashboardData, type DashboardData } from "@/lib/dashboard";
import { DashboardToolbar } from "../dashboard-toolbar";
import { DashboardRefreshButton } from "../dashboard-refresh-button";

type NavItem = {
  label: string;
  icon: LucideIcon;
  active?: boolean;
  badge?: string;
  href?: string;
};

const primaryNavigation: NavItem[] = [
  { label: "Visão geral", icon: LayoutDashboard, href: "/painel", active: true },
  { label: "Campanhas", icon: Send, href: "/campaigns" },
  { label: "Contatos", icon: Users, href: "/contatos" },
  { label: "Conexões", icon: Smartphone, href: "/connections" },
];

const libraryNavigation: NavItem[] = [
  { label: "Templates", icon: FileText, href: "/templates" },
  { label: "Mídia", icon: Image, href: "/media" },
];

const reportNavigation: NavItem[] = [
  { label: "Relatórios", icon: BarChart3, href: "/reports" },
  { label: "Assinatura", icon: WalletCards, href: "/billing" },
];

const numberFormatter = new Intl.NumberFormat("pt-BR");

function formatNumber(value: number | null) {
  return value === null ? "—" : numberFormatter.format(value);
}

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function NavigationGroup({
  title,
  items,
}: {
  title: string;
  items: NavItem[];
}) {
  return (
    <div className="nav-group">
      <p className="nav-group-title">{title}</p>
      <ul className="nav-list">
        {items.map(({ label, icon: Icon, active, badge, href }) => (
          <li key={label}>
            {href ? (
              <a
                className={`nav-link${active ? " active" : ""}`}
                href={href}
                aria-current={active ? "page" : undefined}
                aria-label={label}
                title={label}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
              </a>
            ) : (
              <span
                className="nav-link nav-link-muted"
                aria-disabled="true"
                aria-label={`${label} — disponível nas próximas fases`}
                title={`${label} — disponível nas próximas fases`}
              >
                <Icon size={18} strokeWidth={1.8} />
                <span>{label}</span>
                {badge && <span className="nav-badge">{badge}</span>}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MetricCard({
  label,
  icon: Icon,
  value,
  period,
}: {
  label: string;
  icon: LucideIcon;
  value: number | null;
  period: string;
}) {
  return (
    <article className="metric-card">
      <div className="metric-top">
        <span className="metric-icon">
          <Icon size={18} strokeWidth={1.8} />
        </span>
        <span className="metric-period">{period}</span>
      </div>
      <p className="metric-value">{formatNumber(value)}</p>
      <div className="metric-bottom">
        <span className="metric-label">{label}</span>
        <span className="metric-placeholder">
          <span />
          {value === null ? "Indisponível" : "Atualizado"}
        </span>
      </div>
    </article>
  );
}

function MessagePerformance({ data }: { data: DashboardData }) {
  const rows = [
    { label: "Enviadas", value: data.sentLast30Days, color: "sent" },
    { label: "Entregues", value: data.deliveredLast30Days, color: "delivered" },
    { label: "Com falha", value: data.failedLast30Days, color: "failed" },
  ];
  const maxValue = Math.max(...rows.map((row) => row.value ?? 0));
  const hasData = rows.some((row) => row.value !== null && row.value > 0);

  return (
    <div className="message-performance">
      {rows.map((row) => {
        const width =
          row.value === null || maxValue === 0
            ? 0
            : Math.max(4, (row.value / maxValue) * 100);

        return (
          <div className="performance-row" key={row.label}>
            <div className="performance-label">
              <span><i className={`legend-dot ${row.color}`} />{row.label}</span>
              <strong>{formatNumber(row.value)}</strong>
            </div>
            <div className="performance-track">
              <span
                className={`performance-fill ${row.color}`}
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
      {!hasData && (
        <p className="performance-empty">
          Ainda não há mensagens registradas nos últimos 30 dias.
        </p>
      )}
    </div>
  );
}

async function DashboardContent() {
  await connection();
  if (!getSupabaseConfig()) {
    redirect("/planos");
  }

  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error && !isUnauthenticatedError(error)) {
    throw new Error("Não foi possível verificar sua sessão. Tente novamente.");
  }

  if (!user) {
    redirect("/planos");
  }

  const dashboardData = await getDashboardData(
    supabase,
    user.id,
    user.email,
    user.user_metadata.full_name,
  );
  const displayName = dashboardData.profileName ?? "Minha conta";
  const connectedCount = dashboardData.connectedNumbers;
  const usageLabel = dashboardData.plan?.unlimitedMessages
    ? "Mensagens ilimitadas — sem limite comercial de mensagens."
    : dashboardData.plan
      ? `${formatNumber(dashboardData.sentThisMonth)} de ${formatNumber(dashboardData.plan.messagesLimit)} mensagens usadas neste mês.`
      : "Nenhum plano ativo está associado a esta conta.";
  const usagePercent =
    dashboardData.plan && !dashboardData.plan.unlimitedMessages
      ? dashboardData.sentThisMonth === null ||
        dashboardData.plan.messagesLimit <= 0
        ? null
        : Math.min(
            100,
            (dashboardData.sentThisMonth / dashboardData.plan.messagesLimit) *
              100,
          )
      : null;

  return (
    <main className="app-shell" id="dashboard">
      <aside className="sidebar">
        <a className="brand" href="#dashboard" aria-label="ZapFlow, início">
          <span className="brand-mark">
            <Radio size={21} strokeWidth={2.2} />
          </span>
          <span className="brand-name">
            Zap<span>Flow</span>
          </span>
        </a>

        <div className="workspace-switcher" aria-label="Espaço de trabalho atual">
          <span className="workspace-avatar">B</span>
          <span className="workspace-copy">
            <strong>Meu espaço</strong>
            <small>Área de trabalho</small>
          </span>
        </div>

        <nav className="sidebar-nav" aria-label="Navegação principal">
          <NavigationGroup title="MENU" items={primaryNavigation} />
          <NavigationGroup title="BIBLIOTECA" items={libraryNavigation} />
          <NavigationGroup title="GERENCIAR" items={reportNavigation} />
        </nav>

        <div className="sidebar-bottom">
          <Link className="help-card" href="/billing">
            <span className="help-icon">
              <CircleHelp size={17} />
            </span>
            <div>
              <strong>Precisa de ajuda?</strong>
              <span>Consulte planos e pagamentos</span>
            </div>
            <ArrowUpRight size={15} />
          </Link>
          <form action={signOut} className="profile-row">
            <span className="profile-avatar">
              {displayName.slice(0, 2).toUpperCase()}
            </span>
            <span className="profile-copy">
              <strong>{displayName}</strong>
              <small>{user.email}</small>
            </span>
            <button
              className="profile-signout"
              type="submit"
              aria-label="Sair da conta"
              title="Sair da conta"
            >
              Sair
            </button>
          </form>
        </div>
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span className="breadcrumb-divider">/</span>
            <strong>Visão geral</strong>
          </div>
          <DashboardToolbar recentActivity={dashboardData.recentActivity} />
        </header>

        <div className="page-content">
          <div className="welcome-row">
            <div>
              <div className="eyebrow">
                <Sparkles size={14} />
                <span>SEU CENTRO DE CAMPANHAS</span>
              </div>
              <h1>Visão geral</h1>
              <p className="page-subtitle">
                Acompanhe suas campanhas e comunicações em um só lugar.
              </p>
            </div>
            <Link className="primary-button" href="/campaigns">
              <Plus size={17} strokeWidth={2.2} />
              Criar campanha
              <ArrowRight size={16} />
            </Link>
          </div>

          <section className="setup-banner" aria-label="Configuração inicial">
            <span className="setup-spark">
              <WandSparkles size={21} />
            </span>
            <div className="setup-copy">
              <div className="setup-heading">
                <h2>Visão geral do seu espaço</h2>
                <span className="preview-badge">
                  <span />
                  DADOS DO WORKSPACE
                </span>
              </div>
              <p>
                Indicadores carregados do seu banco. Somente eventos registrados
                são exibidos.
              </p>
            </div>
            <div className="setup-progress" aria-label="Fase 1 de 12">
              <DashboardRefreshButton />
            </div>
          </section>

          {dashboardData.errors.length > 0 && (
            <div className="dashboard-data-warning" role="status">
              <ShieldCheck size={16} />
              <span>
                Alguns dados não puderam ser carregados (
                {dashboardData.errors.join(", ")}). Verifique se a migration da
                Fase 3 foi aplicada e tente novamente.
              </span>
            </div>
          )}

          <section className="metrics-section" aria-labelledby="metrics-title">
            <div className="section-heading">
              <div>
                <h2 id="metrics-title">Resumo da atividade</h2>
                <p>Totais registrados no seu workspace</p>
              </div>
              <span className="period-button period-label">
                <Clock3 size={15} />
                Todos os períodos
              </span>
              </div>
              <div className="metric-grid">
                <MetricCard
                  label="Contatos cadastrados"
                  icon={Users}
                  value={dashboardData.contacts}
                  period="Total"
                />
                <MetricCard
                  label="Campanhas criadas"
                  icon={Send}
                  value={dashboardData.campaigns}
                  period="Total"
                />
                <MetricCard
                  label="Campanhas em andamento"
                  icon={Zap}
                  value={dashboardData.activeCampaigns}
                  period="Agora"
                />
                <MetricCard
                  label="Mensagens enviadas"
                  icon={MessageCircle}
                  value={dashboardData.sentMessages}
                  period="Total"
                />
              </div>
          </section>

          <section className="insights-grid">
            <article className="panel-card performance-card">
              <div className="card-heading">
                <div>
                  <h2>Desempenho das mensagens</h2>
                  <p>Mensagens registradas nos últimos 30 dias</p>
                </div>
                <span className="chart-period">Últimos 30 dias</span>
              </div>
              <MessagePerformance data={dashboardData} />
            </article>

            <article className="panel-card connection-card">
              <div className="card-heading">
                <div>
                  <h2>Conexões WhatsApp</h2>
                  <p>Seus números conectados</p>
                </div>
                <span className={`connection-status ${connectedCount ? "is-connected" : ""}`}>
                  <span />
                  {connectedCount === null
                    ? "Indisponível"
                    : connectedCount > 0
                      ? `${formatNumber(connectedCount)} conectados`
                      : "Não conectado"}
                </span>
              </div>
              {connectedCount === 0 ? (
                <div className="connection-empty">
                <div className="phone-illustration">
                  <Smartphone size={25} strokeWidth={1.6} />
                  <span><MessageCircle size={12} /></span>
                </div>
                <strong>Nenhum número conectado</strong>
                <span>
                  Conecte uma conta WhatsApp para começar a organizar suas
                  campanhas.
                </span>
                <Link className="secondary-button" href="/connections">
                  <Plus size={16} />
                  Conectar número
                </Link>
                </div>
              ) : (
                <div className="connection-summary">
                  <div className="phone-illustration">
                    <Smartphone size={25} strokeWidth={1.6} />
                    <span><MessageCircle size={12} /></span>
                  </div>
                  <strong>
                    {connectedCount === null
                      ? "Não foi possível consultar as conexões"
                      : `${formatNumber(connectedCount)} número${connectedCount === 1 ? "" : "s"} conectado${connectedCount === 1 ? "" : "s"}`}
                  </strong>
                  <span>
                    Os detalhes de conexão estarão disponíveis na etapa de
                    integração WhatsApp.
                  </span>
                </div>
              )}
            </article>
          </section>

          <section className="bottom-grid">
            <article className="panel-card activity-card">
              <div className="card-heading">
                <div>
                  <h2>Atividade recente</h2>
                  <p>Acompanhe as atualizações do seu espaço</p>
                </div>
                <Link className="text-button" href="/reports">
                  Ver tudo <ArrowRight size={14} />
                </Link>
              </div>
              {dashboardData.recentActivity.length === 0 ? (
                <div className="activity-empty">
                  <span className="activity-icon"><Clock3 size={18} /></span>
                  <div>
                    <strong>Nenhuma atividade registrada</strong>
                    <span>Novas campanhas e eventos aparecerão aqui.</span>
                  </div>
                </div>
              ) : (
                <ul className="activity-list">
                  {dashboardData.recentActivity.map((activity) => (
                    <li key={activity.id}>
                      <span className="activity-icon">
                        {activity.title.includes("Mensagem") ? (
                          <MessageCircle size={16} />
                        ) : (
                          <Send size={16} />
                        )}
                      </span>
                      <span className="activity-description">
                        <strong>{activity.title}</strong>
                        <span>{activity.description}</span>
                      </span>
                      <time dateTime={activity.occurredAt}>
                        {formatActivityDate(activity.occurredAt)}
                      </time>
                    </li>
                  ))}
                </ul>
              )}
            </article>

            <Link
              className="plan-card"
              href="/billing"
              aria-label="Gerenciar sua assinatura e plano"
            >
              <div className="plan-topline">
                <span className="plan-icon"><ShieldCheck size={17} /></span>
                <span>SEU PLANO</span>
              </div>
              <h2>{dashboardData.plan?.name ?? "Plano não configurado"}</h2>
              <p>{usageLabel}</p>
              {usagePercent !== null && (
                <div
                  className="plan-usage-track"
                  aria-label={`${Math.round(usagePercent)}% do limite mensal de mensagens utilizado`}
                >
                  <span style={{ width: `${usagePercent}%` }} />
                </div>
              )}
              <div className="plan-separator" />
              <div className="plan-foot">
                <span>
                  <Check size={14} />
                  {dashboardData.plan?.unlimitedMessages
                    ? "Sem limite comercial de mensagens"
                    : dashboardData.plan
                      ? "Consumo contabilizado neste mês"
                      : "Aguardando assinatura ativa"}
                </span>
                <ArrowUpRight size={15} />
              </div>
            </Link>
          </section>

          <footer className="page-footer">
            <span>© 2026 ZapFlow</span>
            <span className="footer-status"><span /> Dados do Supabase</span>
          </footer>
        </div>
      </section>
    </main>
  );
}

function DashboardLoading() {
  return (
    <main className="dashboard-loading" aria-live="polite">
      <span className="brand-mark">
        <Radio size={21} strokeWidth={2.2} />
      </span>
      <p>Carregando seu espaço de trabalho...</p>
    </main>
  );
}

export default function Home() {
  return (
    <Suspense fallback={<DashboardLoading />}>
      <DashboardContent />
    </Suspense>
  );
}
