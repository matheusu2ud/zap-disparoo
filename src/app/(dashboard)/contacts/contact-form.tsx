"use client";

import { useActionState } from "react";
import { CheckCircle2, AlertCircle } from "lucide-react";
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
            <p>Adicione um novo número para enviar mensagens e campanhas.</p>
          </div>
        </div>
        <div className="contact-form-grid">
          <label className="contact-field">
            <span>Nome</span>
            <input name="name" required maxLength={200} autoComplete="name" placeholder="Ex.: Maria Silva" />
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
            <textarea name="notes" maxLength={2000} rows={3} placeholder="Anotações sobre o cliente..." />
          </label>
          <div className="contact-field-full">
            <label className="contact-consent-checkbox-label">
              <input type="checkbox" name="autoConsent" defaultChecked />
              <span>
                <strong>Autorizar para campanhas</strong> (Recomendado para poder selecionar nas campanhas de disparo)
              </span>
            </label>
          </div>
        </div>
        {state.error && (
          <div className="contact-action-message is-error" role="alert">
            <AlertCircle size={15} />
            <span>{state.error}</span>
          </div>
        )}
        {state.success && (
          <div className="contact-action-message is-success" role="status">
            <CheckCircle2 size={15} />
            <span>{state.success}</span>
          </div>
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
