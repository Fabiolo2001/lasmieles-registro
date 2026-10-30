// API del Registro Las Mieles.
// Rutas:
//   POST /api/login            {name, password}  -> cookie de sesión
//   POST /api/logout
//   GET  /api/me
//   GET  /api/docs/:table[?month=YYYY-MM]        (table: picks | notes)
//   PUT  /api/docs/:table/:id   (reemplaza)      PATCH (mezcla)   DELETE
//   POST /api/fotos            (cuerpo = imagen) -> {id}
//   GET  /api/fotos/<id>
//   POST /api/leer             {prompt, images:[{type,data}]} -> texto en streaming
import crypto from "node:crypto";
import { COOKIE, sign, verify, sameText } from "../lib/sesion.mjs";
import { scoreboard, LEAGUES } from "../lib/deportes.mjs";
import { notify, esc as tesc } from "../lib/telegram.mjs";
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import Anthropic from "@anthropic-ai/sdk";

const DAYS = 30;
const json = (o, status = 200, headers = {}) =>
  new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/* ---------- Datos ---------- */
const TABLES = new Set(["picks", "notes"]);
let _db;
const db = () => (_db ||= getDatabase());

async function listDocs(table, month) {
  const sql = db().sql;
  if (table === "picks") {
    return month
      ? await sql`SELECT id, data FROM picks WHERE month = ${month} ORDER BY id`
      : await sql`SELECT id, data FROM picks ORDER BY id`;
  }
  return await sql`SELECT id, data FROM notes ORDER BY id`;
}
async function setDoc(table, id, data) {
  const sql = db().sql;
  const j = JSON.stringify(data);
  const month = data.month || null, date = data.date || null;
  if (table === "picks") {
    await sql`INSERT INTO picks (id, month, date, data, updated_at) VALUES (${id}, ${month}, ${date}, ${j}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET month = EXCLUDED.month, date = EXCLUDED.date, data = EXCLUDED.data, updated_at = now()`;
  } else {
    await sql`INSERT INTO notes (id, month, date, data, updated_at) VALUES (${id}, ${month}, ${date}, ${j}::jsonb, now())
      ON CONFLICT (id) DO UPDATE SET month = EXCLUDED.month, date = EXCLUDED.date, data = EXCLUDED.data, updated_at = now()`;
  }
}
async function patchDoc(table, id, patch) {
  const sql = db().sql;
  const j = JSON.stringify(patch);
  const rows = table === "picks"
    ? await sql`UPDATE picks SET data = data || ${j}::jsonb,
        month = COALESCE((${j}::jsonb)->>'month', month), date = COALESCE((${j}::jsonb)->>'date', date), updated_at = now()
        WHERE id = ${id} RETURNING id`
    : await sql`UPDATE notes SET data = data || ${j}::jsonb,
        month = COALESCE((${j}::jsonb)->>'month', month), date = COALESCE((${j}::jsonb)->>'date', date), updated_at = now()
        WHERE id = ${id} RETURNING id`;
  return rows.length > 0;
}
async function deleteDoc(table, id) {
  const sql = db().sql;
  if (table === "picks") await sql`DELETE FROM picks WHERE id = ${id}`;
  else await sql`DELETE FROM notes WHERE id = ${id}`;
}

/* ---------- Fotos ---------- */
const fotos = () => getStore({ name: "fotos", consistency: "strong" });
const OK_IMG = ["image/jpeg", "image/png", "image/webp", "image/gif"];

