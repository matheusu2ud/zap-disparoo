import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseConfig } from "@/lib/supabase/config";

const columns = ["name", "phone", "email", "consent_status", "notes"];

function csvCell(value: string | null) {
  const safeValue = (value ?? "").replace(/^[\s\u0000-\u001f]*[=+\-@]/, "'$&");
  const escaped = safeValue.replaceAll('"', '""');
  return `"${escaped}"`;
}

export async function GET(request: NextRequest) {
  if (!getSupabaseConfig()) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError) {
    return new NextResponse("Não foi possível verificar a sessão.", {
      status: 503,
    });
  }
  if (!user) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(`\uFEFF${columns.join(",")}\r\n`));

      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("contacts")
          .select("name, phone, email, consent_status, notes")
          .eq("user_id", user.id)
          .order("created_at", { ascending: true })
          .range(offset, offset + 499);

        if (error) {
          controller.error(new Error("Falha ao exportar a lista de contatos."));
          return;
        }

        for (const contact of data ?? []) {
          const line = columns
            .map((column) =>
              csvCell(contact[column as keyof typeof contact] ?? ""),
            )
            .join(",");
          controller.enqueue(encoder.encode(`${line}\r\n`));
        }

        if (!data || data.length < 500) break;
      }

      controller.close();
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="broadcast-hub-contatos.csv"',
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
