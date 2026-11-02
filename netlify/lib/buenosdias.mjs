// Mensaje de buenos días para el canal, a partir de cómo fue la noche anterior (hora de Miami).
import { getDatabase } from "@netlify/database";
import { getStore } from "@netlify/blobs";
import { askClaude, parseJSON } from "./deportes.mjs";

let _db;
const db = () => (_db ||= getDatabase());
const store = () => getStore({ name: "estado", consistency: "strong" });

export const WEB = "lasmielespicks.com";
export const PROMO_MIELES50 = "🔥 HOY 50% OFF en todas las suscripciones diarias con el código MIELES50, aprovecha";

// Orden y etiqueta de cada sección en el mensaje
const LABELS = [
  ["soccer:vip", "🏆 JUGADA VIP"],
  ["exclusiva:principal", "⭐ EXCLUSIVA"],
  ["asegurada:principal", "🔒 ASEGURADA"],
  ["props:principal", "🎯 PLAYER PROPS"],
  ["instagram:principal", "💎 Pick de INSTAGRAM"],
  ["free:principal", "🆓 FREE PICK"],
  ["soccer:pick5", "⚽ PICK EXTRA"],
  ["exclusiva:extra5", "🔥 PICK EXTRA"],
];
const SPORT_EMOJI = { MLB: "⚾", NHL: "🏒", SOCCER: "⚽", NBA: "🏀", UFC: "🥊", NCAAF: "🏈", NCAAB: "🏀", NFL: "🏈" };
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export const fmtOdds = (o) => (o == null || o === "" || !isFinite(Number(o)) || Number(o) === 0 ? "" : Number(o) > 0 ? "+" + Number(o) : String(Number(o)));
export const miamiDate = (t = Date.now()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date(t));
export const madridParts = (t = Date.now()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", hourCycle: "h23", weekday: "short" });
  const o = Object.fromEntries(f.formatToParts(new Date(t)).map((p) => [p.type, p.value]));
  return { date: `${o.year}-${o.month}-${o.day}`, hour: Number(o.hour) };
};

// Una línea por paquete cobrado, como en el canal (sin picks ni cuotas)
function lineasPaquetes(picks) {
  const g = {};
  for (const p of picks) {
    let key = p.package + ":" + p.section;
    if (key === "soccer:pick5" || key === "exclusiva:extra5") key = "extras";
    const e = (g[key] ||= { w: 0, l: 0 });
    if (p.result === "ganado") e.w++; else if (p.result === "perdido") e.l++;
  }
  const out = [];
  for (const [key, label] of [...LABELS.filter((l) => !l[1].includes("EXTRA")), ["extras", "🔥 PICKS EXTRAS"]]) {
    const e = g[key]; if (!e || !e.w) continue;
    const name = label.replace(/^\S+\s/, ""), emo = label.split(" ")[0];
    out.push(e.w > 1 && !e.l ? `${emo} PERFECT de ${name} ✅` : `${emo} ${name} ✅`);
  }
  return out;
}

/* Datos de la noche */
export async function datosNoche(date) {
  const rows = await db().sql`SELECT data FROM picks WHERE date = ${date} ORDER BY data->>'createdAt', (data->>'ord')::int`;
  const picks = rows.map((r) => r.data);
  const t = { ganados: 0, perdidos: 0, nulos: 0, pendientes: 0, net: 0 };
  for (const p of picks) {
    const r = p.result || "pendiente", u = Number(p.units) || 0, o = Number(p.odds);
    if (r === "ganado") { t.ganados++; if (o) t.net += o > 0 ? (u * o) / 100 : (u * 100) / -o; }
    else if (r === "perdido") { t.perdidos++; t.net -= u; }
    else if (r === "nulo") t.nulos++;
    else t.pendientes++;
  }
  t.net = Math.round(t.net * 10) / 10;
  return { date, picks, t };
}

