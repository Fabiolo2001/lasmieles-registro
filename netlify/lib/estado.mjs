// Estado ligero en Netlify Blobs para no despertar la base de datos sin necesidad.
//   cambio: marca de tiempo del último cambio en picks o notas (la página la consulta en vez de la base de datos)
//   nextAt: cuándo hace falta la próxima revisión de resultados (null = nada pendiente; 0 = cuanto antes)
//   at:     última revisión completa
import { getStore } from "@netlify/blobs";
const st = () => getStore({ name: "estado", consistency: "strong" });
export async function leerEstado() {
  try { return (await st().get("estado", { type: "json" })) || {}; } catch { return {}; }
}
export async function guardarEstado(cambios) {
  try { const e = await leerEstado(); await st().setJSON("estado", { ...e, ...cambios }); } catch (e) { console.warn("estado", e.message); }
}
