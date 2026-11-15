"use client";

import Image from "next/image";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  createConnection,
  deleteConnection,
  disconnectConnection,
  generateConnectionQr,
  refreshConnectionStatus,
  type ConnectionActionState,
} from "./actions";

export type ConnectionRow = {
  id: string;
  label: string;
  phone_number: string | null;
  status: "disconnected" | "connecting" | "connected" | "error";
  created_at: string;
};

const statusLabels: Record<ConnectionRow["status"], string> = {
  disconnected: "Desconectado",
  connecting: "Aguardando QR Code",
  connected: "Conectado",
  error: "Erro de conexão",
};

function ActionMessage({ state }: { state: ConnectionActionState }) {
  if (state.error) {
    return (
      <p className="connection-action-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="connection-action-message is-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function QrCode({ value }: { value?: string }) {
  if (!value) return null;
  return (
    <div className="connection-qr">
      <p>Abra o WhatsApp no celular e escaneie este QR Code.</p>
      <Image
        src={value}
        alt="QR Code para conectar a conta WhatsApp"
        width={220}
        height={220}
        unoptimized
      />
      <small>O QR Code é temporário. Atualize-o se expirar.</small>
    </div>
  );
}

export function NewConnectionForm({
  atLimit,
}: {
  atLimit: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    ConnectionActionState,
    FormData
  >(createConnection, {});

  return (
    <details className="connection-create-disclosure">
      <summary className="primary-button" aria-disabled={atLimit}>
        <span aria-hidden="true">+</span>
        Nova conexão
      </summary>
      <form className="connection-create-form" action={formAction}>
        <h2>Conectar WhatsApp</h2>
        <p>Crie uma instância e escaneie o QR Code com o WhatsApp.</p>
        <label className="connection-field">
          <span>Nome da conexão</span>
          <input
            name="label"
            required
            maxLength={100}
            placeholder="Ex.: Atendimento"
            disabled={atLimit || pending}
          />
        </label>
        {atLimit && (
          <p className="connection-action-message is-error" role="status">
            O limite de conexões do seu plano foi atingido.
          </p>
        )}
        <ActionMessage state={state} />
        <button className="primary-button" type="submit" disabled={atLimit || pending}>
          {pending ? "Criando instância..." : "Criar conexão"}
        </button>
        <QrCode value={state.qrCode} />
      </form>
    </details>
  );
}

export function ConnectionManager({
  connection,
}: {
  connection: ConnectionRow;
}) {
  const router = useRouter();
  const [qrState, qrAction, qrPending] = useActionState<
    ConnectionActionState,
    FormData
  >(generateConnectionQr, {});
  const [statusState, statusAction, statusPending] = useActionState<
    ConnectionActionState,
    FormData
  >(refreshConnectionStatus, {});
  const [disconnectState, disconnectAction, disconnectPending] = useActionState<
    ConnectionActionState,
    FormData
  >(disconnectConnection, {});
  const [deleteState, deleteAction, deletePending] = useActionState<
    ConnectionActionState,
    FormData
  >(deleteConnection, {});

  useEffect(() => {
    const hasSuccess =
      statusState.success || disconnectState.success || deleteState.success;
    if (hasSuccess) router.refresh();
  }, [
    deleteState.success,
    disconnectState.success,
    router,
    statusState.success,
  ]);

  return (
    <article className="connection-card">
      <div className="connection-card-top">
        <span className="connection-card-icon" aria-hidden="true">WA</span>
        <div className="connection-card-copy">
          <strong>{connection.label}</strong>
          <span>{connection.phone_number ?? "Número não identificado"}</span>
        </div>
        <span className={`connection-state state-${connection.status}`}>
          <i />
          {statusLabels[connection.status]}
        </span>
      </div>
      <div className="connection-card-meta">
        Criada em{" "}
        {new Intl.DateTimeFormat("pt-BR", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(connection.created_at))}
      </div>
      <div className="connection-card-actions">
        <form action={statusAction}>
          <input type="hidden" name="id" value={connection.id} />
          <button type="submit" className="connection-secondary" disabled={statusPending}>
            {statusPending ? "Consultando..." : "Atualizar status"}
          </button>
        </form>
        {connection.status !== "connected" && (
          <form action={qrAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button type="submit" className="connection-primary" disabled={qrPending}>
              {qrPending
                ? "Gerando..."
                : qrState.qrCode
                  ? "Atualizar QR"
                  : "Gerar QR"}
            </button>
          </form>
        )}
        {connection.status === "connected" && (
          <form action={disconnectAction}>
            <input type="hidden" name="id" value={connection.id} />
            <button
              type="submit"
              className="connection-secondary"
              disabled={disconnectPending}
            >
              {disconnectPending ? "Desconectando..." : "Desconectar"}
            </button>
          </form>
        )}
        <form
          action={deleteAction}
          onSubmit={(event) => {
            if (
              !window.confirm(
                `Excluir a conexão "${connection.label}" e sua instância?`,
              )
            ) {
              event.preventDefault();
            }
          }}
        >
          <input type="hidden" name="id" value={connection.id} />
          <button type="submit" className="connection-danger" disabled={deletePending}>
            {deletePending ? "Excluindo..." : "Excluir"}
          </button>
        </form>
      </div>
      <ActionMessage state={qrState} />
      <ActionMessage state={statusState} />
      <ActionMessage state={disconnectState} />
      <ActionMessage state={deleteState} />
      <QrCode value={qrState.qrCode} />
    </article>
  );
}
