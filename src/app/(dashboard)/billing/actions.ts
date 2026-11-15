"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createPoseidonSubscriptionPix,
  getPoseidonSubscriptionStatus,
  PoseidonPayError,
} from "@/lib/poseidonpay";
import {
  normalizeBrazilianCpf,
  normalizeOptionalPhone,
} from "@/lib/poseidonpay-utils";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type BillingPayment = {
  id: string;
  identifier: string;
  planName: string;
  amount: number;
  pixCode: string | null;
  pixExpiresAt: string | null;
  checkoutUrl: string | null;
  status: "pending" | "manual_review" | "confirmed";
};

export type BillingActionState = {
  error?: string;
  payment?: BillingPayment;
};

export type BillingVerificationState = {
  error?: string;
  result?: {
    status: "pending" | "confirmed" | "canceled" | "manual_review";
    message: string;
  };
};

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function displayPlanName(value: string) {
  return value.replace(/^BROADCAST HUB - /, "");
}

function getSafeReturnPath(value: string) {
  return value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/billing")
    ? value
    : "/painel";
}

function mapPayment(
  intent: {
    id: string;
    identifier: string;
    amount: number | string;
    pix_code: string | null;
    pix_expires_at: string | null;
    checkout_url: string | null;
    status: string;
  },
  planName: string,
): BillingPayment {
  return {
    id: intent.id,
    identifier: intent.identifier,
    amount: Number(intent.amount),
    planName,
    pixCode: intent.pix_code,
    pixExpiresAt: intent.pix_expires_at,
    checkoutUrl: intent.checkout_url,
    status:
      intent.status === "manual_review"
        ? "manual_review"
        : intent.status === "confirmed"
          ? "confirmed"
          : "pending",
  };
}

export async function selectFreePlan(
  _previousState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const { error } = await supabase.rpc("select_broadcast_hub_free_plan");
  if (error) {
    if (error.message.includes("open_payment_exists")) {
      return {
        error:
          "Você já tem um pagamento em andamento. Conclua ou resolva essa cobrança antes de escolher o plano grátis.",
      };
    }
    if (error.message.includes("paid_plan_change_requires_cancellation")) {
      return {
        error:
          "Sua assinatura paga continua ativa na PoseidonPay. O plano não foi alterado para evitar novas cobranças; fale com o suporte para cancelar a recorrência primeiro.",
      };
    }
    if (error.message.includes("plan_already_selected")) {
      redirect("/painel");
    }
    if (error.message.includes("broadcast_hub_free_plan_missing")) {
      return {
        error:
          "O plano grátis está indisponível no momento. Avise o administrador.",
      };
    }
    if (error.message.includes("active_profile_required")) {
      return { error: "Esta conta está desativada." };
    }
    return {
      error:
        "Não foi possível ativar o plano grátis. Confirme se as migrations foram aplicadas.",
    };
  }

  revalidatePath("/billing");
  revalidatePath("/painel");
  redirect(getSafeReturnPath(getValue(formData, "return_to")));
}

