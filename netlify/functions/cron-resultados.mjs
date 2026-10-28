// Cada 10 minutos lanza la actualización de marcadores y resultados.
import { cronKey } from "../lib/sesion.mjs";

export default async (req, context) => {
  const base = (context.site && context.site.url) || Netlify.env.get("URL");
  if (!base) { console.error("Sin URL del sitio"); return; }
  const r = await fetch(base.replace(/\/$/, "") + "/.netlify/functions/actualizar-bg", {
    method: "POST", headers: { "x-cron": cronKey(), "content-type": "application/json" }, body: "{}",
  });
  console.log("cron lanzado", r.status);
};

export const config = { schedule: "*/10 * * * *" };
