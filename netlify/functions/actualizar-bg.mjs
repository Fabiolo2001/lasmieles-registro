// Función en segundo plano: vincula picks con su partido, sigue los partidos en vivo
// y califica los terminados. La lanzan la página (al guardar o abrir) y la tarea programada.
import { runUpdate } from "../lib/deportes.mjs";
import { verify, COOKIE, cronKey, sameText } from "../lib/sesion.mjs";

export default async (req, context) => {
  const fromCron = sameText(req.headers.get("x-cron") || "", cronKey());
  const ses = verify(context.cookies.get(COOKIE));
  if (!fromCron && !ses) return;
  let ids = null;
  try { const b = await req.json(); if (Array.isArray(b.ids)) ids = b.ids.slice(0, 200).map(String); } catch {}
  try {
    const r = await runUpdate({ ids });
    console.log("actualizar", JSON.stringify(r));
  } catch (e) {
    console.error("actualizar error", e);
  }
};

export const config = { background: true };
