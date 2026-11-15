"use client";

import { useActionState, useEffect, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import {
  selectFreePlan,
  resolveRejectedPoseidonCharge,
  startPixCheckout,
  verifyPoseidonSubscription,
  type BillingActionState,
  type BillingPayment,
  type BillingVerificationState,
} from "./actions";

export type BillingPlan = {
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
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value);
}

function displayPlanName(value: string) {
  return value.replace(/^BROADCAST HUB - /, "");
}

function formatPlanLimit(
  value: number,
  unlimited: boolean,
  singular: string,
  plural: string,
) {
  return unlimited
    ? `Sem limite de ${plural}`
    : `${value.toLocaleString("pt-BR")} ${value === 1 ? singular : plural}`;
}

function formatStorage(value: number) {
  const gigabyte = 1024 ** 3;
  return value >= gigabyte
    ? `${value / gigabyte} GB`
    : `${value / 1024 ** 2} MB`;
}

function getPlanBenefits(plan: BillingPlan) {
  return [
    formatPlanLimit(
      plan.messages_limit,
      plan.unlimited_messages,
      "mensagem/mês",
      "mensagens/mês",
    ),
    formatPlanLimit(
      plan.campaigns_limit,
      plan.unlimited_campaigns,
      "campanha/mês",
      "campanhas/mês",
    ),
    formatPlanLimit(plan.contacts_limit, plan.unlimited_contacts, "contato", "contatos"),
    formatPlanLimit(
      plan.connections_limit,
      plan.unlimited_connections,
      "conexão WhatsApp",
      "conexões WhatsApp",
    ),
    `${formatStorage(plan.storage_limit)} de armazenamento`,
  ];
}

