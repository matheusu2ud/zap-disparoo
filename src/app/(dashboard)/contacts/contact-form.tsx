"use client";

import { useActionState } from "react";
import { createContact, type ContactActionState } from "./actions";

export function NewContactForm() {
  const [state, formAction, pending] = useActionState<
    ContactActionState,
    FormData
  >(createContact, {});

  return (
    <details className="contact-form-disclosure">
      <summary className="primary-button">
        <span aria-hidden="true">+</span>
        Novo contato
      </summary>
      <form className="contact-form" action={formAction}>
        <div className="contact-form-heading">
          <div>
            <h2>Cadastrar contato</h2>
            <p>Contato novo começa sem autorização para receber mensagens.</p>
          </div>
        </div>
        <div className="contact-form-grid">
          <label className="contact-field">
            <span>Nome</span>
            <input name="name" required maxLength={200} autoComplete="name" />
          </label>
          <label className="contact-field">
            <span>Telefone</span>
            <input
              name="phone"
              type="tel"
              required
              minLength={5}
              maxLength={32}
              autoComplete="tel"
              placeholder="+55 11 99999-9999"
            />
          </label>
          <label className="contact-field">
            <span>E-mail <i>Opcional</i></span>
            <input
              name="email"
              type="email"
              maxLength={254}
              autoComplete="email"
              placeholder="contato@exemplo.com"
            />
          </label>
          <label className="contact-field contact-field-full">
            <span>Observações <i>Opcional</i></span>
            <textarea name="notes" maxLength={2000} rows={3} />
          </label>
        </div>
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
        <div className="contact-form-actions">
          <button className="secondary-button" type="reset">
            Limpar
          </button>
          <button className="primary-button" type="submit" disabled={pending}>
            {pending ? "Salvando..." : "Salvar contato"}
          </button>
        </div>
      </form>
    </details>
  );
}
