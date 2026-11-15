"use client";

import { useActionState } from "react";
import { importContacts, type ContactActionState } from "./actions";

export function ImportContactsForm() {
  const [state, formAction, pending] = useActionState<
    ContactActionState,
    FormData
  >(importContacts, {});

  return (
    <details className="contact-import-disclosure">
      <summary className="secondary-button">Importar CSV</summary>
      <form className="contact-import-form" action={formAction}>
        <label className="contact-field">
          <span>Arquivo CSV</span>
          <input
            type="file"
            name="file"
            accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            required
            aria-describedby="csv-format-hint"
          />
        </label>
        <span id="csv-format-hint" className="csv-format-hint">
          CSV ou Excel (.xlsx). Cabeçalhos obrigatórios: nome, telefone.
          Opcionais: email, observacoes. Até 500 linhas; duplicados são
          ignorados.
        </span>
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
          {pending ? "Importando..." : "Importar contatos"}
        </button>
      </form>
    </details>
  );
}
