import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { FileText, Search } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import {
  NewTemplateForm,
  TemplateCard,
  type TemplateRow,
} from "./template-manager";

export const metadata: Metadata = {
  title: "Templates | ZapFlow",
};

async function TemplatesContent({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const { q = "", category = "" } = await searchParams;
  const query = q.replace(/[^\p{L}\p{N}\s-]/gu, "").trim().slice(0, 80);
  const allowedCategories = ["general", "marketing", "utility", "support"];
  const selectedCategory = allowedCategories.includes(category) ? category : "";
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  let templatesQuery = supabase
    .from("message_templates")
    .select("id, name, category, body, created_at, updated_at")
    .eq("user_id", user.id)
    .order("updated_at", { ascending: false });

  if (query) templatesQuery = templatesQuery.ilike("name", `%${query}%`);
  if (selectedCategory) {
    templatesQuery = templatesQuery.eq("category", selectedCategory);
  }

  const { data, error } = await templatesQuery;
  const templates = (data ?? []) as TemplateRow[];

  return (
    <main className="contacts-page">
      <header className="contacts-topbar">
        <Link href="/painel" className="contacts-back">
          <span aria-hidden="true">←</span>
          Voltar ao painel
        </Link>
        <span className="contacts-user">{user.email}</span>
      </header>
      <section className="contacts-content library-content">
        <div className="contacts-title-row">
          <div>
            <span className="contacts-eyebrow">
              <FileText size={14} />
              BIBLIOTECA DE MENSAGENS
            </span>
            <h1>Templates</h1>
            <p>Crie e organize mensagens reutilizáveis para suas campanhas.</p>
          </div>
          <NewTemplateForm />
        </div>

        <section className="library-panel" aria-label="Lista de templates">
          <div className="library-toolbar">
            <div>
              <h2>Seus templates</h2>
              <p>
                {error
                  ? "Não foi possível carregar os templates."
                  : `${templates.length} template${templates.length === 1 ? "" : "s"}`}
              </p>
            </div>
            <form className="library-filters" method="get">
              <label className="library-search">
                <Search size={15} />
                <input
                  type="search"
                  name="q"
                  defaultValue={query}
                  maxLength={80}
                  placeholder="Buscar template..."
                  aria-label="Buscar template pelo nome"
                />
              </label>
              <select
                name="category"
                defaultValue={selectedCategory}
                aria-label="Filtrar por categoria"
              >
                <option value="">Todas as categorias</option>
                <option value="general">Geral</option>
                <option value="marketing">Marketing</option>
                <option value="utility">Utilidade</option>
                <option value="support">Atendimento</option>
              </select>
              <button type="submit" className="connection-secondary">
                Filtrar
              </button>
            </form>
          </div>

          {error ? (
            <div className="library-empty is-error" role="alert">
              Não foi possível consultar os templates. Verifique as migrations
              do banco e tente novamente.
            </div>
          ) : templates.length ? (
            <div className="template-grid">
              {templates.map((template) => (
                <TemplateCard key={template.id} template={template} />
              ))}
            </div>
          ) : (
            <div className="library-empty">
              <span className="connections-empty-icon">
                <FileText size={22} />
              </span>
              <strong>
                {query || selectedCategory
                  ? "Nenhum template encontrado"
                  : "Sua biblioteca está vazia"}
              </strong>
              <span>
                {query || selectedCategory
                  ? "Altere a busca ou o filtro para ver outros templates."
                  : "Crie um template para reutilizar mensagens nas campanhas."}
              </span>
            </div>
          )}
        </section>
      </section>
    </main>
  );
}

function TemplatesLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando templates...
      </div>
    </main>
  );
}

export default function TemplatesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  return (
    <Suspense fallback={<TemplatesLoading />}>
      <TemplatesContent searchParams={searchParams} />
    </Suspense>
  );
}
