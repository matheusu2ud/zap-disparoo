import "server-only";

import {
  buildPoseidonSubscriptionPixPayload,
  getSafePoseidonProviderError,
  parsePoseidonSubscriptionLookup,
  type PoseidonSubscriptionLookup,
  type PoseidonSubscriptionPixPayload,
} from "@/lib/poseidonpay-utils";

type JsonRecord = Record<string, unknown>;

export type PoseidonPixResponse = {
  transactionId: string;
  status: "OK" | "PENDING";
  transactionStatus: string | null;
  orderId: string;
  orderUrl: string | null;
  subscriptionId: string;
  pixCode: string | null;
  pixExpiresAt: string | null;
};

export class PoseidonPayError extends Error {
  constructor(
    message: string,
    readonly requiresManualReview: boolean,
  ) {
    super(message);
    this.name = "PoseidonPayError";
  }
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeHttpsUrl(value: unknown) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

function getCredentials() {
  const publicKey = process.env.POSEIDONPAY_PUBLIC_KEY?.trim();
  const secretKey = process.env.POSEIDONPAY_SECRET_KEY?.trim();
  if (!publicKey || !secretKey) {
    throw new PoseidonPayError(
      "Configure as chaves da PoseidonPay no ambiente do servidor.",
      false,
    );
  }
  return { publicKey, secretKey };
}

export async function createPoseidonSubscriptionPix(input: {
  identifier: string;
  planId: string;
  planName: string;
  amount: number;
  clientName: string;
  email: string;
  phone: string;
  document: string;
}): Promise<PoseidonPixResponse> {
  const credentials = getCredentials();
  const body: PoseidonSubscriptionPixPayload =
    buildPoseidonSubscriptionPixPayload(input);
  let response: Response;

  try {
    response = await fetch(
      "https://app.poseidonpay.site/api/v1/gateway/pix/subscription",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-public-key": credentials.publicKey,
          "x-secret-key": credentials.secretKey,
        },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      },
    );
  } catch {
    throw new PoseidonPayError(
      "A resposta da PoseidonPay não chegou. Confira a cobrança pelo identificador antes de tentar novamente.",
      true,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PoseidonPayError(
      response.ok
        ? "A resposta da PoseidonPay não pôde ser validada. A cobrança precisa de conferência manual."
        : "A PoseidonPay retornou uma resposta inválida.",
      response.ok || response.status >= 500,
    );
  }

  if (!response.ok) {
    const providerError = getSafePoseidonProviderError(payload);
    if (response.status < 500) {
      throw new PoseidonPayError(
        `A PoseidonPay recusou a cobrança (HTTP ${response.status}). ${
          providerError ??
          "Revise se o produto está configurado na PoseidonPay e se os dados do plano e da conta estão corretos."
        }`,
        false,
      );
    }
    throw new PoseidonPayError(
      "A PoseidonPay apresentou uma falha. Confira a cobrança antes de tentar novamente.",
      true,
    );
  }

  const root = isRecord(payload) ? payload : null;
  const order = isRecord(root?.order) ? root.order : null;
  const subscription = isRecord(root?.subscription)
    ? root.subscription
    : null;
  const pix = isRecord(root?.pix) ? root.pix : null;
  const status =
    typeof root?.status === "string" ? root.status.toUpperCase() : "";
  const transactionId =
    typeof root?.transactionId === "string" ? root.transactionId : "";
  const orderId = typeof order?.id === "string" ? order.id : "";
  const subscriptionId =
    typeof subscription?.id === "string" ? subscription.id : "";
  const pixCode = typeof pix?.code === "string" ? pix.code : null;

  if (!transactionId || !orderId || !subscriptionId) {
    throw new PoseidonPayError(
      "A PoseidonPay respondeu, mas os dados da cobrança estão incompletos. Confira manualmente antes de tentar novamente.",
      true,
    );
  }
  if (status === "FAILED" || status === "REJECTED" || status === "CANCELED") {
    throw new PoseidonPayError(
      "A PoseidonPay não conseguiu criar a cobrança Pix.",
      false,
    );
  }
  if (status !== "OK" && status !== "PENDING") {
    throw new PoseidonPayError(
      "A PoseidonPay retornou um estado não reconhecido. A cobrança precisa de conferência manual.",
      true,
    );
  }

  const transactionStatus =
    typeof root?.transactionStatus === "string"
      ? root.transactionStatus.toUpperCase()
      : null;
  const orderUrl = safeHttpsUrl(order?.url);
  const expiresAt =
    typeof pix?.expiresAt === "string" &&
    Number.isFinite(Date.parse(pix.expiresAt))
      ? new Date(pix.expiresAt).toISOString()
      : null;

  return {
    transactionId,
    status,
    transactionStatus,
    orderId,
    orderUrl,
    subscriptionId,
    pixCode: pixCode && pixCode.length <= 4096 ? pixCode : null,
    pixExpiresAt: expiresAt,
  };
}

export async function getPoseidonSubscriptionStatus(input: {
  subscriptionId: string | null;
  identifier: string;
  planId: string;
}): Promise<PoseidonSubscriptionLookup> {
  const credentials = getCredentials();
  const query = new URLSearchParams({
    clientIdentifier: input.identifier,
  });
  if (input.subscriptionId) {
    query.set("subscriptionId", input.subscriptionId);
  }
  let response: Response;

  try {
    response = await fetch(
      `https://app.poseidonpay.site/api/v1/gateway/subscriptions?${query.toString()}`,
      {
        method: "GET",
        headers: {
          accept: "application/json",
          "x-public-key": credentials.publicKey,
          "x-secret-key": credentials.secretKey,
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch {
    throw new PoseidonPayError(
      "Não foi possível consultar a assinatura na PoseidonPay. Tente novamente.",
      true,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PoseidonPayError(
      "A resposta de consulta da PoseidonPay está inválida. Tente novamente mais tarde.",
      response.status >= 500,
    );
  }

  if (!response.ok) {
    throw new PoseidonPayError(
      response.status >= 500
        ? "A PoseidonPay está temporariamente indisponível. Tente novamente."
        : "A PoseidonPay recusou a consulta. Confira as credenciais e tente novamente.",
      response.status >= 500,
    );
  }

  return parsePoseidonSubscriptionLookup(
    payload,
    input.subscriptionId,
    input.planId,
  );
}
