/* Calcula cómo va un pick simple a partir del marcador.
   Lo usan la página (en tiempo real) y el servidor (para marcar resultados).
   mkt = { t: "ml" | "spread" | "dnb" | "total" | "otro", lado: "home" | "away", linea: número, ou: "over" | "under", de: "partido" | "home" | "away" }
   g   = { homeScore, awayScore, home, away, state: "pre" | "in" | "post", completed, league } */
(function (root) {
  const num = (x) => { const n = parseFloat(String(x ?? "").replace(",", ".")); return Number.isFinite(n) ? n : null; };
  const fmt = (n) => (Math.round(n * 10) / 10).toString();
  function evalMkt(m, g) {
    if (!m || !g || m.t === "otro" || !m.t) return null;
    if (g.state === "pre") return { e: "sin empezar", n: "" };
    const h = num(g.homeScore), a = num(g.awayScore);
    if (h == null || a == null) return null;
    const fin = g.state === "post" || !!g.completed;
    if (m.t === "total") {
      const L = num(m.linea); if (L == null || (m.ou !== "over" && m.ou !== "under")) return null;
      const cur = m.de === "home" ? h : m.de === "away" ? a : h + a;
      const who = m.de === "home" ? g.home : m.de === "away" ? g.away : "Total";
      if (m.ou === "over") {
        if (cur > L) return { e: fin ? "ganado" : "ya ganado", n: `${who}: ${fmt(cur)}, over ${fmt(L)} cumplido` };
        if (fin) return { e: cur === L ? "nulo" : "perdido", n: `${who}: ${fmt(cur)}, over ${fmt(L)} no cumplido` };
        const need = Math.floor(L) + 1 - cur;
        return { e: "va perdiendo", n: `${who}: van ${fmt(cur)}, falta${need === 1 ? "" : "n"} ${fmt(need)} para el over ${fmt(L)}` };
      }
      if (cur > L) return { e: fin ? "perdido" : "ya perdido", n: `${who}: ${fmt(cur)}, se pasó del under ${fmt(L)}` };
      if (fin) return { e: cur === L ? "nulo" : "ganado", n: `${who}: ${fmt(cur)}, under ${fmt(L)} cumplido` };
      return { e: "va ganando", n: `${who}: van ${fmt(cur)}, el under ${fmt(L)} aguanta` };
    }
    if (m.t === "ml" || m.t === "spread" || m.t === "dnb") {
      if (m.lado !== "home" && m.lado !== "away") return null;
      const mine = m.lado === "home" ? h : a, other = m.lado === "home" ? a : h;
      const team = m.lado === "home" ? g.home : g.away;
      const L = m.t === "spread" ? (num(m.linea) ?? 0) : 0;
      const diff = mine + L - other;
      const sc = `${g.away} ${fmt(a)} - ${fmt(h)} ${g.home}`;
      if (fin) {
        if (diff > 0) return { e: "ganado", n: `${team} cumple (${sc})` };
        if (diff < 0) return { e: "perdido", n: `${team} no cumple (${sc})` };
        return { e: m.t === "ml" ? "perdido" : "nulo", n: m.t === "ml" ? `Empate (${sc})` : `Empate en la línea (${sc})` };
      }
      if (diff > 0) return { e: "va ganando", n: m.t === "spread" ? `${team} cubre el ${L > 0 ? "+" : ""}${fmt(L)}` : `${team} va por delante` };
      if (diff < 0) return { e: "va perdiendo", n: m.t === "spread" ? `${team} no cubre el ${L > 0 ? "+" : ""}${fmt(L)}` : `${team} va por detrás` };
      return { e: "empate", n: m.t === "ml" ? "Van empatados" : "Justo en la línea" };
    }
    return null;
  }
  /* Estado general de una combinada a partir de sus selecciones */
  function comboStatus(states) {
    if (!states.length || states.some((s) => !s)) return null;
    const e = states.map((s) => s.e);
    if (e.some((x) => x === "perdido" || x === "ya perdido")) return { e: "ya perdido", n: "Una selección ya falló" };
    if (e.every((x) => x === "ganado" || x === "ya ganado" || x === "nulo")) {
      const done = e.every((x) => x === "ganado" || x === "nulo");
      return { e: done ? (e.every((x) => x === "nulo") ? "nulo" : "ganado") : "ya ganado", n: "Todas las selecciones cumplidas" };
    }
    if (e.some((x) => x === "va perdiendo" || x === "empate")) return { e: "va perdiendo", n: "" };
    if (e.some((x) => x === "sin empezar")) return { e: "en juego", n: "Faltan partidos por empezar" };
    return { e: "va ganando", n: "" };
  }
  const api = { evalMkt, comboStatus };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LMMercado = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
