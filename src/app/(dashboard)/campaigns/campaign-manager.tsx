"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Zap,
  Clock,
  Trash2,
  XCircle,
  Users,
  CheckCircle2,
  AlertCircle,
  ShieldCheck,
  Send,
  Sparkles,
} from "lucide-react";
import {
  cancelCampaign,
  createCampaign,
  deleteDraftCampaign,
  scheduleCampaign,
  type CampaignActionState,
} from "./actions";

export type CampaignRow = {
  id: string;
  name: string;
  message_body: string;
  status: string;
  scheduled_at: string | null;
  created_at: string;
  connection_label: string | null;
  media_file_name: string | null;
  recipient_count: number;
};

export type CampaignFormOptions = {
  contacts: { id: string; name: string; phone: string }[];
  templates: { id: string; name: string; body: string }[];
  connections: { id: string; label: string }[];
  media: { id: string; file_name: string; content_type: string }[];
};

const statusNames: Record<string, string> = {
  draft: "Rascunho",
  scheduled: "Agendada",
  queued: "Disparando / Na fila",
  running: "Disparando Agora",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
  failed: "Falhou",
};

function ActionMessage({ state }: { state: CampaignActionState }) {
  if (state.error) {
    return (
      <div className="campaign-action-message is-error" role="alert">
        <AlertCircle size={15} />
        <span>{state.error}</span>
      </div>
    );
  }
  if (state.success) {
    return (
      <div className="campaign-action-message is-success" role="status">
        <CheckCircle2 size={15} />
        <span>{state.success}</span>
      </div>
    );
  }
  return null;
}

