export type PoseidonSubscriptionPixPayload = {
  identifier: string;
  amount: number;
  product: {
    id: string;
    name: string;
    quantity: 1;
    price: number;
  };
  subscription: {
    periodicityType: "MONTHS";
    periodicity: 1;
    firstChargeIn: 0;
  };
  client: {
    name: string;
    email: string;
    phone: string;
    document: string;
  };
  metadata: {
    provider: "broadcast-hub";
    orderId: string;
  };
};

export type PoseidonSubscriptionStatus = {
  id: string;
  status: "ACTIVE" | "INACTIVE" | "CANCELED";
  intervalType: string;
  intervalCount: number;
  productIds: string[];
};

export type PoseidonSubscriptionLookup =
  | { kind: "missing" }
  | { kind: "invalid" }
  | { kind: "mismatch" }
  | { kind: "subscription"; subscription: PoseidonSubscriptionStatus };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeProviderText(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[e-mail ocultado]")
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, "[CPF ocultado]")
    .replace(/\+?\d[\d\s().-]{8,}\d/g, "[número ocultado]")
    .replace(/\b(?:secret|token|api[_ -]?key)\s*[:=]\s*\S+/gi, "[credencial ocultada]")
    .replace(/\s+/g, " ")
    .trim();
}

function sanitizeProviderDetails(value: unknown, key = ""): unknown {
  if (
    /email|phone|cpf|secret|token|authorization|password|api[_ -]?key/i.test(
      key,
    )
  ) {
    return "[ocultado]";
  }
  if (typeof value === "string") return sanitizeProviderText(value);
  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeProviderDetails(item));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 20)
        .map(([childKey, childValue]) => [
          childKey.slice(0, 60),
          sanitizeProviderDetails(childValue, childKey),
        ]),
    );
  }
  return typeof value === "number" || typeof value === "boolean"
    ? value
    : null;
}

export function getSafePoseidonProviderError(payload: unknown) {
  if (!isRecord(payload)) return null;

  const nestedError = isRecord(payload.error) ? payload.error : null;
  const candidate = [
    payload.message,
    typeof payload.error === "string" ? payload.error : null,
    nestedError?.message,
  ].find((value): value is string => typeof value === "string");
  const message = candidate ? sanitizeProviderText(candidate) : "";
  const details =
    payload.details ??
    payload.errors ??
    payload.issues ??
    payload.validationErrors ??
    nestedError?.details ??
    nestedError?.errors ??
    nestedError?.issues ??
    nestedError?.validationErrors;
  let detailText = "";
  if (details !== undefined) {
    try {
      detailText = JSON.stringify(sanitizeProviderDetails(details)).slice(0, 360);
    } catch {
      detailText = "";
    }
  }

  const result = [
    message,
    detailText ? `Detalhes: ${detailText}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return result && result.length <= 640 ? result : result.slice(0, 640);
}

export function parsePoseidonSubscriptionLookup(
  value: unknown,
  expectedSubscriptionId: string | null,
  expectedProductId: string,
): PoseidonSubscriptionLookup {
  if (!isRecord(value) || !Array.isArray(value.subscriptions)) {
    return { kind: "invalid" };
  }

  const candidates = value.subscriptions.filter(
    (item) => isRecord(item) && typeof item.id === "string",
  );
  if (candidates.length === 0 && value.subscriptions.length > 0) {
    return { kind: "invalid" };
  }
  const matched = expectedSubscriptionId
    ? candidates.find(
        (item) => isRecord(item) && item.id === expectedSubscriptionId,
      )
    : candidates.length === 1
      ? candidates[0]
      : null;
  if (!matched) {
    return candidates.length > 0 ? { kind: "mismatch" } : { kind: "missing" };
  }
  if (!isRecord(matched) || !Array.isArray(matched.items)) {
    return { kind: "invalid" };
  }
  if (typeof matched.id !== "string") return { kind: "invalid" };

  const status =
    typeof matched.status === "string" ? matched.status.toUpperCase() : "";
  const intervalType =
    typeof matched.intervalType === "string"
      ? matched.intervalType.toUpperCase()
      : "";
  const intervalCount = matched.intervalCount;
  const productIds: string[] = [];
  for (const item of matched.items) {
    if (!isRecord(item) || typeof item.productId !== "string") {
      return { kind: "invalid" };
    }
    if (item.isBump !== true) productIds.push(item.productId);
  }

  if (
    !["ACTIVE", "INACTIVE", "CANCELED"].includes(status) ||
    !Number.isSafeInteger(intervalCount) ||
    typeof intervalCount !== "number"
  ) {
    return { kind: "invalid" };
  }
  if (
    !productIds.includes(expectedProductId) ||
    intervalType !== "MONTHS" ||
    intervalCount !== 1
  ) {
    return { kind: "mismatch" };
  }

  return {
    kind: "subscription",
    subscription: {
      id: matched.id,
      status: status as PoseidonSubscriptionStatus["status"],
      intervalType,
      intervalCount,
      productIds,
    },
  };
}

export function normalizeOptionalPhone(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return { phone: undefined, error: null };
  if (!/^[+\d\s().-]{6,25}$/.test(trimmed)) {
    return { phone: undefined, error: "Telefone inválido." };
  }
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) {
    return { phone: undefined, error: "Telefone inválido." };
  }
  return {
    phone: trimmed.startsWith("+")
      ? `+${digits}`
      : digits,
    error: null,
  };
}

export function normalizeBrazilianCpf(value: string) {
  const cpf = value.replace(/\D/g, "");
  if (!/^\d{11}$/.test(cpf) || /^(\d)\1{10}$/.test(cpf)) {
    return { cpf: null, error: "Informe um CPF válido." };
  }

  const calculateDigit = (length: number) => {
    let sum = 0;
    for (let index = 0; index < length; index += 1) {
      sum += Number(cpf[index]) * (length + 1 - index);
    }
    const remainder = (sum * 10) % 11;
    return remainder === 10 ? 0 : remainder;
  };

  if (
    calculateDigit(9) !== Number(cpf[9]) ||
    calculateDigit(10) !== Number(cpf[10])
  ) {
    return { cpf: null, error: "Informe um CPF válido." };
  }

  return { cpf, error: null };
}

export function buildPoseidonSubscriptionPixPayload(input: {
  identifier: string;
  planId: string;
  planName: string;
  amount: number;
  clientName: string;
  email: string;
  phone: string;
  document: string;
}): PoseidonSubscriptionPixPayload {
  return {
    identifier: input.identifier,
    amount: input.amount,
    product: {
      id: input.planId,
      name: input.planName,
      quantity: 1,
      price: input.amount,
    },
    subscription: {
      periodicityType: "MONTHS",
      periodicity: 1,
      firstChargeIn: 0,
    },
    client: {
      name: input.clientName,
      email: input.email,
      phone: input.phone,
      document: input.document,
    },
    metadata: {
      provider: "broadcast-hub",
      orderId: input.identifier,
    },
  };
}
