"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createTemplate,
  deleteTemplate,
  updateTemplate,
  type TemplateActionState,
} from "./actions";

export type TemplateRow = {
  id: string;
  name: string;
  category: string;
  body: string;
  created_at: string;
  updated_at: string;
};

function ActionMessage({ state }: { state: TemplateActionState }) {
  if (state.error) {
    return (
      <p className="library-action-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="library-action-message is-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

export function NewTemplateForm() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    TemplateActionState,
    FormData
  >(createTemplate, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <details className="library-create-disclosure">
      <summary className="primary-button">
        <span aria-hidden="true">+</span>
        Novo template
      </summary>
      <form className="library-create-form" action={formAction}>
        <h2>Criar template</h2>
        <p>Salve uma mensagem para reutilizar em suas campanhas.</p>
        <label className="library-field">
          <span>Nome</span>
          <input name="name" required maxLength={160} placeholder="Ex.: Boas-vindas" />
        </label>
        <label className="library-field">
          <span>Categoria</span>
          <select name="category" defaultValue="general">
            <option value="general">Geral</option>
            <option value="marketing">Marketing</option>
            <option value="utility">Utilidade</option>
            <option value="support">Atendimento</option>
          </select>
        </label>
        <label className="library-field">
          <span>Mensagem</span>
          <textarea
            name="body"
            rows={5}
            maxLength={5000}
            placeholder="Escreva sua mensagem..."
          />
        </label>
        <ActionMessage state={state} />
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Salvando..." : "Salvar template"}
        </button>
      </form>
    </details>
  );
}

export function TemplateCard({ template }: { template: TemplateRow }) {
  const router = useRouter();
  const [updateState, updateAction, updating] = useActionState<
    TemplateActionState,
    FormData
  >(updateTemplate, {});
  const [deleteState, deleteAction, deleting] = useActionState<
    TemplateActionState,
    FormData
  >(deleteTemplate, {});

  useEffect(() => {
    if (updateState.success || deleteState.success) router.refresh();
  }, [deleteState.success, router, updateState.success]);

  return (
    <article className="template-card">
      <div className="template-card-heading">
        <span className="template-category">{template.category}</span>
        <span className="template-updated">
          Atualizado{" "}
          {new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(new Date(template.updated_at))}
        </span>
      </div>
      <details className="template-edit-disclosure">
        <summary>
          <span className="template-card-title">{template.name}</span>
          <span className="template-preview">
            {template.body || "Este template ainda não tem conteúdo."}
          </span>
          <span className="template-edit-label">Editar template</span>
        </summary>
        <form className="template-edit-form" action={updateAction}>
          <input type="hidden" name="id" value={template.id} />
          <label className="library-field">
            <span>Nome</span>
            <input
              name="name"
              required
              maxLength={160}
              defaultValue={template.name}
            />
          </label>
          <label className="library-field">
            <span>Categoria</span>
            <select name="category" defaultValue={template.category}>
              {!["general", "marketing", "utility", "support"].includes(
                template.category,
              ) && (
                <option value={template.category}>{template.category}</option>
              )}
              <option value="general">Geral</option>
              <option value="marketing">Marketing</option>
              <option value="utility">Utilidade</option>
              <option value="support">Atendimento</option>
            </select>
          </label>
          <label className="library-field">
            <span>Mensagem</span>
            <textarea
              name="body"
              rows={5}
              maxLength={5000}
              defaultValue={template.body}
            />
          </label>
          <button className="connection-primary" type="submit" disabled={updating}>
            {updating ? "Salvando..." : "Salvar alterações"}
          </button>
        </form>
      </details>
      <ActionMessage state={updateState} />
      <form
        className="template-delete-form"
        action={deleteAction}
        onSubmit={(event) => {
          if (!window.confirm(`Excluir o template "${template.name}"?`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={template.id} />
        <button type="submit" className="connection-danger" disabled={deleting}>
          {deleting ? "Excluindo..." : "Excluir"}
        </button>
      </form>
      <ActionMessage state={deleteState} />
    </article>
  );
}
