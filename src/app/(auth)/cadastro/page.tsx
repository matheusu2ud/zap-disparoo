import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: "Criar conta | ZapFlow",
};

async function SignupContent({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  const { plan } = await searchParams;
  return <AuthShell mode="signup" selectedPlanId={plan} />;
}

export default function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ plan?: string }>;
}) {
  return (
    <Suspense
      fallback={
        <main className="auth-loading" aria-live="polite">
          <span className="brand-mark" aria-hidden="true">
            B
          </span>
          <span>Carregando cadastro...</span>
        </main>
      }
    >
      <SignupContent searchParams={searchParams} />
    </Suspense>
  );
}
