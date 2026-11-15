import { timingSafeEqual } from "node:crypto";

export function constantTimeSecretMatches(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function normalizeWhatsAppNumber(value: string) {
  const digits = value.replace(/\D/g, "");
  return /^\d{8,15}$/.test(digits) ? digits : null;
}

export function mapSupportedMediaType(contentType: string) {
  if (contentType === "image/jpeg" || contentType === "image/png" || contentType === "image/webp") {
    return "image";
  }
  if (contentType === "video/mp4") return "video";
  if (contentType === "application/pdf") return "document";
  return null;
}
