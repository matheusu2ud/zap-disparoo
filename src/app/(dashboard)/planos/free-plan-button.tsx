"use client";

import { useActionState } from "react";
import { ArrowRight } from "lucide-react";
import {
  selectFreePlan,
  type BillingActionState,
} from "@/app/(dashboard)/billing/actions";

export function FreePlanButton() {
  const [state, formAction, pending] = useActionState<
    BillingActionState,
    FormData
  >(selectFreePlan, {});

  return (
    <form action={formAction}>
      <input type="hidden" name="return_to" value="/painel" />
      {state.error && (
        <p className="billing-error" role="alert">
          {state.error}
        </p>
      )}
      <button
        className="pricing-button pricing-button-secondary"
        type="submit"
        disabled={pending}
      >
        {pending ? "Ativando plano..." : "Ativar plano grátis"}
        <ArrowRight size={16} aria-hidden="true" />
      </button>
    </form>
  );
}
