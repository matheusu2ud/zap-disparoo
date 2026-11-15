"use client";

import Image from "next/image";
import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { deleteMedia, uploadMedia, type MediaActionState } from "./actions";

export type MediaRow = {
  id: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  created_at: string;
  signedUrl: string | null;
};

function ActionMessage({ state }: { state: MediaActionState }) {
  if (state.error) {
    return (
      <p className="library-action-message is-error" role="alert">
        {state.error}
      </p>
    );
  }
  if (state.success) {
    return (
      <p className="library-action-message is-success" role="status">
        {state.success}
      </p>
    );
  }
  return null;
}

function formatFileSize(size: number) {
  if (size < 1024 * 1024) {
    return `${Math.max(1, Math.round(size / 1024))} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function MediaUploadForm() {
  const [state, formAction, pending] = useActionState<
    MediaActionState,
    FormData
  >(uploadMedia, {});

  return (
    <details className="library-create-disclosure">
      <summary className="primary-button">
        <span aria-hidden="true">+</span>
        Enviar arquivo
      </summary>
      <form className="library-create-form" action={formAction}>
        <h2>Adicionar mídia</h2>
        <p>Arquivos ficam privados e só podem ser acessados pela sua conta.</p>
        <label className="library-field">
          <span>Arquivo</span>
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp,application/pdf,video/mp4"
            required
          />
        </label>
        <span className="media-upload-hint">
          JPG, PNG, WebP, PDF ou MP4. Tamanho máximo: 10 MB.
        </span>
        <ActionMessage state={state} />
        <button className="primary-button" type="submit" disabled={pending}>
          {pending ? "Enviando..." : "Enviar para biblioteca"}
        </button>
      </form>
    </details>
  );
}

function MediaCard({ media }: { media: MediaRow }) {
  const router = useRouter();
  const [state, formAction, pending] = useActionState<
    MediaActionState,
    FormData
  >(deleteMedia, {});

  useEffect(() => {
    if (state.success) router.refresh();
  }, [router, state.success]);

  const isImage = media.content_type.startsWith("image/");
  const typeLabel =
    media.content_type === "application/pdf"
      ? "PDF"
      : media.content_type === "video/mp4"
        ? "MP4"
        : media.content_type.replace("image/", "").toUpperCase();

  return (
    <article className="media-card">
      <a
        className="media-preview"
        href={media.signedUrl ?? undefined}
        target="_blank"
        rel="noreferrer"
        aria-label={`Abrir ${media.file_name}`}
      >
        {media.signedUrl && isImage ? (
          <Image
            src={media.signedUrl}
            alt=""
            width={500}
            height={320}
            unoptimized
          />
        ) : (
          <span className="media-file-type">{typeLabel}</span>
        )}
      </a>
      <div className="media-card-details">
        <strong title={media.file_name}>{media.file_name}</strong>
        <span>
          {typeLabel} · {formatFileSize(media.size_bytes)}
        </span>
        <span>
          {new Intl.DateTimeFormat("pt-BR", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          }).format(new Date(media.created_at))}
        </span>
      </div>
      <form
        action={formAction}
        onSubmit={(event) => {
          if (!window.confirm(`Excluir o arquivo "${media.file_name}"?`)) {
            event.preventDefault();
          }
        }}
      >
        <input type="hidden" name="id" value={media.id} />
        <button className="connection-danger" type="submit" disabled={pending}>
          {pending ? "Excluindo..." : "Excluir"}
        </button>
      </form>
      <ActionMessage state={state} />
    </article>
  );
}

export function MediaGrid({ files }: { files: MediaRow[] }) {
  return (
    <div className="media-grid">
      {files.map((media) => (
        <MediaCard key={media.id} media={media} />
      ))}
    </div>
  );
}
