"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, Search } from "lucide-react";
import type { DashboardActivity } from "@/lib/dashboard";

const searchItems = [
  { label: "Visão geral", href: "/painel", keywords: "início painel dashboard" },
  { label: "Campanhas", href: "/campaigns", keywords: "mensagem envio campanha" },
  { label: "Contatos", href: "/contatos", keywords: "clientes lista pessoas" },
  { label: "Conexões WhatsApp", href: "/connections", keywords: "whatsapp telefone conectar" },
  { label: "Templates", href: "/templates", keywords: "modelo mensagem" },
  { label: "Mídia", href: "/media", keywords: "foto vídeo arquivo imagem" },
  { label: "Relatórios", href: "/reports", keywords: "atividade métricas" },
  { label: "Assinatura e planos", href: "/billing", keywords: "pagamento pix preço plano" },
];

function formatActivityDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function DashboardToolbar({
  recentActivity,
}: {
  recentActivity: DashboardActivity[];
}) {
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const results = searchItems.filter((item) =>
    `${item.label} ${item.keywords}`.toLowerCase().includes(query.trim().toLowerCase()),
  );

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen(true);
        searchRef.current?.focus();
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setNotificationsOpen(false);
        searchRef.current?.blur();
      }
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  return (
    <div className="topbar-actions">
      <div className="dashboard-search-wrap">
        <label className="search-box">
          <Search size={16} aria-hidden="true" />
          <input
            ref={searchRef}
            aria-label="Pesquisar páginas e recursos"
            aria-controls="dashboard-search-results"
            placeholder="Pesquisar..."
            value={query}
            onFocus={() => setSearchOpen(true)}
            onChange={(event) => {
              setQuery(event.target.value);
              setSearchOpen(true);
            }}
          />
          <kbd>Ctrl K</kbd>
        </label>
        {searchOpen && (
          <div
            className="dashboard-search-results"
            id="dashboard-search-results"
            role="listbox"
            aria-label="Resultados da pesquisa"
          >
            {results.length ? (
              results.map((item) => (
                <Link
                  href={item.href}
                  key={item.href}
                  role="option"
                  aria-selected="false"
                  onClick={() => {
                    setSearchOpen(false);
                    setQuery("");
                  }}
                >
                  {item.label}
                </Link>
              ))
            ) : (
              <p>Nenhuma página encontrada. Tente outra palavra.</p>
            )}
          </div>
        )}
      </div>

      <div className="dashboard-notifications-wrap">
        <button
          className="icon-button notification-button"
          type="button"
          aria-label={
            notificationsOpen ? "Fechar atividade recente" : "Ver atividade recente"
          }
          aria-expanded={notificationsOpen}
          aria-controls="dashboard-notifications"
          onClick={() => setNotificationsOpen((open) => !open)}
        >
          <Bell size={18} />
          {recentActivity.length > 0 && <span className="notification-dot" />}
        </button>
        {notificationsOpen && (
          <section
            className="dashboard-notifications"
            id="dashboard-notifications"
            aria-label="Atividade recente"
          >
            <header>
              <strong>Atividade recente</strong>
              <Link href="/reports" onClick={() => setNotificationsOpen(false)}>
                Ver tudo
              </Link>
            </header>
            {recentActivity.length ? (
              <ul>
                {recentActivity.slice(0, 5).map((activity) => (
                  <li key={activity.id}>
                    <strong>{activity.title}</strong>
                    <span>{activity.description}</span>
                    <time dateTime={activity.occurredAt}>
                      {formatActivityDate(activity.occurredAt)}
                    </time>
                  </li>
                ))}
              </ul>
            ) : (
              <p>Nenhuma atividade registrada ainda.</p>
            )}
          </section>
        )}
      </div>
      <span className="topbar-divider" />
      <span className="header-avatar" aria-label="ZapFlow">
        ZF
      </span>
    </div>
  );
}
