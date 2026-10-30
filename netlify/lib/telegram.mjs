// Avisos por Telegram cuando el registro marca un resultado.
// Variables en Netlify: TELEGRAM_BOT_TOKEN (de @BotFather) y TELEGRAM_CHAT_ID (tu id de usuario, de @userinfobot).
// Solo envía a ese chat: nunca lee los mensajes del bot ni escribe en el canal.
const token = () => Netlify.env.get("TELEGRAM_BOT_TOKEN") || "";
const chat = () => Netlify.env.get("TELEGRAM_CHAT_ID") || "";

export async function notify(text) {
  if (!token() || !chat()) return false;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token()}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chat(), text, parse_mode: "HTML", disable_web_page_preview: true }),
    });
    const j = await r.json().catch(() => null);
    if (!j || !j.ok) console.warn("telegram", r.status, j && j.description);
    return !!(j && j.ok);
  } catch (e) { console.warn("telegram", e.message); return false; }
}
export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
