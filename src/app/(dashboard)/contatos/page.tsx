import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Download,
  Search,
  Users,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { ContactRow, type ContactRowData } from "../contacts/contact-row";
import { NewContactForm } from "../contacts/contact-form";
import { ImportContactsForm } from "../contacts/import-form";

export const metadata: Metadata = {
  title: "Contatos | ZapFlow",
};

const pageSize = 12;

function normalizeSearch(value: string) {
  return value
    .replace(/[^\p{L}\p{N}\s+@-]/gu, "")
    .trim()
    .slice(0, 80);
}

async function ContactsContent({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const { q = "", page: pageParam = "1" } = await searchParams;
  const query = normalizeSearch(q);
  const parsedPage = Number.parseInt(pageParam, 10);
  const page = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
  const from = (page - 1) * pageSize;
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    throw new Error("Não foi possível verificar sua sessão. Tente novamente.");
  }
  if (!user) redirect("/login");

  let contactsQuery = supabase
    .from("contacts")
    .select(
      "id, name, phone, email, consent_status, created_at, notes, contact_tags(id, tag_name)",
      { count: "exact" },
    )
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (query) {
    contactsQuery = contactsQuery.or(
      `name.ilike.%${query}%,phone.ilike.%${query}%`,
    );
  }

  const { data, count, error } = await contactsQuery.range(
    from,
    from + pageSize - 1,
  );

  const contacts = (data ?? []) as Omit<ContactRowData, "recentMessages">[];
  const total = count ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (page > totalPages) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("page", String(totalPages));
    redirect(`/contatos?${params.toString()}`);
  }

  const { data: messageRows, error: historyError } =
    contacts.length > 0
      ? await supabase
          .from("campaign_recipients")
          .select("contact_id, status, queued_at")
          .eq("user_id", user.id)
          .in("contact_id", contacts.map(({ id }) => id))
          .order("queued_at", { ascending: false })
      : { data: [], error: null };
  const recentByContact = new Map<
    string,
    { status: string; created_at: string }[]
  >();

  for (const row of messageRows ?? []) {
    const messages = recentByContact.get(row.contact_id) ?? [];
    if (messages.length < 5) {
      messages.push({ status: row.status, created_at: row.queued_at });
      recentByContact.set(row.contact_id, messages);
    }
  }
  const contactsWithHistory: ContactRowData[] = contacts.map((contact) => ({
    ...contact,
    contact_tags: contact.contact_tags ?? [],
    recentMessages: recentByContact.get(contact.id) ?? [],
  }));

  function pageUrl(targetPage: number) {
    const params = new URLSearchParams();
    if (query) params.set("q", query);
    params.set("page", String(targetPage));
    return `/contatos?${params.toString()}`;
  }

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <ArrowLeft size={16} />
          Voltar ao painel
        </Link>
        <span className="contacts-user">{user.email}</span>
      </header>

      <section className="contacts-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <Users size={14} />
              SUA BASE DE CONTATOS
            </span>
            <h1>Contatos</h1>
            <p>Organize sua lista e acompanhe o status de autorização.</p>
          </div>
          <div className="contacts-header-actions">
            <ImportContactsForm />
            <a className="secondary-button contact-export-button" href="/contatos/export">
              <Download size={15} />
              Exportar CSV
            </a>
            <NewContactForm />
          </div>
        </div>

        <div className="contacts-privacy-note">
          <span className="privacy-dot" />
          Contatos cadastrados começam sem consentimento. Não envie mensagens
          sem autorização registrada.
        </div>

        <section className="contacts-panel" aria-label="Lista de contatos">
          <div className="contacts-toolbar">
            <div>
              <h2>Todos os contatos</h2>
              <p>
                {error
                  ? "Não foi possível carregar a lista."
                  : `${total.toLocaleString("pt-BR")} contato${total === 1 ? "" : "s"}`}
              </p>
            </div>
            <form className="contacts-search" method="get">
              <Search size={16} />
              <input
                type="search"
                name="q"
                defaultValue={query}
                maxLength={80}
                placeholder="Buscar por nome ou telefone..."
                aria-label="Buscar contatos por nome ou telefone"
              />
              <button type="submit">Buscar</button>
            </form>
          </div>

          {error ? (
            <div className="contacts-state contacts-error" role="alert">
              Não foi possível consultar os contatos. Verifique se as migrations
              da Fase 3 foram aplicadas e tente novamente.
            </div>
          ) : contacts.length === 0 ? (
            <div className="contacts-state">
              <span className="contacts-state-icon">
                <Users size={23} />
              </span>
              <strong>
                {query ? "Nenhum contato encontrado" : "Sua lista está vazia"}
              </strong>
              <span>
                {query
                  ? "Tente buscar por outro nome ou limpe a pesquisa."
                  : "Cadastre um contato para começar a organizar sua base."}
              </span>
            </div>
          ) : (
            <div className="contact-list">
              {contactsWithHistory.map((contact) => (
                <ContactRow key={contact.id} contact={contact} />
              ))}
            </div>
          )}
          {historyError && (
            <p className="contacts-history-warning" role="status">
              A lista foi carregada, mas o histórico de comunicação está
              indisponível no momento.
            </p>
          )}

          {!error && total > 0 && (
            <div className="contacts-pagination">
              <span>
                Exibindo {from + 1}–{Math.min(from + pageSize, total)} de {total}
              </span>
              <div>
                <Link
                  href={pageUrl(page - 1)}
                  aria-disabled={page <= 1}
                  className={page <= 1 ? "is-disabled" : ""}
                  tabIndex={page <= 1 ? -1 : undefined}
                >
                  <ChevronLeft size={16} />
                  Anterior
                </Link>
                <span>Página {page} de {totalPages}</span>
                <Link
                  href={pageUrl(page + 1)}
                  aria-disabled={page >= totalPages}
                  className={page >= totalPages ? "is-disabled" : ""}
                  tabIndex={page >= totalPages ? -1 : undefined}
                >
                  Próxima
                  <ChevronRight size={16} />
                </Link>
              </div>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function ContactsLoading() {
  return (
    <main className="contacts-page">
      <div className="contacts-state">
        <span className="contacts-state-icon"><Users size={23} /></span>
        <strong>Carregando contatos...</strong>
      </div>
    </main>
  );
}

export default function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  return (
    <Suspense fallback={<ContactsLoading />}>
      <ContactsContent searchParams={searchParams} />
    </Suspense>
  );
}
