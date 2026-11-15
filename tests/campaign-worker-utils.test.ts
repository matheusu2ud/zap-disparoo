import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  constantTimeSecretMatches,
  mapSupportedMediaType,
  normalizeWhatsAppNumber,
} from "../src/lib/campaign-worker-utils";

describe("campaign worker utilities", () => {
  it("compares worker secrets without accepting different values", () => {
    assert.equal(constantTimeSecretMatches("secret-value", "secret-value"), true);
    assert.equal(constantTimeSecretMatches("secret-value", "another-value"), false);
    assert.equal(constantTimeSecretMatches("short", "longer-secret"), false);
  });

  it("normalizes valid WhatsApp numbers and rejects invalid lengths", () => {
    assert.equal(normalizeWhatsAppNumber("+1 (415) 555-0132"), "14155550132");
    assert.equal(normalizeWhatsAppNumber("1234567"), null);
    assert.equal(normalizeWhatsAppNumber("1234567890123456"), null);
  });

  it("allows only supported outbound media types", () => {
    assert.equal(mapSupportedMediaType("image/jpeg"), "image");
    assert.equal(mapSupportedMediaType("image/webp"), "image");
    assert.equal(mapSupportedMediaType("video/mp4"), "video");
    assert.equal(mapSupportedMediaType("application/pdf"), "document");
    assert.equal(mapSupportedMediaType("image/svg+xml"), null);
    assert.equal(mapSupportedMediaType("application/octet-stream"), null);
  });
});
