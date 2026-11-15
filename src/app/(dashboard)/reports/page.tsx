import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

export const metadata: Metadata = {
  title: "Relatórios | ZapFlow",
};

type ReportDay = {
  report_date: string;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  queued: number;
};

const campaignStatusLabels: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  queued: "Na fila",
  running: "Em andamento",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
  failed: "Falhou",
};

const numberFormatter = new Intl.NumberFormat("pt-BR");
const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "short",
  timeZone: "UTC",
});

async function ReportsContent() {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const today = new Date();
  const endDate = today.toISOString().slice(0, 10);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 29);
  const startDate = start.toISOString().slice(0, 10);

  const [{ data, error }, { data: campaigns, error: campaignsError }] =
    await Promise.all([
      supabase.rpc("get_campaign_report", {
        p_start_date: startDate,
        p_end_date: endDate,
      }),
      supabase
        .from("campaigns")
        .select("id, name, status, created_at")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const days = (data ?? []) as ReportDay[];
  const totals = days.reduce(
    (result, day) => ({
      sent: result.sent + Number(day.sent),
      delivered: result.delivered + Number(day.delivered),
      read: result.read + Number(day.read),
      failed: result.failed + Number(day.failed),
      queued: result.queued + Number(day.queued),
    }),
    { sent: 0, delivered: 0, read: 0, failed: 0, queued: 0 },
  );
  const maxDaily = Math.max(
    1,
    ...days.map((day) => Math.max(Number(day.sent), Number(day.failed))),
  );
  const metrics = [
    { label: "Enviadas", value: totals.sent, tone: "sent" },
    { label: "Entregues", value: totals.delivered, tone: "delivered" },
    { label: "Lidas", value: totals.read, tone: "read" },
    { label: "Falhas", value: totals.failed, tone: "failed" },
    { label: "Na fila", value: totals.queued, tone: "queued" },
  ];

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <span className="contacts-user">{user.email}</span>
      </header>
      <section className="contacts-content reports-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <BarChart3 size={14} />
              RESULTADOS DE COMUNICAÇÃO
            </span>
            <h1>Relatórios</h1>
            <p>
              Atividade registrada nos últimos 30 dias · {startDate} a {endDate}
            </p>
            <p className="reports-note">
              Envios refletem a confirmação do provedor. Entregas e leituras
              aparecem somente quando esses eventos forem sincronizados no banco.
            </p>
          </div>
        </div>

        {error && (
          <p className="reports-error" role="alert">
            Não foi possível consultar os relatórios. Aplique a migration da
            Fase 10 e tente novamente.
          </p>
        )}
        {campaignsError && (
          <p className="reports-error" role="alert">
            Não foi possível carregar a lista de campanhas recentes.
          </p>
        )}

        {!error && (
          <>
            <div className="report-metrics">
              {metrics.map((metric) => (
                <article className="report-metric" key={metric.tone}>
                  <span>{metric.label}</span>
                  <strong className={`tone-${metric.tone}`}>
                    {numberFormatter.format(metric.value)}
                  </strong>
                </article>
              ))}
            </div>

            <section className="report-panel">
              <div className="report-panel-heading">
                <div>
                  <h2>Atividade diária</h2>
                  <p>Envios e falhas registrados por dia</p>
                </div>
              </div>
              {days.length ? (
                <div className="report-chart" role="img" aria-label="Gráfico diário de envios e falhas">
                  {days.map((day) => {
                    const sentHeight = Math.max(
                      0,
                      (Number(day.sent) / maxDaily) * 100,
                    );
                    const failedHeight = Math.max(
                      0,
                      (Number(day.failed) / maxDaily) * 100,
                    );
                    const parsedDate = new Date(`${day.report_date}T00:00:00Z`);
                    return (
                      <div className="report-day" key={day.report_date}>
                        <div className="report-bars">
                          <span
                            className="report-bar bar-sent"
                            style={{ height: `${sentHeight}%` }}
                            title={`${day.sent} enviada(s)`}
                          />
                          <span
                            className="report-bar bar-failed"
                            style={{ height: `${failedHeight}%` }}
                            title={`${day.failed} falha(s)`}
                          />
                        </div>
                        <time dateTime={day.report_date}>
                          {dateFormatter.format(parsedDate)}
                        </time>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="report-empty">Nenhum dado no período.</div>
              )}
              <div className="report-legend">
                <span><i className="legend-sent" /> Enviadas</span>
                <span><i className="legend-failed" /> Falhas</span>
              </div>
            </section>

            <section className="report-panel report-campaigns">
              <div className="report-panel-heading">
                <div>
                  <h2>Campanhas recentes</h2>
                  <p>Últimas 10 campanhas do seu espaço</p>
                </div>
                <Link href="/campaigns" className="report-link">
                  Ver campanhas
                </Link>
              </div>
              {campaigns?.length ? (
                <ul>
                  {campaigns.map((campaign) => (
                    <li key={campaign.id}>
                      <span>
                        <strong>{campaign.name}</strong>
                        <small>
                          {new Intl.DateTimeFormat("pt-BR", {
                            dateStyle: "medium",
                          }).format(new Date(campaign.created_at))}
                        </small>
                      </span>
                      <span className={`campaign-status status-${campaign.status}`}>
                        {campaignStatusLabels[campaign.status] ?? "Desconhecido"}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="report-empty">Nenhuma campanha criada.</div>
              )}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

function ReportsLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando relatórios...
      </div>
    </main>
  );
}

export default function ReportsPage() {
  return (
    <Suspense fallback={<ReportsLoading />}>
      <ReportsContent />
    </Suspense>
  );
}
