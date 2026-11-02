import { generar, componer, PROMO_MIELES50 } from "./buenosdias.mjs";
import { notify, esc } from "./telegram.mjs";

const fechaCorta = (d) => { const [y, m, dd] = d.split("-"); return `${Number(dd)}/${Number(m)}`; };

export async function enviarBuenosDias(noche, base) {
  const doc = await generar(noche);
  const t = doc.t;
  const total = t.ganados + t.perdidos + t.nulos + t.pendientes;
  if (!total) {
    await notify(`☀️ <b>Buenos días</b>\nNo hay picks registrados la noche del ${fechaCorta(noche)}, así que hoy no preparo mensaje.`);
    return doc;
  }
  const link = base ? base.replace(/\/$/, "") + "/buenos-dias.html?d=" + noche : "";
  const cab = [`☀️ <b>Buenos días listo</b> · noche del ${fechaCorta(noche)}: ${t.ganados}✅ ${t.perdidos}❌${t.nulos ? " " + t.nulos + "↩️" : ""}${t.net ? " · " + (t.net > 0 ? "+" : "") + t.net + " U" : ""}`];
  if (t.pendientes) cab.push(`⚠️ ${t.pendientes} pick(s) aún sin resultado: no salen en la lista.`);
  if (doc.sinCuota) cab.push(`✏️ ${doc.sinCuota} pick(s) llevan "(cuota: __)" (combinadas o sin cuota en el registro): ponla tú antes de publicar.`);
  cab.push("Abajo van 2 versiones para copiar: sin código y con MIELES50.");
  if (link) cab.push(`Otro código u otro paquete: <a href="${esc(link)}">abrir aquí</a>`);
  await notify(cab.join("\n"));
  await notify(esc(componer(doc.cuerpo)));
  await notify(esc(componer(doc.cuerpo, [PROMO_MIELES50])));
  return doc;
}
