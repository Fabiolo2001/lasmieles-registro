// Avisos por Telegram cuando el registro marca un resultado.
// Variables: TELEGRAM_BOT_TOKEN (de @BotFather). El chat de destino se guarda solo en la tabla ajustes
// la primera vez que alguien le escribe al bot (o lo añade a un grupo); también se puede fijar con TELEGRAM_CHAT_ID.
import { getDatabase } from "@netlify/database";

const token = () => Netlify.env.get("TELEGRAM_BOT_TOKEN") || "";
const api = (method, body) => fetch(`https://api.telegram.org/bot${token()}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()).catch(() => null);

async function setting(sql, key, value) {
  if (value === undefined) { const r = await sql`SELECT value FROM ajustes WHERE key = ${key}`; return r[0] ? r[0].value : null; }
  await sql`INSERT INTO ajustes (key, value) VALUES (${key}, ${value}) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`;
}

/* Busca el chat de destino: variable de entorno o el último chat que escribió al bot */
export async function chatId(sql) {
  const fixed = Netlify.env.get("TELEGRAM_CHAT_ID");
  if (fixed) return fixed;
  if (!token()) return null;
  let id = await setting(sql, "telegram_chat");
  const last = Number(await setting(sql, "telegram_update")) || 0;
  const j = await api("getUpdates", { offset: last + 1, limit: 50, allowed_updates: ["message", "channel_post"] });
  if (j && j.ok) {
    for (const u of j.result || []) {
      const msg = u.message || u.channel_post;
      if (msg && msg.chat) { id = String(msg.chat.id); await setting(sql, "telegram_chat", id); }
      await setting(sql, "telegram_update", String(u.update_id));
      if (msg && msg.chat && /^\/?(start|hola)/i.test(msg.text || "")) await api("sendMessage", { chat_id: msg.chat.id, text: "Listo. Aquí te avisaré cada vez que un pick se marque como ganado, perdido o nulo." });
    }
  }
  return id;
}

export async function notify(text) {
  if (!token()) return false;
  const sql = getDatabase().sql;
  const id = await chatId(sql);
  if (!id) return false;
  const r = await api("sendMessage", { chat_id: id, text, parse_mode: "HTML", disable_web_page_preview: true });
  return !!(r && r.ok);
}
export const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