/* ---------- Lectura con Claude (AI Gateway de Netlify) ---------- */
const MODELS = () => [Netlify.env.get("ANTHROPIC_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929"].filter(Boolean);

async function leer(req) {
  let body;
  try { body = await req.json(); } catch { return json({ error: "Petición no válida" }, 400); }
  const prompt = typeof body.prompt === "string" ? body.prompt : "";
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  if (!prompt || prompt.length > 300000) return json({ error: "Texto vacío o demasiado largo" }, 400);
  for (const im of images) {
    if (!im || !OK_IMG.includes(im.type) || typeof im.data !== "string" || im.data.length > 3_000_000) return json({ error: "Imagen no válida" }, 413);
  }
  const content = [
    ...images.map((im) => ({ type: "image", source: { type: "base64", media_type: im.type, data: im.data } })),
    { type: "text", text: prompt + "\n\nResponde solo con el JSON pedido, sin texto antes ni después." },
  ];
  const anthropic = new Anthropic();
  let stream, lastErr;
  for (const model of MODELS()) {
    try {
      stream = await anthropic.messages.create({ model, max_tokens: 8000, stream: true, messages: [{ role: "user", content }] });
      break;
    } catch (e) {
      lastErr = e;
      const s = e && e.status;
      if (s === 404 || (s === 400 && /model/i.test(String(e.message)))) continue; // probar el siguiente modelo
      break;
    }
  }
  if (!stream) {
    console.error("Claude", lastErr && lastErr.status, lastErr && lastErr.message);
    const s = lastErr && lastErr.status;
    return json({ error: s === 429 || s === 529 ? "Demasiadas lecturas, espera un momento" : "No se pudo leer con Claude" }, s === 429 || s === 529 ? 429 : 502);
  }
  const enc = new TextEncoder();
  const out = new ReadableStream({
    async start(controller) {
      let stop = null;
      try {
        for await (const ev of stream) {
          if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
          else if (ev.type === "message_delta" && ev.delta) stop = ev.delta.stop_reason;
        }
        if (stop === "max_tokens") controller.enqueue(enc.encode("\u0000CORTADO"));
        if (stop === "refusal") controller.enqueue(enc.encode("\u0000RECHAZADO"));
      } catch (e) {
        console.error("Claude stream", e && e.message);
        controller.enqueue(enc.encode("\u0000ERROR"));
      }
      controller.close();
    },
  });
  return new Response(out, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}


/* ---------- Aviso de cambios a mano ---------- */
const PKN = { soccer: "Soccer", exclusiva: "Exclusiva", asegurada: "Asegurada", props: "Player Props", free: "Free Pick", instagram: "Instagram" };
const SECN = { vip: "Jugada VIP", pick5: "Picks extras", extra5: "Picks extras" };
const ICON = { ganado: "✅", perdido: "❌", nulo: "➖", pendiente: "↩️" };
async function avisoManual(p, prev, who) {
  const res = p.result || "pendiente";
  const day = await db().sql`SELECT data->>'result' AS r, (data->>'units')::float AS u FROM picks WHERE date = ${p.date}`;
  const t = { g: 0, l: 0, n: 0, pend: 0, ug: 0, ul: 0 };
  for (const x of day) { const u = x.u || 0; if (x.r === "ganado") { t.g++; t.ug += u; } else if (x.r === "perdido") { t.l++; t.ul += u; } else if (x.r === "nulo") t.n++; else t.pend++; }
  const net = t.ug - t.ul;
  const head = res === "pendiente" ? `${ICON.pendiente} <b>VUELTO A PENDIENTE</b> (antes ${tesc(prev)})` : `${ICON[res]} <b>${tesc(res.toUpperCase())}</b>${prev !== "pendiente" ? ` (antes ${tesc(prev)})` : ""}`;
  const txt = `${head} · ${tesc(SECN[p.section] || PKN[p.package] || p.package)} · ${tesc(p.units)} U\n${tesc(p.pick)}\n` +
    (p.final && p.final.score ? `${tesc(p.final.score)}${p.final.detail ? " · " + tesc(p.final.detail) : ""}\n` : "") +
    `<i>Cambiado a mano por ${tesc(who || "alguien del equipo")}</i>\n\nDía ${tesc(p.date)}: ${t.g}-${t.l}-${t.n} · ${net >= 0 ? "+" : ""}${net} U${t.pend ? ` · ${t.pend} pendiente${t.pend === 1 ? "" : "s"}` : ""}`;
  await notify(txt);
}
/* ---------- Router ---------- */
export default async (req, context) => {
  const url = new URL(req.url);
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean).map(decodeURIComponent);
  const route = parts[0] || "";
  const m = req.method;

  try {
    if (route === "login" && m === "POST") {
      const team = Netlify.env.get("TEAM_PASSWORD");
      if (!team) return json({ error: "Falta configurar TEAM_PASSWORD" }, 500);
      let b = {};
      try { b = await req.json(); } catch {}
      const name = String(b.name || "").trim().slice(0, 40);
      if (!name) return json({ error: "Escribe tu nombre" }, 400);
      if (!sameText(b.password || "", team)) return json({ error: "Contraseña incorrecta" }, 401);
      const exp = Date.now() + DAYS * 864e5;
      context.cookies.set({ name: COOKIE, value: sign({ n: name, exp }), path: "/", httpOnly: true, secure: true, sameSite: "Lax", expires: new Date(exp) });
      return json({ name });
    }
    // Marcadores públicos (no contienen datos del equipo)
    if (route === "marcadores" && m === "GET") {
      const lg = url.searchParams.get("l") || "", d = url.searchParams.get("d") || "";
      if (!LEAGUES[lg] || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "Parámetros no válidos" }, 400);
      return json(await scoreboard(lg, d), 200, { "cache-control": "public, max-age=20" });
    }
    // Mensaje de prueba de los avisos de Telegram (protegido con RESUMEN_KEY)
    if (route === "aviso-prueba" && m === "GET") {
      const key = Netlify.env.get("RESUMEN_KEY");
      if (!key || !sameText(url.searchParams.get("k") || "", key)) return json({ error: "Clave no válida" }, 401);
      const ok = await notify("✅ <b>Prueba</b>\nLos avisos del Registro Las Mieles están activos. Te escribiré aquí cada vez que se marque un pick.");
      return json({ enviado: ok, token: !!Netlify.env.get("TELEGRAM_BOT_TOKEN"), chat: !!Netlify.env.get("TELEGRAM_CHAT_ID") });
    }
    // Resumen del día para la tarea del mensaje de buenos días (protegido con clave RESUMEN_KEY)
    if (route === "resumen" && m === "GET") {
      const key = Netlify.env.get("RESUMEN_KEY");
      if (!key || !sameText(url.searchParams.get("k") || "", key)) return json({ error: "Clave no válida" }, 401);
      const d = url.searchParams.get("d") || new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(Date.now() - 864e5));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return json({ error: "Fecha no válida" }, 400);
      const rows = await db().sql`SELECT id, data FROM picks WHERE date = ${d} ORDER BY data->>'createdAt', (data->>'ord')::int`;
      const picks = rows.map((r) => { const p = r.data; return { paquete: p.package, seccion: p.section, deporte: p.sport, jugada: p.pick, partido: (p.game && p.game.name) || p.event || "", tipo: p.betType,
        unidades: p.units, cuota: p.odds ?? null, resultado: p.result || "pendiente", nota: p.resultNote || "", marcador: p.final ? p.final.score + (p.final.detail ? " (" + p.final.detail + ")" : "") : "",
        selecciones: Array.isArray(p.legs) ? p.legs.map((l) => ({ texto: l.text, resultado: l.result || null, marcador: l.final ? l.final.score : "" })) : undefined }; });
      const t = { ganados: 0, perdidos: 0, nulos: 0, pendientes: 0, unidadesGanadas: 0, unidadesPerdidas: 0 };
      for (const p of picks) { const u = Number(p.unidades) || 0; if (p.resultado === "ganado") { t.ganados++; t.unidadesGanadas += u; } else if (p.resultado === "perdido") { t.perdidos++; t.unidadesPerdidas += u; } else if (p.resultado === "nulo") t.nulos++; else t.pendientes++; }
      return json({ fecha: d, totales: t, picks });
    }
    if (route === "logout") {
      context.cookies.delete({ name: COOKIE, path: "/" });
      return json({ ok: true });
    }

    const ses = verify(context.cookies.get(COOKIE));
    if (!ses) return json({ error: "Inicia sesión" }, 401);

    if (route === "me") return json({ name: ses.n });

    if (route === "docs") {
      const table = parts[1], id = parts[2];
      if (!TABLES.has(table)) return json({ error: "Tabla no válida" }, 404);
      if (!id && m === "GET") {
        const month = url.searchParams.get("month");
        if (month && !/^\d{4}-\d{2}$/.test(month)) return json({ error: "Mes no válido" }, 400);
        return json(await listDocs(table, month));
      }
      if (!id || !/^[A-Za-z0-9_.:-]{1,80}$/.test(id)) return json({ error: "Id no válido" }, 400);
      if (m === "PUT" || m === "PATCH") {
        let data;
        try { data = await req.json(); } catch { return json({ error: "Datos no válidos" }, 400); }
        if (!data || typeof data !== "object" || Array.isArray(data)) return json({ error: "Datos no válidos" }, 400);
        if (JSON.stringify(data).length > 200000) return json({ error: "Demasiado grande" }, 413);
        if (m === "PUT") { await setDoc(table, id, data); return json({ ok: true }); }
        // Cambio de resultado a mano: aviso por Telegram
        let before = null;
        if (table === "picks" && typeof data.result === "string") {
          const r = await db().sql`SELECT data FROM picks WHERE id = ${id}`;
          before = r[0] ? r[0].data : null;
        }
        const found = await patchDoc(table, id, data);
        if (found && before && (before.result || "pendiente") !== data.result) {
          try { await avisoManual({ ...before, ...data }, before.result || "pendiente", ses.n); } catch (e) { console.warn("aviso manual", e.message); }
        }
        return found ? json({ ok: true }) : json({ error: "No existe" }, 404);
      }
      if (m === "DELETE") { await deleteDoc(table, id); return json({ ok: true }); }
      return json({ error: "Método no permitido" }, 405);
    }

    if (route === "fotos") {
      if (m === "POST") {
        const type = (req.headers.get("content-type") || "").split(";")[0].trim();
        if (!OK_IMG.includes(type)) return json({ error: "Tipo de imagen no válido" }, 415);
        const buf = await req.arrayBuffer();
        if (!buf.byteLength || buf.byteLength > 4_000_000) return json({ error: "Imagen vacía o demasiado grande" }, 413);
        const ext = type.split("/")[1].replace("jpeg", "jpg");
        const id = new Date().toISOString().slice(0, 7) + "/" + crypto.randomUUID() + "." + ext;
        await fotos().set(id, buf, { metadata: { type, by: ses.n } });
        return json({ id });
      }
      if (m === "GET") {
        const id = parts.slice(1).join("/");
        if (!id) return json({ error: "Falta la foto" }, 400);
        const r = await fotos().getWithMetadata(id, { type: "arrayBuffer" });
        if (!r) return new Response("No encontrada", { status: 404 });
        return new Response(r.data, { headers: { "content-type": (r.metadata && r.metadata.type) || "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
      }
      return json({ error: "Método no permitido" }, 405);
    }

    if (route === "leer" && m === "POST") return await leer(req);

    return json({ error: "No encontrado" }, 404);
  } catch (e) {
    console.error(e);
    return json({ error: "Error del servidor" }, 500);
  }
};

export const config = { path: "/api/*" };