export async function startPixCheckout(
  _previousState: BillingActionState,
  formData: FormData,
): Promise<BillingActionState> {
  const planId = getValue(formData, "plan_id");
  const clientName = getValue(formData, "name");
  const clientEmail = getValue(formData, "email").toLowerCase();
  const normalizedCpf = normalizeBrazilianCpf(getValue(formData, "cpf"));
  const rawPhone = getValue(formData, "phone");
  if (!isUuid(planId)) return { error: "Selecione um plano válido." };
  if (clientName.length < 2 || clientName.length > 200) {
    return { error: "Informe seu nome completo." };
  }
  if (normalizedCpf.error || !normalizedCpf.cpf) {
    return { error: normalizedCpf.error ?? "Informe um CPF válido." };
  }

  const normalizedPhone = normalizeOptionalPhone(rawPhone);
  if (normalizedPhone.error) return { error: normalizedPhone.error };
  if (!normalizedPhone.phone) {
    return {
      error:
        "Informe um telefone válido. A PoseidonPay exige esse dado para gerar a cobrança.",
    };
  }

  if (
    !process.env.POSEIDONPAY_PUBLIC_KEY?.trim() ||
    !process.env.POSEIDONPAY_SECRET_KEY?.trim()
  ) {
    return {
      error:
        "A integração PoseidonPay ainda não está configurada no servidor. Fale com o administrador.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Sua conta precisa ter um e-mail para iniciar o pagamento." };
  }
  if (clientEmail !== user.email.toLowerCase()) {
    return {
      error:
        "Use o mesmo e-mail da sua conta para gerar a cobrança. Se precisar alterá-lo, atualize primeiro seu cadastro.",
    };
  }

  const [{ data: profile, error: profileError }, { data: plan, error: planError }] =
    await Promise.all([
      supabase
        .from("profiles")
        .select("is_active")
        .eq("id", user.id)
        .maybeSingle(),
      supabase
        .from("plans")
        .select("id, name, price, currency, is_active")
        .eq("id", planId)
        .eq("is_active", true)
        .like("name", "BROADCAST HUB - %")
        .maybeSingle(),
    ]);

  if (profileError) {
    return { error: "Não foi possível verificar os dados da sua conta." };
  }
  if (!profile?.is_active) return { error: "Esta conta está desativada." };
  if (planError || !plan) return { error: "Plano não encontrado ou indisponível." };

  const amount = Number(plan.price);
  if (
    plan.currency !== "BRL" ||
    !Number.isFinite(amount) ||
    amount < 0.01
  ) {
    return {
      error:
        "Este plano não tem um preço Pix válido em reais. Peça ao administrador para revisar o plano.",
    };
  }

  const admin = createAdminClient();
  const { data: customer, error: customerError } = await admin
    .from("profiles")
    .update({ full_name: clientName, cpf: normalizedCpf.cpf })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (customerError || !customer) {
    return {
      error:
        "Não foi possível salvar seu nome e CPF com segurança. Tente novamente.",
    };
  }

  const { data: existing, error: existingError } = await supabase
    .from("billing_intents")
    .select(
      "id, identifier, plan_id, amount, pix_code, pix_expires_at, checkout_url, status, provider_subscription_id",
    )
    .in("status", ["creating", "pending", "manual_review", "confirmed"])
    .maybeSingle();

  if (existingError) {
    return {
      error:
        "Não foi possível consultar pagamentos pendentes. Aplique a migration de cobrança e tente novamente.",
    };
  }

  if (existing) {
    if (
      existing.status === "pending" &&
      existing.pix_expires_at &&
      Date.parse(existing.pix_expires_at) <= Date.now()
    ) {
      const { error: expireError } = await admin
        .from("billing_intents")
        .update({ status: "expired" })
        .eq("id", existing.id)
        .eq("user_id", user.id)
        .eq("status", "pending");
      if (expireError) {
        return {
          error:
            "Não foi possível atualizar o pagamento vencido. Tente novamente mais tarde.",
        };
      }
    } else {
      if (existing.status === "manual_review") {
        return {
          error: `Já existe uma cobrança que precisa de conferência. Informe ao suporte o identificador ${existing.identifier}; não gere outro Pix ainda.`,
        };
      }
      if (existing.status === "creating") {
        return {
          error:
            "Uma cobrança está sendo preparada. Aguarde alguns instantes e atualize a página antes de tentar novamente.",
        };
      }
      if (existing.plan_id !== planId) {
        return {
          error:
            existing.status === "confirmed"
              ? "Você já tem uma assinatura ativa vinculada a outro plano. Fale com o administrador para trocar o plano."
              : "Você já tem um Pix pendente para outro plano. Conclua ou aguarde o vencimento antes de gerar outra cobrança.",
        };
      }
      if (existing.status === "confirmed") {
        return { payment: mapPayment(existing, displayPlanName(plan.name)) };
      }
      return {
        payment: mapPayment(existing, displayPlanName(plan.name)),
      };
    }
  }

  const identifier = `bh_${randomUUID().replaceAll("-", "")}`;
  const { data: intent, error: insertError } = await admin
    .from("billing_intents")
    .insert({
      user_id: user.id,
      plan_id: plan.id,
      identifier,
      amount,
      currency: "BRL",
      status: "creating",
    })
    .select("id")
    .single();

  if (insertError || !intent) {
    if (insertError?.code === "23505") {
      return {
        error:
          "Já existe um pagamento em andamento para sua conta. Atualize a página antes de tentar novamente.",
      };
    }
    return {
      error: "Não foi possível reservar a cobrança no banco. Tente novamente.",
    };
  }

  let gatewayResponse;
  try {
    gatewayResponse = await createPoseidonSubscriptionPix({
      identifier,
      planId: plan.id,
      planName: displayPlanName(plan.name),
      amount,
      clientName,
      email: user.email,
      phone: normalizedPhone.phone,
      document: normalizedCpf.cpf,
    });
  } catch (error) {
    const requiresManualReview =
      error instanceof PoseidonPayError && error.requiresManualReview;
    const status = requiresManualReview ? "manual_review" : "failed";
    const { error: updateError } = await admin
      .from("billing_intents")
      .update({
        status,
        gateway_status: requiresManualReview ? "UNKNOWN" : "FAILED",
      })
      .eq("id", intent.id)
      .eq("user_id", user.id);
    if (updateError) {
      return {
        error: `Não foi possível confirmar o resultado da cobrança. Não tente gerar outro Pix ainda. Identificador: ${identifier}.`,
      };
    }
    return {
      error:
        error instanceof PoseidonPayError
          ? `${error.message} Referência: ${identifier}.`
          : "Não foi possível criar o Pix. Tente novamente mais tarde.",
    };
  }

  if (!gatewayResponse.pixCode) {
    const { error: updateError } = await admin
      .from("billing_intents")
      .update({
        status: "manual_review",
        gateway_status: gatewayResponse.transactionStatus ?? gatewayResponse.status,
        provider_transaction_id: gatewayResponse.transactionId,
        provider_order_id: gatewayResponse.orderId,
        provider_subscription_id: gatewayResponse.subscriptionId,
        checkout_url: gatewayResponse.orderUrl,
      })
      .eq("id", intent.id)
      .eq("user_id", user.id);
    if (updateError) {
      return {
        error: `A PoseidonPay respondeu, mas o resultado não pôde ser salvo. Não tente gerar outro Pix. Identificador: ${identifier}.`,
      };
    }
    return {
      error: `A PoseidonPay criou uma cobrança sem código Pix disponível. Ela precisa de conferência manual. Identificador: ${identifier}.`,
    };
  }

  const { error: saveError } = await admin
    .from("billing_intents")
    .update({
      status: "pending",
      gateway_status: gatewayResponse.transactionStatus ?? gatewayResponse.status,
      provider_transaction_id: gatewayResponse.transactionId,
      provider_order_id: gatewayResponse.orderId,
      provider_subscription_id: gatewayResponse.subscriptionId,
      pix_code: gatewayResponse.pixCode,
      pix_expires_at: gatewayResponse.pixExpiresAt,
      checkout_url: gatewayResponse.orderUrl,
    })
    .eq("id", intent.id)
    .eq("user_id", user.id);

  if (saveError) {
    return {
      error: `O Pix foi criado, mas não conseguimos salvar o resultado. Não gere outra cobrança. Informe ao suporte o identificador ${identifier}.`,
    };
  }

  revalidatePath("/billing");
  return {
    payment: {
      id: intent.id,
      identifier,
      planName: displayPlanName(plan.name),
      amount,
      pixCode: gatewayResponse.pixCode,
      pixExpiresAt: gatewayResponse.pixExpiresAt,
      checkoutUrl: gatewayResponse.orderUrl,
      status: "pending",
    },
  };
}

