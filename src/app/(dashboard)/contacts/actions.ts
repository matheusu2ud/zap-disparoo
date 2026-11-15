"use server";

import ExcelJS from "exceljs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type ContactActionState = {
  error?: string;
  success?: string;
};

function getValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function getContactValues(formData: FormData) {
  const name = getValue(formData, "name");
  const phone = getValue(formData, "phone");
  const email = getValue(formData, "email");
  const notes = getValue(formData, "notes");

  if (name.length < 1 || name.length > 200) {
    return { error: "O nome deve ter entre 1 e 200 caracteres." } as const;
  }
  if (phone.length < 5 || phone.length > 32) {
    return { error: "Informe um telefone válido (5 a 32 caracteres)." } as const;
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { error: "Informe um e-mail válido ou deixe o campo vazio." } as const;
  }
  if (notes.length > 2000) {
    return { error: "As observações devem ter até 2.000 caracteres." } as const;
  }

  return { values: { name, phone, email: email || null, notes } } as const;
}

async function getAuthenticatedClient() {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    redirect("/login");
  }

  return { supabase, user };
}

function contactError(error: { code?: string; message: string }) {
  if (error.code === "23505") {
    return "Já existe um contato com esse telefone no seu espaço.";
  }

  if (error.code === "42501") {
    return "Você não tem permissão para alterar esse contato.";
  }

  return `Não foi possível salvar o contato: ${error.message}`;
}

export async function createContact(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const parsed = getContactValues(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { supabase, user } = await getAuthenticatedClient();
  const { error } = await supabase.from("contacts").insert({
    user_id: user.id,
    ...parsed.values,
    consent_status: "unknown",
  });

  if (error) return { error: contactError(error) };

  revalidatePath("/contatos");
  revalidatePath("/painel");
  return { success: "Contato cadastrado sem consentimento de envio." };
}

export async function updateContact(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const id = getValue(formData, "id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    return { error: "Identificador de contato inválido." };
  }

  const parsed = getContactValues(formData);
  if ("error" in parsed) return { error: parsed.error };

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("contacts")
    .update(parsed.values)
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) return { error: contactError(error) };
  if (!data) return { error: "Contato não encontrado ou sem permissão para edição." };

  revalidatePath("/contatos");
  revalidatePath("/painel");
  return { success: "Contato atualizado." };
}

export async function deleteContact(formData: FormData) {
  const id = getValue(formData, "id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new Error("Identificador de contato inválido.");
  }

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    if (error.code === "23503") {
      throw new Error(
        "Este contato possui registros de campanha e não pode ser excluído.",
      );
    }

    throw new Error(contactError(error));
  }
  if (!data) {
    throw new Error("Contato não encontrado ou sem permissão para exclusão.");
  }

  revalidatePath("/contatos");
  revalidatePath("/painel");
}

function parseCsvRows(csv: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];

    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && csv[index + 1] === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (quoted) return { error: "O CSV contém aspas sem fechamento." } as const;
  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return { rows } as const;
}

function normalizeHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export async function importContacts(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Selecione um arquivo CSV ou XLSX para importar." };
  }
  const fileName = file.name.toLowerCase();
  const isCsv = fileName.endsWith(".csv");
  const isXlsx = fileName.endsWith(".xlsx");
  if (!isCsv && !isXlsx) {
    return { error: "Formato inválido. Use um arquivo .csv ou .xlsx." };
  }
  if (file.size > 2_000_000) {
    return { error: "O arquivo deve ter no máximo 2 MB. Divida arquivos maiores." };
  }

  let parsedCsv: ReturnType<typeof parseCsvRows>;
  if (isCsv) {
    parsedCsv = parseCsvRows(await file.text());
  } else {
    try {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());
      const worksheet = workbook.worksheets[0];
      if (!worksheet) {
        return { error: "A planilha não contém uma aba com dados." };
      }
      if (worksheet.rowCount > 501 || worksheet.columnCount > 50) {
        return {
          error: "A primeira aba deve ter até 500 linhas de dados e 50 colunas.",
        };
      }

      const rows: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        rows.push(
          Array.from({ length: worksheet.columnCount }, (_, index) =>
            row.getCell(index + 1).text,
          ),
        );
      });
      parsedCsv = { rows };
    } catch {
      return { error: "Não foi possível ler a planilha .xlsx." };
    }
  }

  if ("error" in parsedCsv) return parsedCsv;
  if (parsedCsv.rows.length < 2) {
    return { error: "O CSV deve conter cabeçalho e pelo menos uma linha de dados." };
  }

  const headers = parsedCsv.rows[0].map(normalizeHeader);
  const nameIndex = headers.findIndex((header) => ["nome", "name"].includes(header));
  const phoneIndex = headers.findIndex((header) =>
    ["telefone", "phone", "celular"].includes(header),
  );
  const emailIndex = headers.findIndex((header) => header === "email");
  const notesIndex = headers.findIndex((header) =>
    ["observacoes", "notes"].includes(header),
  );

  if (nameIndex < 0 || phoneIndex < 0) {
    return {
      error: "O cabeçalho do CSV deve incluir as colunas nome e telefone.",
    };
  }

  const dataRows = parsedCsv.rows.slice(1);
  if (dataRows.length > 500) {
    return {
      error:
        "Cada importação aceita até 500 linhas. Divida o arquivo em lotes menores.",
    };
  }

  const contacts = new Map<
    string,
    { name: string; phone: string; email: string | null; notes: string }
  >();

  for (const [index, row] of dataRows.entries()) {
    const values: FormData = new FormData();
    values.set("name", row[nameIndex] ?? "");
    values.set("phone", row[phoneIndex] ?? "");
    values.set("email", emailIndex < 0 ? "" : row[emailIndex] ?? "");
    values.set("notes", notesIndex < 0 ? "" : row[notesIndex] ?? "");
    const parsed = getContactValues(values);
    if ("error" in parsed) {
      return { error: `Linha ${index + 2}: ${parsed.error}` };
    }

    const phoneKey = parsed.values.phone.replace(/\s+/g, "");
    if (!contacts.has(phoneKey)) contacts.set(phoneKey, parsed.values);
  }

  const { supabase, user } = await getAuthenticatedClient();
  const phoneNumbers = [...contacts.values()].map((contact) => contact.phone);
  const { data: existing, error: existingError } = await supabase
    .from("contacts")
    .select("phone")
    .eq("user_id", user.id)
    .in("phone", phoneNumbers);

  if (existingError) {
    return { error: "Não foi possível verificar contatos duplicados." };
  }

  const existingPhones = new Set((existing ?? []).map(({ phone }) => phone));
  const newContacts = [...contacts.values()]
    .filter(
      (contact) =>
        !existingPhones.has(contact.phone) &&
        !existingPhones.has(contact.phone.replace(/\s+/g, "")),
    )
    .map((contact) => ({
      user_id: user.id,
      ...contact,
      consent_status: "unknown" as const,
    }));

  if (newContacts.length === 0) {
    return {
      success: `Nenhum contato novo. ${dataRows.length} linha(s) ignorada(s) por duplicidade.`,
    };
  }

  const { error } = await supabase.from("contacts").insert(newContacts);
  if (error) return { error: contactError(error) };

  revalidatePath("/contatos");
  revalidatePath("/painel");
  return {
    success: `${newContacts.length} contato(s) importado(s) sem consentimento de envio.`,
  };
}

export async function createContactTag(
  _previousState: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const contactId = getValue(formData, "contactId");
  const tagName = getValue(formData, "tagName");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(contactId)) {
    return { error: "Identificador de contato inválido." };
  }
  if (tagName.length < 1 || tagName.length > 60) {
    return { error: "A etiqueta deve ter entre 1 e 60 caracteres." };
  }

  const { supabase, user } = await getAuthenticatedClient();
  const { error } = await supabase.from("contact_tags").insert({
    user_id: user.id,
    contact_id: contactId,
    tag_name: tagName,
  });

  if (error?.code === "23505") {
    return { error: "Essa etiqueta já está associada ao contato." };
  }
  if (error) return { error: contactError(error) };

  revalidatePath("/contatos");
  return { success: "Etiqueta adicionada." };
}

export async function deleteContactTag(formData: FormData) {
  const tagId = getValue(formData, "tagId");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(tagId)) {
    throw new Error("Identificador de etiqueta inválido.");
  }

  const { supabase, user } = await getAuthenticatedClient();
  const { data, error } = await supabase
    .from("contact_tags")
    .delete()
    .eq("id", tagId)
    .eq("user_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) throw new Error(contactError(error));
  if (!data) throw new Error("Etiqueta não encontrada ou sem permissão.");

  revalidatePath("/contatos");
}
