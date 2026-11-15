import "server-only";

export type EvolutionConnectionState =
  | "connected"
  | "connecting"
  | "disconnected"
  | "error";

type JsonRecord = Record<string, unknown>;

export type EvolutionInstance = {
  instanceId: string | null;
  qrCode: string | null;
};

export type EvolutionOutboundMedia = {
  media: string;
  mimeType: string;
  fileName: string;
};

export type EvolutionSendResult = {
  messageId: string | null;
};

export class EvolutionApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvolutionApiError";
  }
}

function getEvolutionConfig() {
  const baseUrl = process.env.EVOLUTION_API_URL?.trim().replace(/\/+$/, "");
  const apiKey = process.env.EVOLUTION_API_KEY?.trim();

  if (!baseUrl || !apiKey) {
    throw new EvolutionApiError(
      "Configure EVOLUTION_API_URL e EVOLUTION_API_KEY no servidor.",
    );
  }

  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new EvolutionApiError("EVOLUTION_API_URL não é uma URL válida.");
  }

  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  ) {
    throw new EvolutionApiError(
      "EVOLUTION_API_URL deve usar HTTP(S) e não pode incluir credenciais.",
    );
  }

  if (
    process.env.NODE_ENV === "production" &&
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1", "::1"].includes(url.hostname)
  ) {
    throw new EvolutionApiError(
      "Em produção, EVOLUTION_API_URL precisa usar HTTPS.",
    );
  }

  return { baseUrl, apiKey };
}

function asRecord(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function qrImageFromPayload(payload: unknown): string | null {
  const root = asRecord(payload);
  const qr = asRecord(root?.qrcode);
  const candidate =
    (typeof qr?.base64 === "string" && qr.base64) ||
    (typeof root?.base64 === "string" && root.base64) ||
    (typeof root?.qrCode === "string" && root.qrCode) ||
    null;

  if (!candidate) return null;

  if (/^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(candidate)) {
    return candidate;
  }

  if (/^[A-Za-z0-9+/]+={0,2}$/.test(candidate) && candidate.length > 100) {
    return `data:image/png;base64,${candidate}`;
  }

  return null;
}

async function request(
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: JsonRecord,
) {
  const { baseUrl, apiKey } = getEvolutionConfig();
  let response: Response;

  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        apikey: apiKey,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    throw new EvolutionApiError(
      "Não foi possível conectar à Evolution API. Verifique a URL e a disponibilidade do serviço.",
    );
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new EvolutionApiError(
        "A Evolution API recusou a chave configurada. Revise EVOLUTION_API_KEY.",
      );
    }
    if (response.status === 409) {
      throw new EvolutionApiError(
        "A instância já existe na Evolution API. Atualize o status ou tente reconectar.",
      );
    }
    if (response.status === 429) {
      throw new EvolutionApiError(
        "A Evolution API limitou as solicitações. Aguarde um momento e tente novamente.",
      );
    }
    throw new EvolutionApiError(
      `A Evolution API retornou erro HTTP ${response.status}.`,
    );
  }

  if (response.status === 204) return {};

  try {
    return (await response.json()) as unknown;
  } catch {
    throw new EvolutionApiError(
      "A Evolution API retornou uma resposta inválida.",
    );
  }
}

export async function createEvolutionInstance(
  instanceName: string,
): Promise<EvolutionInstance> {
  const payload = await request("/instance/create", "POST", {
    instanceName,
    integration: "WHATSAPP-BAILEYS",
    qrcode: true,
  });
  const root = asRecord(payload);
  const instance = asRecord(root?.instance);
  const instanceId =
    typeof instance?.instanceId === "string" ? instance.instanceId : null;
  const qrCode = qrImageFromPayload(payload);

  return { instanceId, qrCode };
}

export async function connectEvolutionInstance(instanceName: string) {
  const payload = await request(
    `/instance/connect/${encodeURIComponent(instanceName)}`,
    "GET",
  );
  return qrImageFromPayload(payload);
}

export async function getEvolutionConnectionState(instanceName: string) {
  const payload = await request(
    `/instance/connectionState/${encodeURIComponent(instanceName)}`,
    "GET",
  );
  const root = asRecord(payload);
  const instance = asRecord(root?.instance);
  const state =
    typeof instance?.state === "string" ? instance.state.toLowerCase() : "";

  if (state === "open" || state === "connected") {
    return {
      status: "connected" as const,
      phoneNumber:
        typeof instance?.owner === "string"
          ? instance.owner.replace(/@.*/, "")
          : null,
    };
  }
  if (state === "connecting" || state === "qrcode") {
    return { status: "connecting" as const, phoneNumber: null };
  }
  if (state === "close" || state === "closed" || state === "disconnected") {
    return { status: "disconnected" as const, phoneNumber: null };
  }

  return { status: "error" as const, phoneNumber: null };
}

export async function logoutEvolutionInstance(instanceName: string) {
  await request(
    `/instance/logout/${encodeURIComponent(instanceName)}`,
    "DELETE",
  );
}

export async function deleteEvolutionInstance(instanceName: string) {
  await request(
    `/instance/delete/${encodeURIComponent(instanceName)}`,
    "DELETE",
  );
}

function messageIdFromPayload(payload: unknown) {
  const root = asRecord(payload);
  const data = asRecord(root?.data);
  const key = asRecord(root?.key);
  const dataKey = asRecord(data?.key);
  const message = asRecord(root?.message);
  const messageKey = asRecord(message?.key);
  const id =
    root?.messageId ??
    data?.messageId ??
    key?.id ??
    dataKey?.id ??
    messageKey?.id;
  return typeof id === "string" && id.length <= 200 ? id : null;
}

export async function sendEvolutionMessage(
  instanceName: string,
  phoneNumber: string,
  message: string,
  media?: EvolutionOutboundMedia,
): Promise<EvolutionSendResult> {
  if (!/^\d{8,15}$/.test(phoneNumber)) {
    throw new EvolutionApiError("O telefone do destinatário é inválido.");
  }

  const path = media
    ? `/message/sendMedia/${encodeURIComponent(instanceName)}`
    : `/message/sendText/${encodeURIComponent(instanceName)}`;
  const payload = media
    ? await request(path, "POST", {
        number: phoneNumber,
        mediatype: media.mimeType.startsWith("image/")
          ? "image"
          : media.mimeType.startsWith("video/")
            ? "video"
            : "document",
        media: media.media,
        caption: message,
        fileName: media.fileName,
        mimetype: media.mimeType,
      })
    : await request(path, "POST", { number: phoneNumber, text: message });

  return { messageId: messageIdFromPayload(payload) };
}

export function mapEvolutionWebhookState(value: unknown): EvolutionConnectionState | null {
  const state = typeof value === "string" ? value.toLowerCase() : "";
  if (state === "open" || state === "connected") return "connected";
  if (state === "connecting" || state === "qrcode") return "connecting";
  if (state === "close" || state === "closed" || state === "disconnected") {
    return "disconnected";
  }
  return null;
}
