"use client";

import { useActionState, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
  queued: "Na fila",
  running: "Processando",
  paused: "Pausada",
  completed: "Concluída",
  canceled: "Cancelada",
  failed: "Falhou",
};

function ActionMessage({ state }: { state: CampaignActionState }) {
  if (state.error) {
    return (
      <p className="campaign-action-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="campaign-action-message is-success" role="status">
        {state.success}
      </p>
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

  return (
    <details className="campaign-create-disclosure">
      <summary className="primary-button">
        <span aria-hidden="true">+</span>
        Nova campanha
      </summary>
      <form className="campaign-create-form" action={formAction}>
        <h2>Criar campanha</h2>
        <p>
          O envio não acontece ao criar a campanha. Apenas contatos com
          consentimento ativo podem entrar na fila.
        </p>
        <label className="campaign-field">
          <span>Nome da campanha</span>
          <input
            name="name"
            required
            maxLength={200}
            placeholder="Ex.: Novidades de novembro"
          />
        </label>
        <label className="campaign-field">
          <span>Conexão WhatsApp <i>Necessária para agendar</i></span>
          <select name="connection_id" defaultValue="">
            <option value="">Selecionar depois</option>
            {options.connections.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="campaign-field">
          <span>Usar template <i>Opcional</i></span>
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
            <option value="">Escrever nova mensagem</option>
            {options.templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <label className="campaign-field">
          <span>Mensagem</span>
          <textarea
            name="message_body"
            required
            rows={5}
            maxLength={5000}
            value={messageBody}
            onChange={(event) => setMessageBody(event.target.value)}
            placeholder="Escreva a mensagem da campanha..."
          />
          <small>{messageBody.length}/5.000 caracteres</small>
        </label>
        <label className="campaign-field">
          <span>Mídia <i>Opcional</i></span>
          <select name="media_file_id" defaultValue="">
            <option value="">Sem mídia</option>
            {options.media.map((item) => (
              <option key={item.id} value={item.id}>
                {item.content_type.startsWith("image/")
                  ? "Foto"
                  : item.content_type.startsWith("video/")
                    ? "Vídeo"
                    : "Documento"}{" "}
                — {item.file_name}
              </option>
            ))}
          </select>
          <small>
            Para adicionar uma foto ou vídeo, primeiro envie o arquivo na{" "}
            <Link href="/media">biblioteca de mídia</Link>. Ele será enviado
            junto com a mensagem quando a campanha for processada.
          </small>
        </label>
        <div className="campaign-contact-picker">
          <div className="campaign-picker-heading">
            <span>Contatos autorizados</span>
            <strong>{selectedContacts.length}/500 selecionados</strong>
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar contatos..."
            aria-label="Buscar contatos autorizados"
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
              <p>
                {options.contacts.length
                  ? "Nenhum contato corresponde à busca."
                  : "Não há contatos com consentimento ativo."}
              </p>
            )}
          </div>
          <small>
            A autorização será conferida novamente antes de agendar e deverá
            ser revalidada pelo futuro processador antes de cada envio.
          </small>
        </div>
        <ActionMessage state={state} />
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Criando..." : "Salvar rascunho"}
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
      className="campaign-schedule-form"
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
      <input
        type="hidden"
        name="timezone_offset"
        defaultValue={0}
      />
      <label>
        <span>Data e hora <i>Opcional</i></span>
        <input type="datetime-local" name="scheduled_at" />
      </label>
      <button className="campaign-primary-action" type="submit" disabled={pending}>
        {pending ? "Agendando..." : "Colocar na fila"}
      </button>
      <ActionMessage state={state} />
      <small>
        Sem data, a campanha entra na fila imediatamente. O envio só ocorrerá
        quando um processador de fila estiver configurado.
      </small>
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
        if (!window.confirm("Cancelar esta campanha e seus itens ainda na fila?")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="campaign_id" value={campaignId} />
      <button className="campaign-danger-action" type="submit" disabled={pending}>
        {pending ? "Cancelando..." : "Cancelar"}
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

  return (
    <article className="campaign-card">
      <div className="campaign-card-heading">
        <div>
          <span className={`campaign-status status-${campaign.status}`}>
            {statusNames[campaign.status] ?? campaign.status}
          </span>
          <h2>{campaign.name}</h2>
        </div>
        <span className="campaign-recipient-count">
          {campaign.recipient_count} contato
          {campaign.recipient_count === 1 ? "" : "s"}
        </span>
      </div>
      <p className="campaign-message-preview">
        {campaign.message_body}
      </p>
      <div className="campaign-card-meta">
        <span>{campaign.connection_label ?? "Sem conexão selecionada"}</span>
        {campaign.media_file_name && <span>{campaign.media_file_name}</span>}
        {scheduledDate && <span>Agendada: {scheduledDate}</span>}
      </div>
      {campaign.status === "draft" ? (
        <div className="campaign-draft-actions">
          {campaign.recipient_count > 0 ? (
            <ScheduleForm campaignId={campaign.id} />
          ) : (
            <p className="campaign-hint">
              Adicione contatos autorizados para disponibilizar o agendamento.
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
              className="campaign-danger-action"
              type="submit"
              disabled={deletePending}
            >
              {deletePending ? "Excluindo..." : "Excluir rascunho"}
            </button>
            <ActionMessage state={deleteState} />
          </form>
        </div>
      ) : ["scheduled", "queued", "paused"].includes(campaign.status) ? (
        <CancelForm campaignId={campaign.id} />
      ) : null}
    </article>
  );
}