export async function verifyPoseidonSubscription(
  _previousState: BillingVerificationState,
  formData: FormData,
): Promise<BillingVerificationState> {
  const intentId = getValue(formData, "intent_id");
  if (!isUuid(intentId)) return { error: "Cobrança inválida." };

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");
  if (!user.email) {
    return { error: "Não foi possível identificar o e-mail desta conta." };
  }

  const { data: intent, error: intentError } = await supabase
    .from("billing_intents")
    .select("id, identifier, plan_id, status, provider_subscription_id")
    .eq("id", intentId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (intentError) {
    return {
      error:
        "Não foi possível carregar esta cobrança. Verifique se as migrations foram aplicadas.",
    };
  }
  if (!intent) return { error: "Cobrança não encontrada." };
  if (!["pending", "manual_review", "confirmed"].includes(intent.status)) {
    return { error: "Esta cobrança não está disponível para verificação." };
  }
  const admin = createAdminClient();
  const { data: checkClaimed, error: claimError } = await admin.rpc(
    "claim_poseidonpay_subscription_check",
    { p_billing_intent_id: intent.id },
  );
  if (claimError) {
    return {
      error:
        "Não foi possível iniciar a verificação. Aplique a migration de status PoseidonPay.",
    };
  }
  if (checkClaimed !== true) {
    return {
      error:
        "Aguarde alguns segundos antes de consultar novamente esta assinatura.",
    };
  }

  let lookup;
  try {
    lookup = await getPoseidonSubscriptionStatus({
      subscriptionId: intent.provider_subscription_id,
      identifier: intent.identifier,
      planId: intent.plan_id,
    });
  } catch (error) {
    return {
      error:
        error instanceof PoseidonPayError
          ? error.message
          : "Não foi possível consultar a PoseidonPay. Tente novamente.",
    };
  }

  if (lookup.kind === "missing") {
    return {
      result: {
        status: "pending",
        message:
          "A PoseidonPay ainda não encontrou a assinatura. O plano permanece sem alteração; tente novamente após confirmar o Pix.",
      },
    };
  }
  if (lookup.kind === "invalid" || lookup.kind === "mismatch") {
    if (intent.status !== "confirmed") {
      const { error: reviewError } = await admin
        .from("billing_intents")
        .update({ status: "manual_review", gateway_status: "REVIEW_REQUIRED" })
        .eq("id", intent.id)
        .eq("user_id", user.id)
        .in("status", ["pending", "manual_review"]);
      if (reviewError) {
        return {
          error:
            "A consulta retornou dados que não puderam ser validados, e não foi possível registrar a revisão. Não gere outra cobrança.",
        };
      }
    }
    return {
      result: {
        status: "manual_review",
        message:
          "Os dados da assinatura retornados pela PoseidonPay não correspondem com segurança a este plano. Nenhuma permissão foi concedida; fale com o suporte.",
      },
    };
  }

  if (intent.provider_subscription_id !== lookup.subscription.id) {
    const { error: saveSubscriptionIdError } = await admin
      .from("billing_intents")
      .update({
        provider_subscription_id: lookup.subscription.id,
        gateway_status: lookup.subscription.status,
      })
      .eq("id", intent.id)
      .eq("user_id", user.id)
      .is("provider_subscription_id", null);
    if (saveSubscriptionIdError) {
      return {
        error:
          "A PoseidonPay encontrou a assinatura, mas não foi possível vinculá-la a este pagamento. Nenhum acesso foi alterado; fale com o suporte.",
      };
    }
  }

  const { data: outcome, error: applyError } = await admin.rpc(
    "apply_poseidonpay_subscription_status",
    {
      p_billing_intent_id: intent.id,
      p_provider_subscription_id: lookup.subscription.id,
      p_gateway_status: lookup.subscription.status,
      p_interval_type: lookup.subscription.intervalType,
      p_interval_count: lookup.subscription.intervalCount,
      p_product_id: intent.plan_id,
    },
  );
  if (applyError) {
    return {
      error:
        "A PoseidonPay confirmou o status, mas o banco não conseguiu atualizar a assinatura. Tente novamente ou fale com o suporte.",
    };
  }

  revalidatePath("/billing");
  revalidatePath("/painel");
  revalidatePath("/connections");
  revalidatePath("/campaigns");

  if (outcome === "activated" || outcome === "confirmed") {
    return {
      result: {
        status: "confirmed",
        message:
          outcome === "activated"
            ? "Pagamento confirmado: sua assinatura está ativa."
            : "A PoseidonPay confirmou que sua assinatura continua ativa.",
      },
    };
  }
  if (outcome === "canceled") {
    return {
      result: {
        status: "canceled",
        message:
          "A PoseidonPay informou que a assinatura foi cancelada ou está inativa. O acesso vinculado a esta cobrança foi encerrado.",
      },
    };
  }

  return {
    result: {
      status: "pending",
      message:
        "A assinatura ainda está inativa na PoseidonPay. O plano não foi liberado; pague o Pix e consulte novamente.",
    },
  };
}

export async function resolveRejectedPoseidonCharge(
  _previousState: BillingVerificationState,
  formData: FormData,
): Promise<BillingVerificationState> {
  const intentId = getValue(formData, "intent_id");
  const identifier = getValue(formData, "identifier");
  if (!isUuid(intentId) || !identifier.startsWith("bh_")) {
    return { error: "Referência da cobrança inválida." };
  }
  if (formData.get("confirm_not_found") !== "on") {
    return {
      error:
        "Confirme que você verificou a PoseidonPay e não encontrou esta cobrança.",
    };
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const { data: intent, error: intentError } = await supabase
    .from("billing_intents")
    .select(
      "id, identifier, plan_id, status, gateway_status, provider_subscription_id, provider_transaction_id, provider_order_id, pix_code, checkout_url",
    )
    .eq("id", intentId)
    .eq("identifier", identifier)
    .eq("user_id", user.id)
    .maybeSingle();

  if (intentError) {
    return { error: "Não foi possível carregar esta cobrança." };
  }
  if (!intent || intent.status !== "manual_review") {
    return {
      error: "Esta cobrança já foi atualizada ou não está mais em revisão.",
    };
  }
  if (
    !["UNKNOWN", "REVIEW_REQUIRED"].includes(intent.gateway_status ?? "") ||
    intent.provider_subscription_id ||
    intent.provider_transaction_id ||
    intent.provider_order_id ||
    intent.pix_code ||
    intent.checkout_url
  ) {
    return {
      error:
        "Esta cobrança não pode ser encerrada por confirmação manual porque o estado ou os dados retornados não correspondem a uma tentativa sem resultado.",
    };
  }

  const admin = createAdminClient();
  const { data: updated, error: updateError } = await admin
    .from("billing_intents")
    .update({
      status: "failed",
      gateway_status: "USER_CONFIRMED_NOT_FOUND",
    })
    .eq("id", intent.id)
    .eq("identifier", intent.identifier)
    .eq("user_id", user.id)
    .eq("status", "manual_review")
    .in("gateway_status", ["UNKNOWN", "REVIEW_REQUIRED"])
    .is("provider_subscription_id", null)
    .is("provider_transaction_id", null)
    .is("provider_order_id", null)
    .is("pix_code", null)
    .is("checkout_url", null)
    .select("id")
    .maybeSingle();

  if (updateError || !updated) {
    return {
      error:
        "Não foi possível atualizar o estado desta cobrança. Ela continua bloqueada; tente novamente ou fale com o suporte.",
    };
  }

  revalidatePath("/billing");
  redirect(`/billing?plan=${encodeURIComponent(intent.plan_id)}`);
}
