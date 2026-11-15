"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export function DashboardRefreshButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      className={`dashboard-refresh-button${pending ? " is-refreshing" : ""}`}
      type="button"
      aria-label="Atualizar dados do painel"
      disabled={pending}
      onClick={() => startTransition(() => router.refresh())}
    >
      <span>{pending ? "ATUALIZANDO" : "ATUALIZADO"}</span>
      <i>{pending ? "..." : "AGORA"}</i>
      <RefreshCw size={12} aria-hidden="true" />
    </button>
  );
}
