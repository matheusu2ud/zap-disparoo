"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type MediaActionState = {
  error?: string;
  success?: string;
};

const bucket = "broadcast-media";
const maxFileSize = 10 * 1024 * 1024;
const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["application/pdf", "pdf"],
  ["video/mp4", "mp4"],
]);

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error) throw new Error("Não foi possível verificar sua sessão.");
  if (!user) redirect("/login");

  return { supabase, user };
}

function getFileName(value: string) {
  const name = value
    .split(/[\\/]/)
    .pop()
    ?.replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 255);
  return name || "arquivo";
}

function hasExpectedSignature(type: string, bytes: Uint8Array) {
  if (type === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (type === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47 &&
      bytes[4] === 0x0d &&
      bytes[5] === 0x0a &&
      bytes[6] === 0x1a &&
      bytes[7] === 0x0a
    );
  }
  if (type === "image/webp") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP"
    );
  }
  if (type === "application/pdf") {
    return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  }
  if (type === "video/mp4") {
    return (
      bytes.length >= 12 &&
      String.fromCharCode(...bytes.slice(4, 8)) === "ftyp"
    );
  }
  return false;
}

export async function uploadMedia(
  _previousState: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo para enviar." };
  }
  if (file.size > maxFileSize) {
    return { error: "O arquivo deve ter no máximo 10 MB." };
  }

  const extension = allowedTypes.get(file.type);
  if (!extension) {
    return {
      error: "Formato não permitido. Envie JPG, PNG, WebP, PDF ou MP4.",
    };
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!hasExpectedSignature(file.type, bytes)) {
    return {
      error: "O conteúdo do arquivo não corresponde ao formato informado.",
    };
  }

  const { supabase, user } = await getAuthenticatedClient();
  const storagePath = `${user.id}/${randomUUID()}.${extension}`;
  const fileName = getFileName(file.name);
  const { error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes, {
      contentType: file.type,
      cacheControl: "3600",
      upsert: false,
    });

  if (uploadError) {
    return {
      error:
        uploadError.message.includes("Payload too large")
          ? "O arquivo excede o limite permitido pelo armazenamento."
          : `Não foi possível enviar o arquivo: ${uploadError.message}`,
    };
  }

  const { error: metadataError } = await supabase.from("media_files").insert({
    user_id: user.id,
    file_name: fileName,
    storage_path: storagePath,
    content_type: file.type,
    size_bytes: file.size,
  });

  if (metadataError) {
    const { error: cleanupError } = await supabase.storage
      .from(bucket)
      .remove([storagePath]);
    return {
      error: cleanupError
        ? "O arquivo foi enviado, mas não foi possível salvar seus dados nem removê-lo do armazenamento. Contate o suporte."
        : `Não foi possível registrar o arquivo: ${metadataError.message}`,
    };
  }

  revalidatePath("/media");
  return { success: "Arquivo enviado para sua biblioteca privada." };
}

export async function deleteMedia(
  _previousState: MediaActionState,
  formData: FormData,
): Promise<MediaActionState> {
  const idValue = formData.get("id");
  const id = typeof idValue === "string" ? idValue.trim() : "";
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      id,
    )
  ) {
    return { error: "Identificador de arquivo inválido." };
  }

  const { supabase, user } = await getAuthenticatedClient();
  const { data: media, error: lookupError } = await supabase
    .from("media_files")
    .select("id, storage_path")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (lookupError) {
    return { error: `Não foi possível localizar o arquivo: ${lookupError.message}` };
  }
  if (!media) return { error: "Arquivo não encontrado ou sem permissão." };

  const { error: storageError } = await supabase.storage
    .from(bucket)
    .remove([media.storage_path]);
  if (storageError) {
    return {
      error: `Não foi possível remover o arquivo do armazenamento: ${storageError.message}`,
    };
  }

  const { data, error } = await supabase
    .from("media_files")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error || !data) {
    return {
      error: error
        ? `O arquivo foi removido, mas os dados não puderam ser atualizados: ${error.message}`
        : "O arquivo foi removido, mas o registro não pôde ser atualizado. Atualize a página.",
    };
  }

  revalidatePath("/media");
  revalidatePath("/templates");
  return { success: "Arquivo excluído." };
}
