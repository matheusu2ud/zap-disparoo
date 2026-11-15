import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthShell } from "../auth-shell";

export const metadata: Metadata = {
  title: "Entrar | ZapFlow",
};

function LoginLoading() {
  return (
    <main className="auth-loading" aria-live="polite">
      <span className="brand-mark" aria-hidden="true">
        B
      </span>
      <span>Carregando acesso...</span>
    </main>
  );
}

async function LoginContent({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    auth_error?: string;
    account?: string;
  }>;
}) {
  const {
    next,
    auth_error: authError,
    account,
  } = await searchParams;

  return (
    <AuthShell
      mode="login"
      nextPath={next}
      authError={authError === "callback"}
      accountDisabled={account === "disabled"}
    />
  );
}

export default function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string;
    auth_error?: string;
    account?: string;
  }>;
}) {
  return (
    <Suspense fallback={<LoginLoading />}>
      <LoginContent searchParams={searchParams} />
    </Suspense>
  );
}