function PaymentDetails({
  payment,
  rejectionCheck,
  rejectionAction,
  checkingRejection,
}: {
  payment: BillingPayment;
  rejectionCheck: BillingVerificationState;
  rejectionAction: (formData: FormData) => void;
  checkingRejection: boolean;
}) {
  const router = useRouter();
  const [copyMessage, setCopyMessage] = useState("");
  const [qrCodeResult, setQrCodeResult] = useState<
    | { pixCode: string; dataUrl: string }
    | { pixCode: string; error: true }
    | null
  >(null);
  const [verification, verifyAction, verifying] = useActionState<
    BillingVerificationState,
    FormData
  >(verifyPoseidonSubscription, {});

  useEffect(() => {
    if (
      verification.result?.status === "confirmed" ||
      verification.result?.status === "canceled"
    ) {
      router.refresh();
    }
  }, [router, verification.result?.status]);

  useEffect(() => {
    let active = true;
    const pixCode = payment.pixCode;
    if (pixCode) {
      QRCode.toDataURL(pixCode, {
        errorCorrectionLevel: "M",
        margin: 2,
        width: 240,
      }).then(
        (dataUrl) => {
          if (active) setQrCodeResult({ pixCode, dataUrl });
        },
        () => {
          if (active) setQrCodeResult({ pixCode, error: true });
        },
      );
    }
    return () => {
      active = false;
    };
  }, [payment.pixCode]);

  const currentQrCode =
    qrCodeResult?.pixCode === payment.pixCode ? qrCodeResult : null;

  const statusLabel =
    payment.status === "confirmed"
      ? "ASSINATURA ATIVA"
      : payment.status === "manual_review"
        ? "VERIFICAÇÃO NECESSÁRIA"
        : "AGUARDANDO PAGAMENTO";

  async function copyPixCode() {
    if (!payment.pixCode) return;
    try {
      await navigator.clipboard.writeText(payment.pixCode);
      setCopyMessage("Código Pix copiado.");
    } catch {
      setCopyMessage("Não foi possível copiar. Selecione e copie o código manualmente.");
    }
  }

  return (
    <section className="billing-payment" aria-labelledby="billing-payment-title">
      <div className="billing-payment-heading">
        <div>
          <span
            className={`billing-payment-status billing-status-${payment.status}`}
          >
            {statusLabel}
          </span>
          <h2 id="billing-payment-title">{payment.planName}</h2>
        </div>
        <strong>{formatCurrency(payment.amount)}<small>/mês</small></strong>
      </div>
      <p>
        Use o Pix copia e cola no aplicativo do seu banco. O identificador desta
        cobrança é <code>{payment.identifier}</code>.
      </p>
      {payment.status === "confirmed" ? (
        <p className="billing-payment-confirmed">
          A PoseidonPay confirmou que esta assinatura está ativa.
        </p>
      ) : payment.pixCode ? (
        <>
          {currentQrCode && "dataUrl" in currentQrCode ? (
            <div className="billing-pix-qr">
              <Image
                src={currentQrCode.dataUrl}
                alt="QR Code Pix para pagar a assinatura"
                width={240}
                height={240}
                unoptimized
              />
              <span>Escaneie o QR Code com o aplicativo do seu banco.</span>
            </div>
          ) : currentQrCode && "error" in currentQrCode ? (
            <p className="billing-error" role="alert">
              Não foi possível gerar a imagem do QR Code. Use o Pix copia e cola abaixo.
            </p>
          ) : (
            <p className="billing-pix-qr-status" role="status">
              Gerando QR Code Pix...
            </p>
          )}
          <label className="billing-field">
            <span>Código Pix copia e cola</span>
            <textarea
              readOnly
              rows={4}
              value={payment.pixCode}
              onFocus={(event) => event.currentTarget.select()}
              aria-label="Código Pix copia e cola"
            />
          </label>
          <button
            className="primary-button billing-copy-button"
            type="button"
            onClick={copyPixCode}
          >
            Copiar código Pix
          </button>
          {copyMessage && (
            <p className="billing-copy-message" role="status">
              {copyMessage}
            </p>
          )}
        </>
      ) : (
        <p className="billing-warning" role="status">
          Esta cobrança não tem código Pix visível. Use a verificação abaixo;
          não gere outra cobrança.
        </p>
      )}
      {payment.pixExpiresAt && (
        <p className="billing-expiry">
          Vencimento informado pela PoseidonPay:{" "}
          {new Intl.DateTimeFormat("pt-BR", {
            dateStyle: "short",
            timeStyle: "short",
          }).format(new Date(payment.pixExpiresAt))}
        </p>
      )}
      {payment.checkoutUrl && (
        <a
          className="billing-checkout-link"
          href={payment.checkoutUrl}
          target="_blank"
          rel="noreferrer"
        >
          Abrir página de pagamento da PoseidonPay
        </a>
      )}
      <form className="billing-verify-form" action={verifyAction}>
        <input type="hidden" name="intent_id" value={payment.id} />
        {verification.error && (
          <p className="billing-error" role="alert">
            {verification.error}
          </p>
        )}
        {verification.result && (
          <p
            className={`billing-verification-result result-${verification.result.status}`}
            role="status"
          >
            {verification.result.message}
          </p>
        )}
        <button
          className="connection-secondary"
          type="submit"
          disabled={verifying}
        >
          {verifying
            ? "Consultando PoseidonPay..."
            : payment.status === "confirmed"
              ? "Atualizar status da assinatura"
              : "Já paguei — verificar na PoseidonPay"}
        </button>
      </form>
      {payment.status === "manual_review" && (
        <form className="billing-verify-form" action={rejectionAction}>
          <input type="hidden" name="intent_id" value={payment.id} />
          <input type="hidden" name="identifier" value={payment.identifier} />
          <label className="billing-rejection-confirm">
            <input
              type="checkbox"
              name="confirm_not_found"
              required
              disabled={checkingRejection}
            />
            <span>
              Verifiquei as transações e assinaturas na PoseidonPay e não
              encontrei esta cobrança. Sei que devo confirmar isso antes de
              liberar uma nova tentativa.
            </span>
          </label>
          {rejectionCheck.error && (
            <p className="billing-error" role="alert">
              {rejectionCheck.error}
            </p>
          )}
          <button
            className="billing-rejection-submit"
            type="submit"
            disabled={checkingRejection}
          >
            {checkingRejection
              ? "Encerrando tentativa anterior..."
              : "Confirmar que não existe e liberar nova tentativa"}
          </button>
        </form>
      )}
    </section>
  );
}

