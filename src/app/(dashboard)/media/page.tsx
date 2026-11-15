import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { Image as ImageIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";
import { MediaGrid, MediaUploadForm, type MediaRow } from "./media-manager";

export const metadata: Metadata = {
  title: "Mídia | ZapFlow",
};

const bucket = "broadcast-media";

async function MediaContent() {
  await connection();
  if (!getSupabaseConfig()) redirect("/login");

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  const { data, error } = await supabase
    .from("media_files")
    .select("id, file_name, storage_path, content_type, size_bytes, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  const signingResults =
    data && !error
      ? await Promise.all(
      data.map(async (file) => {
        const { data: signedUrl, error: signingError } = await supabase.storage
          .from(bucket)
          .createSignedUrl(file.storage_path, 300);
        return { file, signedUrl: signedUrl?.signedUrl ?? null, signingError };
      }),
    )
      : [];
  const signedUrlError = signingResults.some(({ signingError }) =>
    Boolean(signingError),
  );
  const files: MediaRow[] = signingResults.map(({ file, signedUrl }) => ({
    id: file.id,
    file_name: file.file_name,
    content_type: file.content_type,
    size_bytes: Number(file.size_bytes),
    created_at: file.created_at,
    signedUrl,
  }));

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
              <ImageIcon size={14} />
              ARQUIVOS PRIVADOS
            </span>
            <h1>Mídia</h1>
            <p>
              Envie fotos JPG, PNG ou WebP e vídeos MP4 para selecionar nas
              campanhas.
            </p>
          </div>
          <MediaUploadForm />
        </div>

        {error ? (
          <div className="library-empty is-error" role="alert">
            Não foi possível consultar os arquivos. Verifique se as migrations
            foram aplicadas e tente novamente.
          </div>
        ) : signedUrlError ? (
          <p className="connections-notice is-error" role="alert">
            Alguns arquivos não puderam ser disponibilizados. Atualize a página
            ou verifique as permissões do armazenamento.
          </p>
        ) : null}

        {!error && files.length ? (
          <MediaGrid files={files} />
        ) : !error ? (
          <div className="library-empty">
            <span className="connections-empty-icon">
              <ImageIcon size={22} />
            </span>
            <strong>Sua biblioteca está vazia</strong>
            <span>
              Envie uma imagem, vídeo ou documento para organizar seus arquivos.
            </span>
          </div>
        ) : null}
      </section>
    </main>
  );
}

function MediaLoading() {
  return (
    <main className="contacts-page">
      <div className="connections-loading" role="status">
        Carregando arquivos...
      </div>
    </main>
  );
}

export default function MediaPage() {
  return (
    <Suspense fallback={<MediaLoading />}>
      <MediaContent />
    </Suspense>
  );
}
