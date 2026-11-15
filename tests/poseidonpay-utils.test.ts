import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildPoseidonSubscriptionPixPayload,
  getSafePoseidonProviderError,
  normalizeBrazilianCpf,
  normalizeOptionalPhone,
  parsePoseidonSubscriptionLookup,
} from "../src/lib/poseidonpay-utils";

describe("PoseidonPay subscription Pix payload", () => {
  it("includes safe provider validation details and redacts private values", () => {
    const error = getSafePoseidonProviderError({
      message: "Invalid request; inspect details",
      details: {
        product: { id: ["does not exist"] },
        client: { email: "maria@example.com" },
        cpf: "52998224725",
      },
    });

    assert.match(error ?? "", /product.*does not exist/);
    assert.match(error ?? "", /\[ocultado\]/);
    assert.doesNotMatch(error ?? "", /maria@example\.com|52998224725/);
  });

  it("extracts validation errors returned under the errors key", () => {
    const error = getSafePoseidonProviderError({
      message: "Dados inválidos; verifique 'details' para mais informações",
      errors: {
        product: ["Product id not found"],
        client: { name: ["Name is required"] },
      },
    });

    assert.match(error ?? "", /Product id not found/);
    assert.match(error ?? "", /Name is required/);
  });

  it("builds a monthly subscription request with required client details", () => {
    const payload = buildPoseidonSubscriptionPixPayload({
      identifier: "bh_8dbd5ceb2f984cf18a",
      planId: "plan-123",
      planName: "Profissional",
      amount: 80,
      clientName: "Maria",
      email: "maria@example.com",
      phone: "11999999999",
      document: "52998224725",
    });

    assert.equal(payload.amount, 80);
    assert.equal(payload.product.id, "plan-123");
    assert.equal(payload.product.price, 80);
    assert.equal(payload.product.quantity, 1);
    assert.deepEqual(payload.subscription, {
      periodicityType: "MONTHS",
      periodicity: 1,
      firstChargeIn: 0,
    });
    assert.equal(payload.client.phone, "11999999999");
    assert.equal(payload.client.document, "52998224725");
    assert.equal(payload.metadata.orderId, payload.identifier);
  });

  it("includes an optional normalized phone", () => {
    const phone = normalizeOptionalPhone("(11) 99999-9999");
    assert.deepEqual(phone, { phone: "11999999999", error: null });
  });

  it("normalizes international phone numbers and rejects invalid input", () => {
    assert.deepEqual(normalizeOptionalPhone("+1 555 555 5555"), {
      phone: "+15555555555",
      error: null,
    });

    assert.equal(normalizeOptionalPhone("123")?.error, "Telefone inválido.");
    assert.equal(normalizeOptionalPhone("")?.phone, undefined);
  });

  it("normalizes valid CPFs and rejects invalid check digits", () => {
    assert.deepEqual(normalizeBrazilianCpf("529.982.247-25"), {
      cpf: "52998224725",
      error: null,
    });
    assert.deepEqual(normalizeBrazilianCpf("111.111.111-11"), {
      cpf: null,
      error: "Informe um CPF válido.",
    });
    assert.equal(
      normalizeBrazilianCpf("529.982.247-24").error,
      "Informe um CPF válido.",
    );
  });

  it("accepts only the matching monthly subscription product and status", () => {
    const response = {
      subscriptions: [
        {
          id: "provider-subscription",
          status: "ACTIVE",
          intervalType: "MONTHS",
          intervalCount: 1,
          items: [
            {
              id: "item-1",
              isBump: false,
              productId: "plan-123",
              productName: "Profissional",
            },
          ],
        },
      ],
    };

    assert.deepEqual(
      parsePoseidonSubscriptionLookup(
        response,
        "provider-subscription",
        "plan-123",
      ),
      {
        kind: "subscription",
        subscription: {
          id: "provider-subscription",
          status: "ACTIVE",
          intervalType: "MONTHS",
          intervalCount: 1,
          productIds: ["plan-123"],
        },
      },
    );
    assert.equal(
      parsePoseidonSubscriptionLookup(
        response,
        "provider-subscription",
        "different-plan",
      ).kind,
      "mismatch",
    );
  });

  it("does not accept an active subscription with a different period", () => {
    const result = parsePoseidonSubscriptionLookup(
      {
        subscriptions: [
          {
            id: "provider-subscription",
            status: "ACTIVE",
            intervalType: "YEARS",
            intervalCount: 1,
            items: [{ isBump: false, productId: "plan-123" }],
          },
        ],
      },
      "provider-subscription",
      "plan-123",
    );
    assert.equal(result.kind, "mismatch");
  });

  it("can recover one subscription by the application's unique identifier", () => {
    const result = parsePoseidonSubscriptionLookup(
      {
        subscriptions: [
          {
            id: "recovered-subscription",
            status: "INACTIVE",
            intervalType: "MONTHS",
            intervalCount: 1,
            items: [{ isBump: false, productId: "plan-123" }],
          },
        ],
      },
      null,
      "plan-123",
    );
    assert.equal(result.kind, "subscription");
    if (result.kind === "subscription") {
      assert.equal(result.subscription.id, "recovered-subscription");
      assert.equal(result.subscription.status, "INACTIVE");
    }
  });
});