export function BillingManager({
  plans,
  freePlan,
  onboarding,
  returnTo,
  selectedPlanId,
  buyerName,
  buyerEmail,
  buyerCpf,
  initialPayment,
  blocked,
}: {
  plans: BillingPlan[];
  freePlan: BillingPlan | null;
  onboarding: boolean;
  returnTo: string;
  selectedPlanId?: string;
  buyerName: string;
  buyerEmail: string;
  buyerCpf: string;
  initialPayment: BillingPayment | null;
  blocked: boolean;
}) {
  const [state, formAction, pending] = useActionState<
    BillingActionState,
    FormData
  >(startPixCheckout, {});
  const [freeState, freeFormAction, selectingFree] = useActionState<
    BillingActionState,
    FormData
  >(selectFreePlan, {});
  const [rejectionCheck, rejectionAction, checkingRejection] = useActionState<
    BillingVerificationState,
    FormData
  >(resolveRejectedPoseidonCharge, {});
  const payment = state.payment ?? initialPayment;

  if (onboarding) {
    const availablePlans = [...(freePlan ? [freePlan] : []), ...plans];

    return (
      <div className="billing-onboarding">
        {payment && (
          <PaymentDetails
            payment={payment}
            rejectionCheck={rejectionCheck}
            rejectionAction={rejectionAction}
            checkingRejection={checkingRejection}
          />
        )}
        <div className="billing-plan-grid" id="billing-plan-selection">
          {availablePlans.map((plan) => {
            const isFree = Number(plan.price) === 0;
            return (
              <article
                className={`billing-plan-card${isFree ? " billing-plan-free" : ""}${selectedPlanId === plan.id ? " billing-plan-selected" : ""}`}
                key={plan.id}
              >
                <header>
                  <h2>{displayPlanName(plan.name)}</h2>
                  {selectedPlanId === plan.id && (
                    <span className="billing-plan-selected-label">
                      SEU PLANO
                    </span>
                  )}
                  <strong>
                    {isFree ? "Grátis" : formatCurrency(Number(plan.price))}
                    {!isFree && <small>/mês</small>}
                  </strong>
                </header>
                <p>{plan.description}</p>
                <ul>
                  {getPlanBenefits(plan).map((benefit) => (
                    <li key={benefit}>{benefit}</li>
                  ))}
                </ul>
                {isFree ? (
                  <form action={freeFormAction}>
                    <input type="hidden" name="return_to" value={returnTo} />
                    {freeState.error && (
                      <p className="billing-error" role="alert">
                        {freeState.error}
                      </p>
                    )}
                    <button
                      className="connection-secondary billing-plan-button"
                      type="submit"
                      disabled={selectingFree || blocked}
                    >
                      {selectingFree
                        ? "Ativando plano..."
                        : selectedPlanId === plan.id
                          ? "Continuar com Grátis"
                          : "Escolher Grátis"}
                    </button>
                  </form>
                ) : (
                  <form action={formAction}>
                    <input type="hidden" name="plan_id" value={plan.id} />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <label className="billing-field">
                      <span>Nome completo</span>
                      <input
                        name="name"
                        autoComplete="name"
                        required
                        minLength={2}
                        maxLength={200}
                        defaultValue={buyerName}
                      />
                    </label>
                    <label className="billing-field">
                      <span>E-mail da conta</span>
                      <input
                        name="email"
                        type="email"
                        autoComplete="email"
                        required
                        readOnly
                        value={buyerEmail}
                      />
                    </label>
                    <label className="billing-field">
                      <span>CPF</span>
                      <input
                        name="cpf"
                        inputMode="numeric"
                        autoComplete="off"
                        placeholder="000.000.000-00"
                        required
                        minLength={11}
                        maxLength={14}
                        defaultValue={buyerCpf}
                      />
                    </label>
                    <label className="billing-field">
                      <span>Telefone</span>
                      <input
                        type="tel"
                        name="phone"
                        autoComplete="tel"
                        required
                        maxLength={25}
                        placeholder="(11) 99999-9999"
                      />
                    </label>
                    {state.error && (
                      <p className="billing-error" role="alert">
                        {state.error}
                      </p>
                    )}
                    <button
                      className="primary-button billing-plan-button"
                      type="submit"
                      disabled={pending || blocked}
                    >
                      {pending
                        ? "Preparando Pix..."
                        : selectedPlanId === plan.id
                          ? `Continuar com ${displayPlanName(plan.name)}`
                          : "Escolher e pagar com Pix"}
                    </button>
                  </form>
                )}
              </article>
            );
          })}
        </div>
        {!availablePlans.length && (
          <p className="billing-empty">
            Nenhum plano está disponível no momento. Avise o administrador.
          </p>
        )}
        {plans.length > 0 && (
          <p className="billing-onboarding-note">
            O acesso ao plano pago é liberado somente depois que a PoseidonPay
            confirmar o pagamento. O Grátis é ativado imediatamente.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="billing-layout">
      {payment && (
        <PaymentDetails
          payment={payment}
          rejectionCheck={rejectionCheck}
          rejectionAction={rejectionAction}
          checkingRejection={checkingRejection}
        />
      )}

      <section className="billing-panel" id="billing-plan-selection">
        <div className="billing-panel-heading">
          <h2>Escolha seu plano</h2>
          <p>Os planos pagos são cobrados mensalmente em reais.</p>
        </div>
        {freePlan && (
          <article className="billing-free-plan">
            <div>
              <strong>{displayPlanName(freePlan.name)}</strong>
              <span>{formatCurrency(Number(freePlan.price))}/mês</span>
            </div>
            <p>{freePlan.description}</p>
            <small>
              Escolha este plano para ativá-lo sem cobrança Pix.
            </small>
          </article>
        )}
        {plans.length ? (
          <form action={formAction} className="billing-form">
            <label className="billing-field">
              <span>Plano</span>
              <select
                name="plan_id"
                required
                defaultValue={
                  selectedPlanId && plans.some((plan) => plan.id === selectedPlanId)
                    ? selectedPlanId
                    : plans[0].id
                }
              >
                {plans.map((plan) => (
                  <option value={plan.id} key={plan.id}>
                    {displayPlanName(plan.name)} ·{" "}
                    {formatCurrency(Number(plan.price))}/mês
                  </option>
                ))}
              </select>
            </label>
            <label className="billing-field">
              <span>Nome completo</span>
              <input
                name="name"
                autoComplete="name"
                required
                minLength={2}
                maxLength={200}
                defaultValue={buyerName}
              />
            </label>
            <label className="billing-field">
              <span>E-mail da conta</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                required
                readOnly
                value={buyerEmail}
              />
            </label>
            <label className="billing-field">
              <span>CPF</span>
              <input
                name="cpf"
                inputMode="numeric"
                autoComplete="off"
                placeholder="000.000.000-00"
                required
                minLength={11}
                maxLength={14}
                defaultValue={buyerCpf}
              />
            </label>
            <label className="billing-field">
              <span>Telefone</span>
              <input
                type="tel"
                name="phone"
                autoComplete="tel"
                required
                maxLength={25}
                placeholder="(11) 99999-9999"
              />
            </label>
            {state.error && (
              <p className="billing-error" role="alert">
                {state.error}
              </p>
            )}
            <button
              className="primary-button billing-submit"
              type="submit"
              disabled={pending || blocked}
            >
              {pending
                ? "Preparando Pix..."
                : payment?.status === "pending"
                  ? "Atualizar pagamento Pix"
                  : "Gerar cobrança Pix"}
            </button>
          </form>
        ) : (
          <p className="billing-empty">
            Nenhum plano pago ativo está disponível no momento. Peça ao
            administrador para cadastrar um plano em reais.
          </p>
        )}
      </section>
    </div>
  );
}
