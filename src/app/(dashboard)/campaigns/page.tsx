import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Send } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  CampaignCard,
  NewCampaignForm,
  type CampaignFormOptions,
  type CampaignRow,
} from "./campaign-manager";

export const metadata: Metadata = {
  title: "Campanhas | ZapFlow",
};

async function CampaignsContent() {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const [
    { data: campaigns, error: campaignsError },
    { data: contacts, error: contactsError },
    { data: connections, error: connectionsError },
    { data: templates, error: templatesError },
    { data: media, error: mediaError },
  ] = await Promise.all([
    supabase
      .from("campaigns")
      .select(
        "id, name, message_body, status, scheduled_at, created_at, connection_id, media_file_id",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("contacts")
      .select("id, name, phone")
      .eq("user_id", user.id)
      .eq("consent_status", "opted_in")
      .not("consented_at", "is", null)
      .is("opted_out_at", null)
      .order("name")
      .limit(5000),
    supabase
      .from("whatsapp_connections")
      .select("id, label")
      .eq("user_id", user.id)
      .eq("status", "connected")
      .order("created_at", { ascending: false }),
    supabase
      .from("message_templates")
      .select("id, name, body")
      .eq("user_id", user.id)
      .order("name")
      .limit(500),
    supabase
      .from("media_files")
      .select("id, file_name, content_type")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(500),
  ]);

  const campaignIds = (campaigns ?? []).map(({ id }) => id);
  const connectionIds = [
    ...new Set(
      (campaigns ?? [])
        .map(({ connection_id }) => connection_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const mediaIds = [
    ...new Set(
      (campaigns ?? [])
        .map(({ media_file_id }) => media_file_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const [
    { data: recipientRows, error: recipientError },
    { data: savedConnections, error: savedConnectionError },
    { data: savedMedia, error: savedMediaError },
  ] = await Promise.all([
    campaignIds.length
      ? supabase
          .from("campaign_recipients")
          .select("campaign_id, status")
          .eq("user_id", user.id)
          .in("campaign_id", campaignIds)
      : Promise.resolve({ data: [], error: null }),
    connectionIds.length
      ? supabase
          .from("whatsapp_connections")
          .select("id, label")
          .eq("user_id", user.id)
          .in("id", connectionIds)
      : Promise.resolve({ data: [], error: null }),
    mediaIds.length
      ? supabase
          .from("media_files")
          .select("id, file_name")
          .eq("user_id", user.id)
          .in("id", mediaIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const recipientCounts = new Map<string, number>();
  for (const recipient of recipientRows ?? []) {
    recipientCounts.set(
      recipient.campaign_id,
      (recipientCounts.get(recipient.campaign_id) ?? 0) + 1,
    );
  }
  const connectionLabels = new Map(
    (savedConnections ?? []).map((item) => [item.id, item.label]),
  );
  const mediaNames = new Map(
    (savedMedia ?? []).map((item) => [item.id, item.file_name]),
  );
  const rows: CampaignRow[] = (campaigns ?? []).map((campaign) => ({
    id: campaign.id,
    name: campaign.name,
    message_body: campaign.message_body,
    status: campaign.status,
    scheduled_at: campaign.scheduled_at,
    created_at: campaign.created_at,
    connection_label: campaign.connection_id
      ? connectionLabels.get(campaign.connection_id) ?? null
      : null,
    media_file_name: campaign.media_file_id
      ? mediaNames.get(campaign.media_file_id) ?? null
      : null,
    recipient_count: recipientCounts.get(campaign.id) ?? 0,
  }));
  const options: CampaignFormOptions = {
    contacts: contacts ?? [],
    connections: connections ?? [],
    templates: templates ?? [],
    media: media ?? [],
  };
  const optionErrors = [
    contactsError && "contatos autorizados",
    connectionsError && "conexões",
    templatesError && "templates",
    mediaError && "mídia",
  ].filter(Boolean);

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <span className="contacts-user">{user.email}</span>
      </header>
      <section className="contacts-content campaigns-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <Send size={14} />
              ENVIO COM CONSENTIMENTO
            </span>
            <h1>Campanhas</h1>
            <p>Prepare rascunhos e organize contatos autorizados na fila.</p>
          </div>
          <NewCampaignForm options={options} />
        </div>

        <div className="campaign-safety-note">
          Salvar um rascunho não envia mensagens. O envio real exige migrations
          aplicadas, conexão da Evolution ativa e worker agendado; o sistema
          verifica novamente o consentimento antes de cada envio.
        </div>

        {campaignsError || recipientError || savedConnectionError || savedMediaError ? (
          <p className="campaign-load-error" role="alert">
            Não foi possível carregar todos os dados das campanhas. Verifique
            as migrations e as permissões do banco.
          </p>
        ) : null}
        {optionErrors.length > 0 && (
          <p className="campaign-load-error" role="alert">
            Não foi possível carregar: {optionErrors.join(", ")}. O formulário
            pode não ter todas as opções disponíveis.
          </p>
        )}

        {!campaignsError && rows.length ? (
          <div className="campaign-list">
            {rows.map((campaign) => (
              <CampaignCard key={campaign.id} campaign={campaign} />
            ))}
          </div>
        ) : !campaignsError ? (
          <div className="library-empty campaign-empty">
            <span className="connections-empty-icon">
              <Send size={22} />
            </span>
            <strong>Nenhuma campanha criada</strong>
            <span>Crie um rascunho para começar a organizar seus envios.</span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function CampaignsLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando campanhas...
      </div>
    </main>
  );
}

export default function CampaignsPage() {
  return (
    <Suspense fallback={<CampaignsLoading />}>
      <CampaignsContent />
    </Suspense>
  );
}