/* Texto base (sin promo y sin "CONFÍA") + cabecera para ti */
export async function generar(date) {
  const { picks, t } = await datosNoche(date);
  const lineas = lineasPaquetes(picks);
  // Resumen por paquete para Claude (perfects, fallos)
  const porPaquete = {};
  for (const p of picks) {
    const k = p.package + ":" + p.section;
    const e = (porPaquete[k] ||= { paquete: (LABELS.find((l) => l[0] === k) || [k, k])[1], ganados: 0, perdidos: 0, pendientes: 0, deportes: new Set(), fallos: [] });
    e.deportes.add(p.sport);
    if (p.result === "ganado") e.ganados++;
    else if (p.result === "perdido") { e.perdidos++; e.fallos.push({ jugada: p.pick, nota: p.resultNote || "", marcador: p.final ? p.final.score : "" }); }
    else if (p.result !== "nulo") e.pendientes++;
  }
  const resumen = Object.values(porPaquete).map((e) => ({ ...e, deportes: [...e.deportes] }));
  const hoyMadrid = madridParts().date;
  const dia = DIAS[new Date(hoyMadrid + "T12:00:00Z").getUTCDay()];

  let apertura = [], animo = "";
  if (picks.length) {
    try {
      const prompt = `Escribes para el canal de Telegram de "Las Mieles Picks" (pronósticos deportivos, español latino, tono cercano y de celebración, mensajes muy cortos, emoji de marca 🍯).
Vocabulario típico: familia, muchachos, mi gente, cobrar, facturar, "quitarle al banco", "en el bolsillo", "la rompimos", "seguimos con la racha", "vamos al lío", "PERFECT" (= todos acertados), "SIN SUSTO" (= la Asegurada).
Cuando se falla algo se dice claro, sin drama, con el motivo en pocas palabras y en positivo ("hoy la recuperamos🍯💪").
Ejemplos reales de aperturas: "Anoche la rompimos otra vez💪" · "Seguimos con la racha durísima que llevamos🔥" · "Ayer nos fuimos positivos en la jornada completa" · "No metimos Perfect pero nos fuimos 2✅ de 3 con jugada vip incluida🔥" · "Solo fallamos la de 3 unidades mi gente".
Ejemplos de ánimo: "Hoy volvemos con todo para seguir facturando💸" · "Vamos hoy de nuevo con todo🔥" · "Hoy es viernes payday!🍯" · "Día de Sunday NFL🔥🏈".

Hoy es ${dia}. Resultado de anoche: ${t.ganados} ganados, ${t.perdidos} perdidos, ${t.nulos} nulos, ${t.pendientes} sin terminar.
Por paquete: ${JSON.stringify(resumen)}

Escribe SOLO:
- "apertura": 1 o 2 líneas cortas que van justo después de "Buenos días familia🍯", resumiendo cómo fue la noche (si hubo PERFECT en algún paquete, dilo; si se falló algo importante, menciónalo breve y en positivo). No listes los picks: la lista ya va aparte.
- "animo": 1 línea corta para hoy.
Varía las frases respecto a los ejemplos para que suene natural. No inventes datos ni resultados. Sin hashtags.
Formato: {"apertura":["..."],"animo":"..."}`;
      const j = parseJSON(await askClaude(prompt, { quick: true, maxTokens: 400 }));
      if (j && Array.isArray(j.apertura)) apertura = j.apertura.map(String).filter(Boolean).slice(0, 2);
      if (j && j.animo) animo = String(j.animo);
    } catch (e) { console.warn("buenos días claude", e.message); }
  }
  if (!apertura.length) apertura = [t.ganados > t.perdidos ? "Anoche la rompimos otra vez💪" : t.ganados ? "Anoche cobramos y seguimos sumando💪" : "Anoche no se nos dio, pero hoy la recuperamos🍯💪"];
  if (!animo) animo = "Hoy volvemos con todo para seguir facturando💸";

  const cuerpo = ["Buenos días familia🍯", ...apertura, ...lineas, "", animo].join("\n");
  const doc = { fecha: date, cuerpo, t, creado: Date.now() };
  await store().setJSON("bd-" + date, doc);
  return doc;
}

export async function leerGuardado(date) {
  try { return await store().get("bd-" + date, { type: "json" }); } catch { return null; }
}

/* Mensaje final con las promos elegidas */
export function componer(cuerpo, promos = []) {
  const ps = promos.filter(Boolean);
  return cuerpo + "\n" + (ps.length ? "\n" + ps.join("\n") + "\n👉 " + WEB + "\n" : "") + "\nCONFÍA🍯";
}
