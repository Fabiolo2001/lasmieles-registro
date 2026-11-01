// Cada 10 minutos mira si hace falta revisar resultados. Solo despierta la base de datos
// cuando hay picks pendientes cuyo partido ya empezó (o está a punto), o tras un cambio.
import { cronKey } from "../lib/sesion.mjs";
import { leerEstado } from "../lib/estado.mjs";

export default async (req, context) => {
  const e = await leerEstado();
  const now = Date.now();
  const stale = !e.at || now - e.at > 6 * 3600e3; // por seguridad, una revisión completa cada 6 horas
  if (!stale && (e.nextAt === null || (typeof e.nextAt === "number" && now < e.nextAt - 60e3))) {
    console.log("nada que revisar", e.nextAt ? new Date(e.nextAt).toISOString() : "sin pendientes");
    return;
  }
  const base = (context.site && context.site.url) || Netlify.env.get("URL");
  if (!base) { console.error("Sin URL del sitio"); return; }
  const r = await fetch(base.replace(/\/$/, "") + "/.netlify/functions/actualizar-bg", {
    method: "POST", headers: { "x-cron": cronKey(), "content-type": "application/json" }, body: "{}",
  });
  console.log("cron lanzado", r.status);
};

export const config = { schedule: "*/10 * * * *" };
