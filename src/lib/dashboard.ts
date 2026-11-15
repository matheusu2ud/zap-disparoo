import type { SupabaseClient } from "@supabase/supabase-js";

type DashboardCount = number | null;

type CampaignRow = {
  id: string;
  name: string;
  created_at: string;
};

type MessageLogRow = {
  id: string;
  status: string;
  event_at: string;
};

export type DashboardActivity = {
  id: string;
  title: string;
  description: string;
  occurredAt: string;
};

export type DashboardData = {
  contacts: DashboardCount;
  campaigns: DashboardCount;
  activeCampaigns: DashboardCount;
  sentMessages: DashboardCount;
  deliveredMessages: DashboardCount;
  failedMessages: DashboardCount;
  connectedNumbers: DashboardCount;
  sentLast30Days: DashboardCount;
  deliveredLast30Days: DashboardCount;
  failedLast30Days: DashboardCount;
  sentThisMonth: DashboardCount;
  profileName: string | null;
  plan: {
    name: string;
    unlimitedMessages: boolean;
    messagesLimit: number;
  } | null;
  recentActivity: DashboardActivity[];
  errors: string[];
};

function statusDescription(status: string) {
  const descriptions: Record<string, string> = {
    queued: "Mensagem adicionada à fila",
    sent: "Mensagem enviada",
    delivered: "Mensagem entregue",
    read: "Mensagem lida",
    failed: "Falha no envio da mensagem",
    skipped: "Mensagem ignorada",
    canceled: "Envio cancelado",
  };

  return descriptions[status] ?? "Atualização de mensagem";
}

function getCount(
  result: { count: number | null; error: { message: string } | null },
  label: string,
  errors: string[],
) {
  if (result.error) {
    errors.push(label);
    return null;
  }

  return result.count;
}

export async function getDashboardData(
  supabase: SupabaseClient,
  userId: string,
  email: string | undefined,
  metadataName: unknown,
): Promise<DashboardData> {
  const now = new Date();
  const nowIso = now.toISOString();
  const thirtyDaysAgo = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const monthStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
  ).toISOString();
  const errors: string[] = [];

  const [
    contacts,
    campaigns,
    activeCampaigns,
    sentMessages,
    deliveredMessages,
    failedMessages,
    connectedNumbers,
    sentLast30Days,
    deliveredLast30Days,
    failedLast30Days,
    sentThisMonth,
    profileResult,
    campaignsResult,
    messagesResult,
    subscriptionResult,
  ] = await Promise.all([
    supabase.from("contacts").select("id", { count: "exact", head: true }),
    supabase.from("campaigns").select("id", { count: "exact", head: true }),
    supabase
      .from("campaigns")
      .select("id", { count: "exact", head: true })
      .in("status", ["queued", "running"]),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "delivered", "read"]),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("status", ["delivered", "read"]),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    supabase
      .from("whatsapp_connections")
      .select("id", { count: "exact", head: true })
      .eq("status", "connected"),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", thirtyDaysAgo),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("status", ["delivered", "read"])
      .gte("delivered_at", thirtyDaysAgo),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed")
      .gte("failed_at", thirtyDaysAgo),
    supabase
      .from("campaign_recipients")
      .select("id", { count: "exact", head: true })
      .in("status", ["sent", "delivered", "read"])
      .gte("sent_at", monthStart)
      .lt("sent_at", nowIso),
    supabase
      .from("profiles")
      .select("full_name")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("campaigns")
      .select("id, name, created_at")
      .order("created_at", { ascending: false })
      .limit(5),
    supabase
      .from("message_logs")
      .select("id, status, event_at")
      .order("event_at", { ascending: false })
      .limit(5),
    supabase
      .from("subscriptions")
      .select("plan_id")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .lte("starts_at", nowIso)
      .or(`ends_at.is.null,ends_at.gt.${nowIso}`)
      .order("starts_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const counts = {
    contacts: getCount(contacts, "contatos", errors),
    campaigns: getCount(campaigns, "campanhas", errors),
    activeCampaigns: getCount(activeCampaigns, "campanhas em andamento", errors),
    sentMessages: getCount(sentMessages, "mensagens enviadas", errors),
    deliveredMessages: getCount(deliveredMessages, "mensagens entregues", errors),
    failedMessages: getCount(failedMessages, "mensagens com falha", errors),
    connectedNumbers: getCount(connectedNumbers, "conexões WhatsApp", errors),
    sentLast30Days: getCount(sentLast30Days, "envios dos últimos 30 dias", errors),
    deliveredLast30Days: getCount(
      deliveredLast30Days,
      "entregas dos últimos 30 dias",
      errors,
    ),
    failedLast30Days: getCount(
      failedLast30Days,
      "falhas dos últimos 30 dias",
      errors,
    ),
    sentThisMonth: getCount(sentThisMonth, "uso mensal de mensagens", errors),
  };

  if (profileResult.error) errors.push("perfil");
  if (campaignsResult.error) errors.push("atividade de campanhas");
  if (messagesResult.error) errors.push("atividade de mensagens");
  if (subscriptionResult.error) errors.push("assinatura atual");

  let plan: DashboardData["plan"] = null;
  if (subscriptionResult.data) {
    const { data: planData, error: planError } = await supabase
      .from("plans")
      .select("name, unlimited_messages, messages_limit")
      .eq("id", subscriptionResult.data.plan_id)
      .maybeSingle();

    if (planError) {
      errors.push("plano atual");
    } else if (planData) {
      plan = {
        name: planData.name,
        unlimitedMessages: planData.unlimited_messages,
        messagesLimit: planData.messages_limit,
      };
    } else {
      errors.push("plano associado à assinatura");
    }
  }

  const recentCampaigns: CampaignRow[] = campaignsResult.data ?? [];
  const recentMessages: MessageLogRow[] = messagesResult.data ?? [];
  const recentActivity = [
    ...recentCampaigns.map((campaign) => ({
      id: `campaign-${campaign.id}`,
      title: "Campanha criada",
      description: campaign.name,
      occurredAt: campaign.created_at,
    })),
    ...recentMessages.map((message, index) => ({
      id: `message-${index}-${message.event_at}`,
      title: statusDescription(message.status),
      description: "Atualização registrada",
      occurredAt: message.event_at,
    })),
  ]
    .sort(
      (left, right) =>
        new Date(right.occurredAt).getTime() -
        new Date(left.occurredAt).getTime(),
    )
    .slice(0, 5);

  return {
    ...counts,
    profileName:
      profileResult.data?.full_name?.trim() ||
      (typeof metadataName === "string" ? metadataName : null) ||
      email ||
      null,
    plan,
    recentActivity,
    errors,
  };
}