export function NewCampaignForm({ options }: { options: CampaignFormOptions }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    CampaignActionState,
    FormData
  >(createCampaign, {});
  const [messageBody, setMessageBody] = useState("");
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [search, setSearch] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  const visibleContacts = options.contacts.filter((contact) =>
    `${contact.name} ${contact.phone}`.toLowerCase().includes(search.toLowerCase()),
  );

  function toggleContact(id: string) {
    setSelectedContacts((current) =>
      current.includes(id)
        ? current.filter((selectedId) => selectedId !== id)
        : current.length >= 500
          ? current
          : [...current, id],
    );
  }

  function selectAllContacts() {
    if (selectedContacts.length === options.contacts.length) {
      setSelectedContacts([]);
    } else {
      setSelectedContacts(options.contacts.slice(0, 500).map((c) => c.id));
    }
  }

  function insertVariable(tag: string) {
    setMessageBody((prev) => prev + tag);
  }

  return (
    <details className="campaign-create-disclosure">
      <summary className="primary-button turbo-main-btn">
        <Zap size={16} />
        <span>Criar Novo Disparo</span>
      </summary>
      <form className="campaign-create-form turbo-form" action={formAction}>
        <div className="turbo-header">
          <div className="turbo-badge">
            <Zap size={13} /> DISPARADOR TURBO
          </div>
          <h2>Configurar Campanha de Disparo</h2>
          <p>
            Envie mensagens personalizadas e mídias em massa diretamente pelo seu WhatsApp.
          </p>
        </div>

        <label className="campaign-field">
          <span>Nome da Campanha</span>
          <input
            name="name"
            required
            maxLength={200}
            placeholder="Ex.: Disparo Promocional Black Friday"
          />
        </label>

        <label className="campaign-field">
          <span>Conexão WhatsApp (Chip de Envio)</span>
          <select name="connection_id" defaultValue={options.connections[0]?.id ?? ""}>
            {options.connections.length === 0 ? (
              <option value="">Nenhum WhatsApp conectado (Vá em Conexões)</option>
            ) : (
              options.connections.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label} (Conectado)
                </option>
              ))
            )}
          </select>
        </label>

        <label className="campaign-field">
          <span>Usar Template Pronto <i>Opcional</i></span>
          <select
            value={selectedTemplate}
            onChange={(event) => {
              const template = options.templates.find(
                (item) => item.id === event.target.value,
              );
              setSelectedTemplate(event.target.value);
              if (template) setMessageBody(template.body);
            }}
          >
            <option value="">Escrever mensagem personalizada</option>
            {options.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>

        {/* Variáveis Dinâmicas Rápidas */}
        <div className="turbo-vars-bar">
          <span className="turbo-vars-label">
            <Sparkles size={12} /> Tags Rápidas:
          </span>
          <button
            type="button"
            className="turbo-var-tag"
            onClick={() => insertVariable(" {nome} ")}
            title="Injeta o primeiro nome do contato"
          >
            + Nome
          </button>
          <button
            type="button"
            className="turbo-var-tag"
            onClick={() => insertVariable(" {saudacao} ")}
            title="Injeta Bom dia / Boa tarde automaticamente"
          >
            + Saudação
          </button>
          <button
            type="button"
            className="turbo-var-tag"
            onClick={() => insertVariable(" {telefone} ")}
            title="Injeta o telefone do contato"
          >
            + Telefone
          </button>
        </div>

        <label className="campaign-field">
          <span>Texto da Mensagem</span>
          <textarea
            name="message_body"
            required
            rows={5}
            maxLength={5000}
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            placeholder="Olá {nome}! Tudo bem? Veja as novidades exclusivas de hoje..."
          />
          <small>{messageBody.length}/5.000 caracteres</small>
        </label>

        <label className="campaign-field">
          <span>Anexo de Mídia <i>Opcional</i></span>
          <select name="media_file_id" defaultValue="">
            <option value="">Sem anexo (apenas texto)</option>
            {options.media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.content_type.startsWith("image/")
                  ? "📷 Foto"
                  : item.content_type.startsWith("video/")
                    ? "🎬 Vídeo"
                    : "📄 Documento"}{" "}
                — {item.file_name}
              </option>
            ))}
          </select>
          <small>
            Para fotos ou vídeos, adicione antes na{" "}
            <Link href="/media">Biblioteca de Mídia</Link>.
          </small>
        </label>

        {/* Seleção em Massa de Contatos */}
        <div className="campaign-contact-picker turbo-picker">
          <div className="campaign-picker-heading">
            <div className="turbo-picker-title">
              <Users size={15} />
              <span>Destinatários do Disparo</span>
            </div>
            <div className="turbo-picker-actions">
              <button
                type="button"
                className="turbo-select-all-btn"
                onClick={selectAllContacts}
              >
                {selectedContacts.length === options.contacts.length &&
                options.contacts.length > 0
                  ? "Desmarcar Todos"
                  : "Selecionar Todos"}
              </button>
              <strong className="turbo-counter">
                {selectedContacts.length} de {options.contacts.length}
              </strong>
            </div>
          </div>

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="🔍 Buscar por nome ou telefone..."
            aria-label="Buscar contatos"
          />

          <div className="campaign-contact-list">
            {visibleContacts.length ? (
              visibleContacts.map((contact) => (
                <label key={contact.id} className="campaign-contact-option">
                  <input
                    type="checkbox"
                    name="contact_ids"
                    value={contact.id}
                    checked={selectedContacts.includes(contact.id)}
                    disabled={
                      pending ||
                      (!selectedContacts.includes(contact.id) &&
                        selectedContacts.length >= 500)
                    }
                    onChange={() => toggleContact(contact.id)}
                  />
                  <span>
                    <strong>{contact.name}</strong>
                    <small>{contact.phone}</small>
                  </span>
                </label>
              ))
            ) : (
              <p className="turbo-empty-contacts">
                {options.contacts.length
                  ? "Nenhum contato encontrado na busca."
                  : "Nenhum contato autorizado encontrado. Vá na aba 'Contatos' e clique em 'Autorizar para campanhas'."}
              </p>
            )}
          </div>

          <div className="turbo-anti-ban-note">
            <ShieldCheck size={14} />
            <span>
              <strong>Proteção Anti-Ban Ativa:</strong> Os disparos são espaçados com delays inteligentes para simular digitação humana e proteger seu número.
            </span>
          </div>
        </div>

        <ActionMessage state={state} />

        <button className="primary-button turbo-submit-btn" type="submit" disabled={pending}>
          {pending ? (
            "Criando Campanha..."
          ) : (
            <>
              <Send size={15} />
              <span>Criar Campanha de Disparo</span>
            </>
          )}
        </button>
      </form>
    </details>
  );
}

function ScheduleForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    CampaignActionState,
    FormData
  >(scheduleCampaign, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form
      className="campaign-schedule-form turbo-schedule-form"
      action={formAction}
      onSubmit={(event) => {
        const offsetField =
          event.currentTarget.elements.namedItem("timezone_offset");
        if (offsetField instanceof HTMLInputElement) {
          offsetField.value = String(new Date().getTimezoneOffset());
        }
      }}
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <input type="hidden" name="timezone_offset" defaultValue={0} />

      <div className="turbo-actions-bar">
        {/* Disparo Imediato */}
        <button
          className="turbo-instant-launch-btn"
          type="submit"
          disabled={pending}
          title="Inicia o disparo em massa agora mesmo"
        >
          <Zap size={15} />
          <span>{pending ? "Disparando..." : "DISPARAR AGORA"}</span>
        </button>

        {/* Agendamento Opcional */}
        <div className="turbo-schedule-input-group">
          <Clock size={14} />
          <input
            type="datetime-local"
            name="scheduled_at"
            placeholder="Agendar horário"
            title="Escolha uma data e horário futuro se não quiser disparar agora"
          />
          <button
            className="turbo-schedule-btn"
            type="submit"
            disabled={pending}
          >
            Agendar
          </button>
        </div>
      </div>

      <ActionMessage state={state} />
    </form>
  );
}

function CancelForm({ campaignId }: { campaignId: string }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    CampaignActionState,
    FormData
  >(cancelCampaign, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (!window.confirm("Deseja realmente pausar e cancelar este disparo?")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <button className="campaign-danger-action turbo-cancel-btn" type="submit" disabled={pending}>
        <XCircle size={14} />
        <span>{pending ? "Parando..." : "Pausar / Cancelar Disparo"}</span>
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

export function CampaignCard({ campaign }: { campaign: CampaignRow }) {
  const router = useRouter();
  const [deleteState, deleteAction, deletePending] = useActionState<
    CampaignActionState,
    FormData
  >(deleteDraftCampaign, {});

  useEffect(() => {
    if (deleteState.success) router.refresh();
  }, [deleteState.success, router]);

  const scheduledDate = campaign.scheduled_at
    ? new Intl.DateTimeFormat("pt-BR", {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(campaign.scheduled_at))
    : null;

  const isLive = ["queued", "running"].includes(campaign.status);

  return (
    <article className={`campaign-card turbo-card ${isLive ? "is-active-disparo" : ""}`}>
      <div className="campaign-card-heading">
        <div>
          <div className="turbo-card-status-row">
            <span className={`campaign-status status-${campaign.status}`}>
              {isLive && <span className="turbo-pulse" />}
              {statusNames[campaign.status] ?? campaign.status}
            </span>
          </div>
          <h2>{campaign.name}</h2>
        </div>
        <div className="turbo-recipient-pill">
          <Users size={13} />
          <strong>{campaign.recipient_count}</strong>
          <span>{campaign.recipient_count === 1 ? "destinatário" : "destinatários"}</span>
        </div>
      </div>

      <p className="campaign-message-preview">{campaign.message_body}</p>

      <div className="campaign-card-meta turbo-meta">
        <span className="turbo-connection-badge">
          📱 {campaign.connection_label ?? "Sem conexão selecionada"}
        </span>
        {campaign.media_file_name && (
          <span className="turbo-media-badge">📎 {campaign.media_file_name}</span>
        )}
        {scheduledDate && (
          <span className="turbo-date-badge">⏰ Agendada: {scheduledDate}</span>
        )}
      </div>

      {campaign.status === "draft" ? (
        <div className="campaign-draft-actions turbo-draft-actions">
          {campaign.recipient_count > 0 ? (
            <ScheduleForm campaignId={campaign.id} />
          ) : (
            <p className="campaign-hint">
              Adicione contatos autorizados para habilitar o botão de disparo.
            </p>
          )}
          <form
            action={deleteAction}
            onSubmit={(event) => {
              if (!window.confirm(`Excluir o rascunho "${campaign.name}"?`)) {
                event.preventDefault();
              }
            }}
          >
            <input type="hidden" name="campaign_id" value={campaign.id} />
            <button
              className="campaign-danger-action turbo-delete-btn"
              type="submit"
              disabled={deletePending}
            >
              <Trash2 size={13} />
              <span>{deletePending ? "Excluindo..." : "Excluir Rascunho"}</span>
            </button>
            <ActionMessage state={deleteState} />
          </form>
        </div>
      ) : ["scheduled", "queued", "paused"].includes(campaign.status) ? (
        <div className="turbo-active-actions">
          <CancelForm campaignId={campaign.id} />
        </div>
      ) : null}
    </article>
  );
}
