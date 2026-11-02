// Cada día a las 10:00 de España (4:00 de Miami) te manda por Telegram el borrador del buenos días.
// Corre a las 8:00 y 9:00 UTC y solo actúa cuando en Madrid son las 10 (sirve en horario de verano e invierno).
import { madridParts, miamiDate } from "../lib/buenosdias.mjs";
import { enviarBuenosDias } from "../lib/buenosdias-envio.mjs";
import { getStore } from "@netlify/blobs";

export default async (req, context) => {
  const { hour, date } = madridParts();
  if (hour !== 10) { console.log("no son las 10 en Madrid", hour); return; }
  const st = getStore({ name: "estado", consistency: "strong" });
  const ult = await st.get("bd-ultimo", { type: "json" }).catch(() => null);
  if (ult && ult.madrid === date) { console.log("ya enviado hoy"); return; }
  const noche = miamiDate(Date.now() - 12 * 3600e3); // a las 4–5am de Miami, la noche anterior
  const base = (context.site && context.site.url) || Netlify.env.get("URL") || "";
  await enviarBuenosDias(noche, base);
  await st.setJSON("bd-ultimo", { madrid: date, noche, at: Date.now() });
};

export const config = { schedule: "0 8,9 * * *" };
