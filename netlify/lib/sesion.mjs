import crypto from "node:crypto";

export const COOKIE = "lm_sesion";
const b64u = (s) => Buffer.from(s).toString("base64url");
function secret() {
  const s = Netlify.env.get("SESSION_SECRET");
  if (!s || s.length < 16) throw new Error("Falta SESSION_SECRET");
  return s;
}
export function sign(payload) {
  const body = b64u(JSON.stringify(payload));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return body + "." + mac;
}
export function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
export function sameText(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}
/* Clave interna para que la tarea programada lance la actualización */
export function cronKey() {
  return crypto.createHmac("sha256", secret()).update("cron-actualizar").digest("hex");
}
