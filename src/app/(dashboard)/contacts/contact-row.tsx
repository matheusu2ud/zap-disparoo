"use client";

import { useActionState, useState } from "react";
import {
  createContactTag,
  deleteContact,
  deleteContactTag,
  updateContact,
  type ContactActionState,
} from "./actions";

export type ContactRowData = {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  consent_status: "unknown" | "opted_in" | "opted_out";
  created_at: string;
  notes: string;
  contact_tags: { id: string; tag_name: string }[];
  recentMessages: { status: string; created_at: string }[];
};

function formatDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(value));
}

function statusText(status: string) {
  const labels: Record<string, string> = {
    queued: "Na fila",
    sent: "Enviada",
    delivered: "Entregue",
    read: "Lida",
    failed: "Falha",
    skipped: "Ignorada",
    canceled: "Cancelada",
  };
  return labels[status] ?? "Status indisponível";
}

function EditContactForm({ contact }: { contact: ContactRowData }) {
  const [state, formAction, pending] = useActionState<
    ContactActionState,
    FormData
  >(updateContact, {});

  return (
    <form className="contact-edit-form" action={formAction}>
      <input type="hidden" name="id" value={contact.id} />
      <label className="contact-field">
        <span>Nome</span>
        <input
          name="name"
          defaultValue={contact.name}
          required
          maxLength={200}
        />
      </label>
      <label className="contact-field">
        <span>Telefone</span>
        <input
          name="phone"
          type="tel"
          defaultValue={contact.phone}
          required
          minLength={5}
          maxLength={32}
        />
      </label>
      <label className="contact-field">
        <span>E-mail</span>
        <input
          name="email"
          type="email"
          defaultValue={contact.email ?? ""}
          maxLength={254}
        />
      </label>
      <label className="contact-field contact-field-full">
        <span>Observações</span>
        <textarea
          name="notes"
          defaultValue={contact.notes}
          maxLength={2000}
          rows={3}
        />
      </label>
      {state.error && (
        <p className="contact-action-message is-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="contact-action-message is-success" role="status">
          {state.success}
        </p>
      )}
      <button className="primary-button" type="submit" disabled={pending}>
        {pending ? "Salvando..." : "Salvar alterações"}
      </button>
    </form>
  );
}

export function ContactRow({ contact }: { contact: ContactRowData }) {
  const [editing, setEditing] = useState(false);
  const [addingTag, setAddingTag] = useState(false);
  const consentLabels = {
    unknown: "Sem consentimento",
    opted_in: "Autorizado",
    opted_out: "Descadastrado",
  };

  return (
    <article className="contact-card">
      <div className="contact-card-top">
        <span className="contact-avatar" aria-hidden="true">
          {contact.name.slice(0, 1).toUpperCase()}
        </span>
        <div className="contact-identity">
          <strong>{contact.name}</strong>
          <span>{contact.phone}</span>
        </div>
        <span className={`consent-badge consent-${contact.consent_status}`}>
          <span />
          {consentLabels[contact.consent_status]}
        </span>
      </div>
      <div className="contact-card-details">
        <span>{contact.email || "Sem e-mail"}</span>
        <span>Adicionado em {formatDate(contact.created_at)}</span>
      </div>
      {contact.notes && (
        <p className="contact-notes" title={contact.notes}>
          {contact.notes}
        </p>
      )}
      {contact.recentMessages.length > 0 && (
        <details className="contact-history">
          <summary>Histórico de comunicação ({contact.recentMessages.length})</summary>
          <ul>
            {contact.recentMessages.map((message, index) => (
              <li key={`${message.created_at}-${index}`}>
                <span>{statusText(message.status)}</span>
                <time dateTime={message.created_at}>
                  {formatDate(message.created_at)}
                </time>
              </li>
            ))}
          </ul>
        </details>
      )}
      <div className="contact-tags" aria-label="Etiquetas">
        {contact.contact_tags.map((tag) => (
          <span className="contact-tag" key={tag.id}>
            {tag.tag_name}
            <form action={deleteContactTag}>
              <input type="hidden" name="tagId" value={tag.id} />
              <button
                type="submit"
                aria-label={`Remover etiqueta ${tag.tag_name}`}
                title="Remover etiqueta"
              >
                ×
              </button>
            </form>
          </span>
        ))}
        <button
          type="button"
          className="contact-text-button"
          onClick={() => setAddingTag((current) => !current)}
          aria-expanded={addingTag}
        >
          {addingTag ? "Fechar" : "+ Etiqueta"}
        </button>
      </div>
      <div className="contact-row-actions">
        <button
          type="button"
          className="contact-text-button"
          onClick={() => setEditing((current) => !current)}
          aria-expanded={editing}
        >
          {editing ? "Fechar edição" : "Editar"}
        </button>
        <form action={deleteContact}>
          <input type="hidden" name="id" value={contact.id} />
          <button
            type="submit"
            className="contact-text-button danger"
            onClick={(event) => {
              if (!window.confirm(`Excluir o contato ${contact.name}?`)) {
                event.preventDefault();
              }
            }}
          >
            Excluir
          </button>
        </form>
      </div>
      {addingTag && <AddContactTagForm contactId={contact.id} />}
      {editing && <EditContactForm contact={contact} />}
    </article>
  );
}

function AddContactTagForm({ contactId }: { contactId: string }) {
  const [state, formAction, pending] = useActionState<
    ContactActionState,
    FormData
  >(createContactTag, {});

  return (
    <form className="contact-tag-form" action={formAction}>
      <input type="hidden" name="contactId" value={contactId} />
      <input
        name="tagName"
        required
        maxLength={60}
        aria-label="Nome da etiqueta"
        placeholder="Nova etiqueta"
      />
      <button type="submit" className="contact-text-button" disabled={pending}>
        {pending ? "..." : "Adicionar"}
      </button>
      {state.error && (
        <p className="contact-action-message is-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="contact-action-message is-success" role="status">
          {state.success}
        </p>
      )}
    </form>
  );
}
