"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  assignSubscription,
  savePlan,
  setUserActive,
  type AdminActionState,
} from "./actions";

export type AdminPlan = {
  id: string;
  name: string;
  description: string;
  price: number;
  currency: string;
  messages_limit: number;
  campaigns_limit: number;
  contacts_limit: number;
  connections_limit: number;
  storage_limit: number;
  unlimited_messages: boolean;
  unlimited_campaigns: boolean;
  unlimited_contacts: boolean;
  unlimited_connections: boolean;
  is_active: boolean;
  sort_order: number;
};

export type AdminUser = {
  id: string;
  email: string | null;
  full_name: string | null;
  is_active: boolean;
  subscription: {
    plan_id: string;
    status: string;
    ends_at: string | null;
  } | null;
};

function ActionMessage({ state }: { state: AdminActionState }) {
  if (state.error) {
    return (
      <p className="admin-action-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="admin-action-message is-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function PlanForm({ plan }: { plan?: AdminPlan }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(savePlan, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  return (
    <form className="admin-plan-form" action={formAction}>
      {plan && <input type="hidden" name="id" value={plan.id} />}
      <label className="admin-field admin-field-wide">
        <span>Nome do plano</span>
        <input
          name="name"
          required
          maxLength={100}
          defaultValue={plan?.name ?? ""}
          placeholder="Ex.: Profissional"
        />
      </label>
      <label className="admin-field admin-field-wide">
        <span>Descrição</span>
        <textarea
          name="description"
          maxLength={1000}
          rows={2}
          defaultValue={plan?.description ?? ""}
        />
      </label>
      <label className="admin-field">
        <span>Preço</span>
        <input
          name="price"
          type="number"
          min="0"
          max="1000000000"
          step="0.01"
          required
          defaultValue={plan?.price ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Moeda</span>
        <input
          name="currency"
          required
          minLength={3}
          maxLength={3}
          defaultValue={plan?.currency ?? "BRL"}
        />
      </label>
      <label className="admin-field">
        <span>Mensagens</span>
        <input
          name="messages_limit"
          type="number"
          min="0"
          required
          defaultValue={plan?.messages_limit ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Campanhas</span>
        <input
          name="campaigns_limit"
          type="number"
          min="0"
          required
          defaultValue={plan?.campaigns_limit ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Contatos</span>
        <input
          name="contacts_limit"
          type="number"
          min="0"
          required
          defaultValue={plan?.contacts_limit ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Conexões</span>
        <input
          name="connections_limit"
          type="number"
          min="0"
          max="2147483647"
          required
          defaultValue={plan?.connections_limit ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Armazenamento (bytes)</span>
        <input
          name="storage_limit"
          type="number"
          min="0"
          required
          defaultValue={plan?.storage_limit ?? 0}
        />
      </label>
      <label className="admin-field">
        <span>Ordem</span>
        <input
          name="sort_order"
          type="number"
          min="0"
          max="2147483647"
          required
          defaultValue={plan?.sort_order ?? 0}
        />
      </label>
      <div className="admin-checkboxes admin-field-wide">
        <label>
          <input
            type="checkbox"
            name="unlimited_messages"
            value="true"
            defaultChecked={plan?.unlimited_messages ?? false}
          />
          Mensagens ilimitadas
        </label>
        <label>
          <input
            type="checkbox"
            name="unlimited_campaigns"
            value="true"
            defaultChecked={plan?.unlimited_campaigns ?? false}
          />
          Campanhas ilimitadas
        </label>
        <label>
          <input
            type="checkbox"
            name="unlimited_contacts"
            value="true"
            defaultChecked={plan?.unlimited_contacts ?? false}
          />
          Contatos ilimitados
        </label>
        <label>
          <input
            type="checkbox"
            name="unlimited_connections"
            value="true"
            defaultChecked={plan?.unlimited_connections ?? false}
          />
          Conexões ilimitadas
        </label>
        <label>
          <input
            type="checkbox"
            name="is_active"
            value="true"
            defaultChecked={plan?.is_active ?? true}
          />
          Plano ativo
        </label>
      </div>
      <ActionMessage state={state} />
      <button className="primary-button admin-submit" type="submit" disabled={pending}>
        {pending ? "Salvando..." : plan ? "Salvar plano" : "Criar plano"}
      </button>
    </form>
  );
}

function SubscriptionForm({
  user,
  plans,
}: {
  user: AdminUser;
  plans: AdminPlan[];
}) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(assignSubscription, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  const currentPlanName =
    plans.find((plan) => plan.id === user.subscription?.plan_id)?.name ??
    "Sem plano";

  return (
    <form className="admin-subscription-form" action={formAction}>
      <input type="hidden" name="user_id" value={user.id} />
      <span className="admin-current-plan">
        Atual: {currentPlanName}
        {user.subscription?.status
          ? ` (${user.subscription.status})`
          : ""}
      </span>
      <select
        name="plan_id"
        required
        defaultValue={user.subscription?.plan_id ?? ""}
        aria-label={`Plano para ${user.email ?? user.id}`}
      >
        <option value="" disabled>
          Selecione plano ativo
        </option>
        {plans
          .filter((plan) => plan.is_active)
          .map((plan) => (
            <option key={plan.id} value={plan.id}>
              {plan.name} · {plan.currency} {plan.price.toFixed(2)}
            </option>
          ))}
      </select>
      <label className="admin-field">
        <span>Nova validade <i>Vazio = sem vencimento</i></span>
        <input type="datetime-local" name="ends_at" />
      </label>
      <button
        className="connection-primary"
        type="submit"
        disabled={pending || plans.every((plan) => !plan.is_active)}
      >
        {pending ? "Atribuindo..." : "Atribuir plano"}
      </button>
      <ActionMessage state={state} />
    </form>
  );
}

function UserStatusForm({
  user,
  currentUserId,
}: {
  user: AdminUser;
  currentUserId: string;
}) {
  const [state, formAction, pending] = useActionState<
    AdminActionState,
    FormData
  >(setUserActive, {});

  return (
    <div className="admin-user-status-control">
      <span className={`admin-user-state ${user.is_active ? "is-active" : ""}`}>
        {user.is_active ? "Ativa" : "Desativada"}
      </span>
      {user.id !== currentUserId && (
        <form action={formAction}>
          <input type="hidden" name="user_id" value={user.id} />
          <input
            type="hidden"
            name="is_active"
            value={user.is_active ? "false" : "true"}
          />
          <button type="submit" className="connection-secondary" disabled={pending}>
            {pending
              ? "Salvando..."
              : user.is_active
                ? "Desativar"
                : "Ativar"}
          </button>
          <ActionMessage state={state} />
        </form>
      )}
    </div>
  );
}

export function AdminManager({
  plans,
  users,
  currentUserId,
}: {
  plans: AdminPlan[];
  users: AdminUser[];
  currentUserId: string;
}) {
  return (
    <div className="admin-layout">
      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Planos</h2>
            <p>Configure limites e disponibilidade dos planos.</p>
          </div>
        </div>
        <details className="admin-create-plan">
          <summary className="primary-button">+ Criar plano</summary>
          <PlanForm />
        </details>
        {plans.length ? (
          <div className="admin-plan-list">
            {plans.map((plan) => (
              <details className="admin-plan-card" key={plan.id}>
                <summary>
                  <span>
                    <strong>{plan.name}</strong>
                    <small>
                      {plan.currency} {plan.price.toFixed(2)} ·{" "}
                      {plan.is_active ? "Ativo" : "Inativo"}
                    </small>
                  </span>
                  <span className="admin-plan-edit">Editar</span>
                </summary>
                <PlanForm plan={plan} />
              </details>
            ))}
          </div>
        ) : (
          <div className="admin-empty">Nenhum plano cadastrado.</div>
        )}
      </section>

      <section className="admin-section">
        <div className="admin-section-heading">
          <div>
            <h2>Usuários e assinaturas</h2>
            <p>Ative contas e atribua um plano disponível.</p>
          </div>
          <span>{users.length} usuários</span>
        </div>
        {users.length ? (
          <div className="admin-user-list">
            {users.map((user) => (
              <article className="admin-user-card" key={user.id}>
                <div className="admin-user-heading">
                  <span className="admin-user-avatar">
                    {(user.full_name || user.email || "?")
                      .slice(0, 1)
                      .toUpperCase()}
                  </span>
                  <span>
                    <strong>{user.full_name || "Sem nome cadastrado"}</strong>
                    <small>{user.email ?? user.id}</small>
                  </span>
                  <UserStatusForm user={user} currentUserId={currentUserId} />
                </div>
                <SubscriptionForm user={user} plans={plans} />
              </article>
            ))}
          </div>
        ) : (
          <div className="admin-empty">Nenhum usuário encontrado.</div>
        )}
      </section>
    </div>
  );
}
