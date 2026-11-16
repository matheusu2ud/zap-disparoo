"use server";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/workers/fire
 * Rota chamada pelo front-end após agendar a campanha.
 * Verifica autenticação do usuário via Supabase, depois chama internamente
 * o trigger do worker com o secret correto (nunca exposto ao browser).
 */
export async function POST(request: NextRequest) {
  // Verifica se o usuário está autenticado
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const secret = process.env.CAMPAIGN_WORKER_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    return NextResponse.json(
      {
        error:
          "Configure CAMPAIGN_WORKER_SECRET (32+ caracteres) e CAMPAIGN_SEND_ENABLED=true no Netlify.",
      },
      { status: 503 },
    );
  }

  if (process.env.CAMPAIGN_SEND_ENABLED !== "true") {
    return NextResponse.json(
      { error: "Configure CAMPAIGN_SEND_ENABLED=true no Netlify para ativar os disparos." },
      { status: 503 },
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const workerUrl = `${baseUrl}/api/workers/campaigns`;

  let sent = 0;
  let failed = 0;
  let skipped = 0;
  const maxRounds = 1000;

  for (let i = 0; i < maxRounds; i++) {
    let res: Response;
    try {
      res = await fetch(workerUrl, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
      });
    } catch {
      break;
    }

    if (!res.ok) break;

    const data = (await res.json().catch(() => ({}))) as {
      processed?: boolean;
      outcome?: string;
    };

    if (!data.processed) break; // fila vazia

    if (data.outcome === "sent") sent++;
    else if (data.outcome === "failed") failed++;
    else skipped++;

    // Pausa anti-ban entre mensagens
    await new Promise((r) => setTimeout(r, 600));
  }

  return NextResponse.json({ sent, failed, skipped });
}
