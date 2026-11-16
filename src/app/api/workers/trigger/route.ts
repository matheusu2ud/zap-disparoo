"use server";
import { NextResponse, type NextRequest } from "next/server";

/**
 * POST /api/workers/trigger
 * Chama o worker de campanhas em loop até que não haja mais itens na fila.
 * Requer o mesmo CAMPAIGN_WORKER_SECRET como Bearer token.
 * Aceita opcionalmente { maxRounds: number } no body para limitar iterações.
 */
export async function POST(request: NextRequest) {
  const secret = process.env.CAMPAIGN_WORKER_SECRET?.trim();
  if (!secret || Buffer.byteLength(secret) < 32) {
    return NextResponse.json(
      { error: "CAMPAIGN_WORKER_SECRET não configurado (mínimo 32 caracteres)." },
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? request.nextUrl.origin;
  const workerUrl = `${baseUrl}/api/workers/campaigns`;

  let maxRounds = 500;
  try {
    const body = await request.json().catch(() => ({}));
    if (body?.maxRounds && Number.isInteger(body.maxRounds)) {
      maxRounds = Math.min(body.maxRounds, 2000);
    }
  } catch {
    // sem body — usa padrão
  }

  const results: string[] = [];
  let sent = 0;
  let failed = 0;
  let skipped = 0;

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
    } catch (err) {
      results.push(`round ${i + 1}: erro de rede — ${err}`);
      break;
    }

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      results.push(`round ${i + 1}: worker retornou ${res.status} — ${text}`);
      break;
    }

    const data = (await res.json().catch(() => ({}))) as {
      processed?: boolean;
      outcome?: string;
    };

    if (!data.processed) {
      // fila vazia — encerrar loop
      results.push(`round ${i + 1}: fila vazia, encerrado.`);
      break;
    }

    if (data.outcome === "sent") sent++;
    else if (data.outcome === "failed") failed++;
    else skipped++;

    results.push(`round ${i + 1}: ${data.outcome}`);

    // pequena pausa entre envios para evitar ban (500ms)
    await new Promise((r) => setTimeout(r, 500));
  }

  return NextResponse.json({ sent, failed, skipped, log: results });
}
