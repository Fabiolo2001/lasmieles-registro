// Marcadores (ESPN), vinculación de picks con su partido y calificación automática.
import { getDatabase } from "@netlify/database";
import Anthropic from "@anthropic-ai/sdk";
import "../../public/mercado.js";
const { evalMkt, comboStatus } = globalThis.LMMercado;

/* ---------- Ligas ---------- */
export const LEAGUES = {
  mlb: "baseball/mlb", nhl: "hockey/nhl", nba: "basketball/nba", nfl: "football/nfl",
  ncaaf: "football/college-football", ncaab: "basketball/mens-college-basketball", ufc: "mma/ufc",
};
const SOCCER = ["eng.1", "esp.1", "ita.1", "ger.1", "fra.1", "uefa.champions", "uefa.europa", "uefa.europa.conf",
  "usa.1", "mex.1", "por.1", "ned.1", "bel.1", "tur.1", "sau.1", "arg.1", "bra.1", "col.1",
  "conmebol.libertadores", "conmebol.sudamericana", "eng.2", "esp.2", "ita.2", "ger.2", "eng.fa", "eng.league_cup",
  "esp.copa_del_rey", "ita.coppa_italia", "ger.dfb_pokal", "fra.coupe_de_france", "concacaf.champions", "fifa.friendly", "fifa.world"];
for (const s of SOCCER) LEAGUES[s] = "soccer/" + s;
export const SPORT_LEAGUES = {
  MLB: ["mlb"], NHL: ["nhl"], NBA: ["nba"], NFL: ["nfl"], NCAAF: ["ncaaf"], NCAAB: ["ncaab"], UFC: ["ufc"], SOCCER: SOCCER,
};
const EXTRA = { ncaaf: "&groups=80", ncaab: "&groups=50" };

/* ---------- ESPN ---------- */
const cache = new Map();
async function getJSON(url, ttl = 30000) {
  const c = cache.get(url);
  if (c && Date.now() - c.t < ttl) return c.v;
  const r = await fetch(url, { headers: { "user-agent": "Mozilla/5.0 LasMielesRegistro" } });
  if (!r.ok) throw new Error("ESPN " + r.status + " " + url);
  const v = await r.json();
  cache.set(url, { t: Date.now(), v });
  return v;
}
const ymdc = (d) => d.replace(/-/g, "");
export function shiftDay(ymd, n) {
  const d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function simplify(ev, league) {
  const st = (ev.status && ev.status.type) || {};
  const comps = ev.competitions || [];
  const out = [];
  const one = (c, idSuffix, nameOverride) => {
    const cs = c.competitors || [];
    const side = (h) => cs.find((x) => x.homeAway === h) || cs[h === "home" ? 0 : 1] || {};
    const nm = (x) => (x.team && (x.team.displayName || x.team.shortDisplayName)) || (x.athlete && x.athlete.displayName) || "";
    const ab = (x) => (x.team && (x.team.abbreviation || x.team.shortDisplayName)) || (x.athlete && (x.athlete.shortName || x.athlete.displayName)) || "";
    const home = side("home"), away = side("away");
    const cst = (c.status && c.status.type) || st;
    out.push({
      id: String(ev.id) + (idSuffix || ""), league, start: c.date || ev.date,
      name: nameOverride || ev.name || (nm(away) + " at " + nm(home)),
      home: nm(home), away: nm(away), homeAbbr: ab(home), awayAbbr: ab(away),
      homeScore: home.score != null ? String(home.score.displayValue || home.score) : "",
      awayScore: away.score != null ? String(away.score.displayValue || away.score) : "",
      winner: home.winner ? "home" : away.winner ? "away" : null,
      state: cst.state || "pre", completed: !!cst.completed,
      detail: cst.shortDetail || cst.detail || "",
    });
  };
  if (league === "ufc") {
    comps.forEach((c, i) => {
      const cs = c.competitors || [];
      const n = cs.map((x) => (x.athlete && x.athlete.displayName) || "").join(" vs ");
      one(c, ":" + (c.id || i), n);
    });
  } else if (comps[0]) one(comps[0]);
  return out;
}

export async function scoreboard(league, ymd) {
  const path = LEAGUES[league];
  if (!path) return [];
  const url = `https://site.api.espn.com/apis/site/v2/sports/${path}/scoreboard?dates=${ymdc(ymd)}&limit=300${EXTRA[league] || ""}`;
  try {
    const j = await getJSON(url);
    return (j.events || []).flatMap((ev) => simplify(ev, league));
  } catch (e) { console.warn(String(e)); return []; }
}

/* Datos detallados del partido para calificar (marcador por periodos, estadísticas, jugadores) */
// ¿El pick es de un periodo concreto (cuarto, periodo, mitad, entradas)?
export const isPeriodPick = (t) => /(1st|2nd|3rd|4th|first|second|third|fourth)\s*(quarter|period|half|inning|q\b)|\b[1-4]q\b|\b1h\b|\b2h\b|\bf5\b|first\s*5|cuarto|periodo|mitad|primera parte|segunda parte|entrada/i.test(String(t || ""));
export async function gameDetail(league, gameId, { plays = false } = {}) {
  const path = LEAGUES[league];
  const evId = String(gameId).split(":")[0];
  try {
    const j = await getJSON(`https://site.api.espn.com/apis/site/v2/sports/${path}/summary?event=${evId}`, 60000);
    const L = [];
    const comp = j.header && j.header.competitions && j.header.competitions[0];
    if (comp) {
      for (const c of comp.competitors || []) {
        const nm = (c.team && c.team.displayName) || (c.athlete && c.athlete.displayName) || "";
        const ls = (c.linescores || []).map((x) => x.displayValue ?? x.value).join(",");
        L.push(`${c.homeAway || ""} ${nm}: ${c.score ?? ""}${ls ? " (por periodo: " + ls + ")" : ""}${c.winner ? " GANADOR" : ""}`);
      }
      const t = comp.status && comp.status.type;
      if (t) L.push("Estado: " + (t.detail || t.shortDetail || t.state));
    }
    for (const t of (j.boxscore && j.boxscore.teams) || []) {
      const s = (t.statistics || []).map((x) => `${x.label || x.name}=${x.displayValue}`).join("; ");
      if (s) L.push(`Equipo ${(t.team && t.team.displayName) || ""}: ${s}`);
    }
    for (const t of (j.boxscore && j.boxscore.players) || []) {
      const team = (t.team && t.team.displayName) || "";
      for (const g of t.statistics || []) {
        const labels = g.labels || g.names || [];
        for (const a of g.athletes || []) {
          if (!a.stats || !a.stats.length) continue;
          L.push(`${team} | ${(a.athlete && a.athlete.displayName) || ""}${g.name ? " [" + g.name + "]" : ""}: ` + labels.map((lb, i) => `${lb}=${a.stats[i]}`).join(", "));
        }
      }
    }
    const evs = j.keyEvents || j.scoringPlays || [];
    for (const e of evs.slice(0, 80)) {
      const txt = e.text || (e.type && e.type.text) || "";
      if (txt) L.push("Evento: " + (e.clock && e.clock.displayValue ? e.clock.displayValue + " " : "") + txt);
    }
    // Jugada a jugada (para props de un cuarto, periodo, mitad o entradas)
    if (plays && Array.isArray(j.plays)) {
      const pl = j.plays.filter((x) => x.scoringPlay || x.scoreValue || /makes|scores|goal|home run|singles|doubles|triples|walks|strikes out/i.test(x.text || ""));
      L.push("JUGADA A JUGADA (anotaciones y acciones relevantes, con periodo):");
      for (const x of pl.slice(0, 450)) L.push(`P${(x.period && (x.period.number || x.period.displayValue)) || "?"} ${(x.clock && x.clock.displayValue) || ""} ${x.text || ""} [${x.awayScore ?? ""}-${x.homeScore ?? ""}]`);
    }
    if (league === "ufc" && j.competitions) L.push(JSON.stringify(j.competitions).slice(0, 4000));
    return L.join("\n").slice(0, plays ? 40000 : 14000);
  } catch (e) { console.warn(String(e)); return ""; }
}

/* Equipo actual de un jugador según ESPN (para player props) */
export function playerName(text) {
  const t = String(text || "").replace(/^[^:]*:\s*/, "");
  const m = t.match(/^(.+?)\s+(over|under|o\s?\d|u\s?\d|[+-]\d|more|less|anytime|to score|ml\b|\d)/i);
  const n = (m ? m[1] : t.split(/\s+/).slice(0, 2).join(" ")).trim();
  return n.split(/\s+/).length >= 2 && n.length <= 40 ? n : null;
}
export async function playerTeams(name) {
  if (!name) return [];
  try {
    const j = await getJSON("https://site.web.api.espn.com/apis/common/v3/search?query=" + encodeURIComponent(name) + "&limit=5&type=player", 6 * 3600e3);
    const out = [];
    for (const it of j.items || []) {
      if (it.type && it.type !== "player") continue;
      const team = (it.teamRelationships || []).map((t) => t.displayName || (t.core && t.core.displayName)).filter(Boolean).join(", ");
      out.push({ jugador: it.displayName, equipo: team || "desconocido", liga: it.league || "" });
      if (out.length >= 4) break;
    }
    return out;
  } catch (e) { return []; }
}

/* ---------- Claude ---------- */
const MODELS_QUICK = () => [Netlify.env.get("ANTHROPIC_MODEL_QUICK"), "claude-haiku-5-5", "claude-haiku-4-5", "claude-sonnet-4-5"].filter(Boolean);
const MODELS_MAIN = () => [Netlify.env.get("ANTHROPIC_MODEL"), "claude-sonnet-5-5", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929"].filter(Boolean);
export async function askClaude(prompt, { quick = false, maxTokens = 4000 } = {}) {
  const anthropic = new Anthropic();
  let lastErr;
  for (const model of quick ? MODELS_QUICK() : MODELS_MAIN()) {
    try {
      const m = await anthropic.messages.create({ model, max_tokens: maxTokens, messages: [{ role: "user", content: prompt + "\n\nResponde solo con el JSON pedido." }] });
      return (m.content || []).filter((c) => c.type === "text").map((c) => c.text).join("");
    } catch (e) {
      lastErr = e;
      if (e && (e.status === 404 || (e.status === 400 && /model/i.test(String(e.message))))) continue;
      throw e;
    }
  }
  throw lastErr;
}
export function parseJSON(t) {
  const tries = [t];
  const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) tries.push(f[1]);
  const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf("]"), t.lastIndexOf("}"));
  if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
  for (const s of tries) { try { return JSON.parse(s); } catch {} }
  return null;
}

/* ---------- Proceso de actualización ---------- */
const nowIso = () => new Date().toISOString();
// Las fechas de los picks y de ESPN van en hora de Miami (Este de EE. UU.)
const todayYmd = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

const isCombo = (p) => p.betType === "Combinada";
const gameRef = (g) => ({ league: g.league, id: g.id, ymd: g.ymd, name: g.away + " vs " + g.home, start: g.start });
const isMatched = (p) => isCombo(p) ? Array.isArray(p.legs) && p.legs.length > 1 && p.legs.every((l) => l.game) : !!p.game;
const scoreTxt = (g) => `${g.away} ${g.awayScore} - ${g.homeScore} ${g.home}`;
const num = (x) => { const n = parseFloat(String(x).replace(",", ".")); return Number.isFinite(n) ? n : null; };
const tally = (g) => {
  const a = num(g.awayScore), h = num(g.homeScore);
  return { visitante: { equipo: g.away, marcador: a }, local: { equipo: g.home, marcador: h }, totalPartido: a != null && h != null ? a + h : null };
};
const RES = ["ganado", "perdido", "nulo"];

export async function runUpdate({ ids = null, days = 7, log = console.log } = {}) {
  const sql = getDatabase().sql;
  const from = shiftDay(todayYmd(), -days);
  const rows = ids && ids.length
    ? await sql`SELECT id, data FROM picks WHERE id = ANY(${ids})`
    : await sql`SELECT id, data FROM picks WHERE date >= ${from} AND COALESCE(data->>'result','pendiente') = 'pendiente'`;
  const picks = rows.map((r) => ({ id: r.id, ...r.data })).filter((p) => (p.result || "pendiente") === "pendiente" && SPORT_LEAGUES[p.sport]);
  if (!picks.length) return { picks: 0 };
  const patches = new Map();
  const patch = (id, obj) => patches.set(id, { ...(patches.get(id) || {}), ...obj });

  /* 0) Deshacer vinculaciones con partidos de otro día (versión anterior) */
  for (const p of picks) {
    const bad = (p.game && p.game.ymd && p.game.ymd !== p.date) ||
      (Array.isArray(p.legs) && p.legs.some((l) => l.game && l.game.ymd !== p.date)) ||
      (isCombo(p) && p.game && !p.legs);
    if (bad) {
      p.game = null; p.legs = null; p.matchTries = 0;
      const ev = p.eventAuto ? "" : p.event;
      if (p.eventAuto) p.event = "";
      patch(p.id, { game: null, legs: null, matchTries: 0, final: null, live: null, resultNote: null, gradeTries: 0, event: ev, eventAuto: false });
    }
  }

  /* 1) Vincular picks (y cada selección de las combinadas) con su partido */
  // Reintenta hasta 6 veces seguidas; después, cada 15 minutos si el pick es de hoy o de ayer
  const recent = shiftDay(todayYmd(), -1);
  const unmatched = picks.filter((p) => !isMatched(p) && ((p.matchTries || 0) < 6 ||
    (p.date >= recent && Date.now() - (p.matchAt ? Date.parse(p.matchAt) : 0) > 15 * 60e3)));
  const groups = {};
  for (const p of unmatched) (groups[p.sport + "|" + p.date] ||= []).push(p);
  for (const key of Object.keys(groups)) {
    const [sport, date] = key.split("|");
    const list = groups[key];
    const games = [];
    for (const lg of SPORT_LEAGUES[sport]) {
      for (const g of await scoreboard(lg, date)) if (!games.find((x) => x.id === g.id && x.league === g.league)) games.push({ ...g, ymd: date });
    }
    if (!games.length) { list.forEach((p) => patch(p.id, { matchTries: (p.matchTries || 0) + 1, matchAt: nowIso() })); continue; }
    const perLeague = {};
    games.forEach((g) => { perLeague[g.league] = (perLeague[g.league] || 0) + 1; });
    const gl = games.map((g, i) => ({ i, partido: g.away + " vs " + g.home, liga: g.league, inicio: g.start, partidosDeEsaLigaHoy: perLeague[g.league] })).slice(0, 400);
    const prompt = `Tengo picks de apuestas deportivas (${sport}) del ${date} (hora de Miami) y la lista de partidos de ese mismo día. Para cada pick, indica qué partido es usando el número "i" de la lista.
Reglas:
- Si el pick trae "partido" y ese partido está en la lista, úsalo: manda sobre todo lo demás. Si el "partido" del pick no está en la lista de hoy, ignóralo (puede estar mal) y busca por el jugador o el equipo.
- "plantillaESPN" dice en qué equipo juega ahora el jugador según ESPN: es la fuente más fiable, por encima de lo que recuerdes.
- El pick puede nombrar solo un equipo o un jugador. Los jugadores cambian de equipo con frecuencia: no te fíes solo de lo que recuerdas; el jugador tiene que jugar en uno de los dos equipos del partido elegido según la plantilla actual. Si dudas entre varios partidos, pon null.
- Si en la lista solo hay un partido de esa liga ese día ("partidosDeEsaLigaHoy": 1, por ejemplo un partido de la Serie Mundial o de playoffs) y nada lo contradice, elige ese partido aunque no reconozcas al jugador.
- Si el pick es una combinada (parlay; "tipo": "Combinada"), sepárala en sus selecciones y da el partido de cada una en "piernas". Varias selecciones pueden ser del mismo partido.
Responde un array JSON: [{"id":"<id del pick>","i":<número o null>,"piernas":[{"texto":"selección","i":<número o null>}]}] ("piernas" solo en combinadas).
PICKS: ${JSON.stringify(await Promise.all(list.map(async (p) => ({ id: p.id, pick: p.pick, tipo: p.betType, partido: p.event || "",
      plantillaESPN: p.betType === "Player prop" || /props/.test(p.package || "") ? await playerTeams(playerName(p.pick)) : undefined }))))}
PARTIDOS: ${JSON.stringify(gl)}`;
    let res = null;
    try { res = parseJSON(await askClaude(prompt, { quick: true, maxTokens: 3000 })); } catch (e) { log("match error " + e.message); }
    for (const p of list) {
      const m = Array.isArray(res) && res.find((x) => x && x.id === p.id);
      if (isCombo(p)) {
        const legs = m && Array.isArray(m.piernas) ? m.piernas.filter((x) => x && x.texto).slice(0, 12).map((x) => {
          const g = Number.isInteger(x.i) ? games[x.i] : null;
          return { text: String(x.texto).slice(0, 160), game: g ? gameRef(g) : null };
        }) : [];
        if (legs.length > 1) {
          p.legs = legs;
          const names = [...new Set(legs.filter((l) => l.game).map((l) => l.game.name))];
          patch(p.id, { legs, game: null, matchTries: legs.every((l) => l.game) ? 0 : (p.matchTries || 0) + 1 });
        } else patch(p.id, { matchTries: (p.matchTries || 0) + 1, matchAt: nowIso() });
      } else {
        const g = m && Number.isInteger(m.i) ? games[m.i] : null;
        if (g) { p.game = gameRef(g); patch(p.id, { game: p.game }); }
        else patch(p.id, { matchTries: (p.matchTries || 0) + 1, matchAt: nowIso() });
      }
    }
  }

  /* 1b) Clasificar el mercado de cada pick o selección (para calcular en directo sin Claude) */
  const toClassify = [];
  for (const p of picks) {
    if (!isMatched(p)) continue;
    if (isCombo(p)) p.legs.forEach((l, j) => { if (l.mkt == null) toClassify.push({ p, j, texto: l.text, game: l.game }); });
    else if (p.mkt == null) toClassify.push({ p, j: -1, texto: p.pick, game: p.game });
  }
  for (let k = 0; k < toClassify.length; k += 25) {
    const chunk = toClassify.slice(k, k + 25);
    const items = chunk.map((c, i) => {
      const [vis, loc] = String(c.game.name || "").split(" vs ");
      return { k: i, deporte: c.p.sport, seleccion: c.texto, local: loc || "", visitante: vis || "" };
    });
    const prompt = `Clasifica cada selección de apuesta deportiva para poder calcularla con el marcador.
Campos: "t": "ml" (ganador del partido / moneyline), "spread" (hándicap o spread con línea), "dnb" (empate no apuesta / Winner push if tied), "total" (over/under de goles, puntos o carreras del partido completo o de un equipo), "otro" (player props, córners, tarjetas, un periodo o mitad concreta como 1st Quarter, 1ª parte o F5, resultado exacto, BTTS y cualquier otra cosa).
"lado": "home" (local) o "away" (visitante) para ml, spread y dnb, según el equipo del pick. "linea": número (en spread con su signo, p. ej. -4.5; en total la línea, p. ej. 2.5). "ou": "over" o "under" en totales. "de": "partido" si el total es de los dos equipos (también cuando el pick nombra a los dos equipos), "home" o "away" si es el total de un solo equipo.
Responde un array JSON: [{"k":0,"t":"...","lado":null,"linea":null,"ou":null,"de":null}]
SELECCIONES: ${JSON.stringify(items)}`;
    let res = null;
    try { res = parseJSON(await askClaude(prompt, { quick: true, maxTokens: 2500 })); } catch (e) { log("mkt error " + e.message); }
    if (!Array.isArray(res)) continue;
    chunk.forEach((c, i) => {
      const r = res.find((x) => x && x.k === i);
      if (!r) return;
      const mkt = { t: ["ml", "spread", "dnb", "total"].includes(r.t) ? r.t : "otro", lado: r.lado === "home" || r.lado === "away" ? r.lado : null,
        linea: typeof r.linea === "number" ? r.linea : null, ou: r.ou === "over" || r.ou === "under" ? r.ou : null, de: ["partido", "home", "away"].includes(r.de) ? r.de : "partido" };
      if (c.j >= 0) { c.p.legs[c.j] = { ...c.p.legs[c.j], mkt }; patch(c.p.id, { legs: c.p.legs }); }
      else { c.p.mkt = mkt; patch(c.p.id, { mkt }); }
    });
  }

  /* 2) Estado de los partidos de cada pick */
  const finished = [], live = [];
  const getGame = async (ref) => ref ? (await scoreboard(ref.league, ref.ymd)).find((x) => x.id === ref.id) || null : null;
  for (const p of picks) {
    if (!isMatched(p)) continue;
    const refs = isCombo(p) ? p.legs.map((l) => l.game) : [p.game];
    const gs = [];
    for (const r of refs) gs.push(await getGame(r));
    if (gs.some((g) => !g)) continue;
    const done = gs.map((g) => g.state === "post" || g.completed);
    const anyLive = gs.some((g) => g.state === "in");
    // Cálculo directo con el marcador cuando el mercado es simple
    const calc = isCombo(p) ? comboStatus(p.legs.map((l, j) => l.result ? { e: l.result } : evalMkt(l.mkt, gs[j]))) : evalMkt(p.mkt, gs[0]);
    if (calc && calc.e !== "sin empezar") {
      const legs = isCombo(p) ? p.legs.map((l, j) => { const r = evalMkt(l.mkt, gs[j]); const fin = gs[j].state === "post" || gs[j].completed;
        return { ...l, estado: r ? r.e : l.estado || null, result: l.result || (fin && r && RES.includes(r.e) ? r.e : null), final: fin ? { score: scoreTxt(gs[j]), detail: gs[j].detail } : l.final || null }; }) : null;
      const obj = { live: { estado: calc.e, nota: calc.n || "" }, liveAt: nowIso(), calc: true };
      if (legs) obj.legs = legs;
      if (!isCombo(p) && done[0]) obj.final = { state: "post", score: scoreTxt(gs[0]), detail: gs[0].detail };
      const res = RES.includes(calc.e) ? calc.e : calc.e === "ya ganado" ? "ganado" : calc.e === "ya perdido" ? "perdido" : null;
      if (res) Object.assign(obj, { result: res, autoResult: true, gradedAt: nowIso(), live: null,
        resultNote: (calc.n || (res === "ganado" ? "Cumplido" : res === "perdido" ? "No cumplido" : "Nulo")) + (done.every(Boolean) ? "" : " (marcado antes del final)") });
      patch(p.id, obj);
      continue;
    }
    if (done.every(Boolean)) finished.push({ p, gs });
    else if (anyLive || done.some(Boolean)) {
      const last = p.liveAt ? Date.parse(p.liveAt) : 0;
      if (Date.now() - last > 8 * 60e3) live.push({ p, gs });
    }
  }

  const describe = async (p, gs, maxDet) => {
    if (!isCombo(p)) {
      const g = gs[0];
      return { id: p.id, pick: p.pick, tipo: p.betType, partido: g.away + " vs " + g.home, marcador: `${scoreTxt(g)} (${g.detail})`, cuentas: tally(g), datos: (await gameDetail(g.league, g.id, { plays: isPeriodPick(p.pick) })).slice(0, isPeriodPick(p.pick) ? maxDet * 3 : maxDet) };
    }
    const det = {};
    const piernas = [];
    for (let k = 0; k < p.legs.length; k++) {
      const g = gs[k];
      const per = isPeriodPick(p.legs[k].text);
      det[g.id + (per ? ":p" : "")] ||= (await gameDetail(g.league, g.id, { plays: per })).slice(0, per ? maxDet * 2 : Math.floor(maxDet / 2));
      piernas.push({ texto: p.legs[k].text, partido: g.away + " vs " + g.home, marcador: `${scoreTxt(g)} (${g.detail})`, cuentas: tally(g), estadoPartido: g.state, datos: det[g.id + (per ? ":p" : "")] });
    }
    return { id: p.id, pick: p.pick, tipo: "Combinada", piernas };
  };

  /* 3) Calificar los terminados */
  for (let k = 0; k < finished.length; k += 8) {
    const chunk = finished.slice(k, k + 8);
    const items = [];
    for (const { p, gs } of chunk) items.push(await describe(p, gs, 9000));
    const prompt = `Eres el corrector de un registro de apuestas deportivas. Para cada pick, con los datos finales, decide si fue "ganado", "perdido" o "nulo" (push / devolución: empate exacto en la línea, jugador que no participa, Winner push if tied con empate). Las líneas pueden venir con coma decimal (221,5 = 221.5). En player props usa las estadísticas del jugador.
Cómo leer las líneas: un "Over/Under" sin equipo concreto (o con los dos equipos del partido en el pick, p. ej. "Como vs Torino Over 2.5") es sobre el TOTAL del partido, la suma de los dos equipos: usa "cuentas.totalPartido". Ejemplo: 1-1 son 2 goles en total; para un Over 2.5 falta 1 gol. Solo si el pick nombra un único equipo (p. ej. "Torino Over 1.5 goles") es el total de ese equipo. Haz las cuentas con los números de "cuentas", no de memoria.
En las combinadas califica cada selección en "piernas" y luego la combinada: "perdido" si alguna selección se perdió; "ganado" si todas se ganaron (las nulas no cuentan); "nulo" si todas fueron nulas.
"nulo" es SOLO para una devolución real (empate exacto en la línea, jugador que no jugó, partido suspendido, Winner push if tied con empate). Si te faltan datos para decidir (por ejemplo, no ves las estadísticas de ese cuarto o periodo), NO pongas "nulo": pon null.
En los picks de un cuarto, periodo, mitad o entradas concretas, usa la "JUGADA A JUGADA" de los datos y cuenta solo lo que pasó en ese periodo (P1 = primer cuarto/periodo/entrada). Por ejemplo, para "X over 1.5 Total Points 1st Quarter" suma los puntos de X en las jugadas P1.
Si los datos no bastan para saberlo con seguridad, pon null.
Responde un array JSON: [{"id":"...","resultado":"ganado|perdido|nulo|null","nota":"explicación corta en español con el dato clave","piernas":[{"texto":"...","resultado":"ganado|perdido|nulo|null"}]}] ("piernas" solo en combinadas, en el mismo orden).
PICKS: ${JSON.stringify(items)}`;
    let res = null;
    try { res = parseJSON(await askClaude(prompt, { maxTokens: 4000 })); } catch (e) { log("grade error " + e.message); }
    for (const { p, gs } of chunk) {
      const m = Array.isArray(res) && res.find((x) => x && x.id === p.id);
      const fin = isCombo(p) ? null : { state: "post", score: scoreTxt(gs[0]), detail: gs[0].detail };
      const extra = {};
      if (isCombo(p)) {
        extra.legs = p.legs.map((l, j) => {
          const r = m && Array.isArray(m.piernas) && m.piernas[j] ? m.piernas[j].resultado : null;
          return { ...l, final: { score: scoreTxt(gs[j]), detail: gs[j].detail }, result: RES.includes(r) ? r : null, estado: null };
        });
      } else extra.final = fin;
      if (m && RES.includes(m.resultado)) {
        patch(p.id, { ...extra, result: m.resultado, autoResult: true, resultNote: String(m.nota || "").slice(0, 300), gradedAt: nowIso(), live: null });
      } else {
        patch(p.id, { ...extra, resultNote: m && m.nota ? "Sin calificar: " + String(m.nota).slice(0, 250) : "Sin datos suficientes para calificar", gradeTries: (p.gradeTries || 0) + 1 });
      }
    }
  }

  /* 4) Seguimiento en vivo */
  if (live.length) {
    const sel = live.slice(0, 12);
    const items = [];
    for (const { p, gs } of sel) items.push(await describe(p, gs, 6000));
    const prompt = `Apuestas con partidos en curso. Para cada pick, según el marcador y los datos actuales, di cómo va: "va ganando", "va perdiendo", "ya ganado" (ya no puede fallar pase lo que pase, p. ej. un over ya superado), "ya perdido" (ya no puede cumplirse de ninguna forma) o "en juego" (no se puede saber aún). Añade una nota muy corta con las cuentas correctas.
Cómo leer las líneas: un "Over/Under" sin equipo concreto (o con los dos equipos del partido en el pick, p. ej. "Como vs Torino Over 2.5") es sobre el TOTAL del partido, la suma de los dos equipos: usa "cuentas.totalPartido". Ejemplo: 1-1 son 2 goles en total; para un Over 2.5 falta 1 gol. Solo si el pick nombra un único equipo (p. ej. "Torino Over 1.5 goles") es el total de ese equipo. Haz las cuentas con los números de "cuentas", no de memoria.
En las combinadas da también el estado de cada selección en "piernas" (si su partido ya terminó, "ganado", "perdido" o "nulo"; si no ha empezado, "sin empezar"), y el estado general: si una selección ya se perdió, la combinada está "ya perdido"; la combinada solo está "ya ganado" si todas sus selecciones ya están ganadas o nulas. Usa "ya ganado" y "ya perdido" solo cuando sea completamente seguro, porque el pick se marcará con ese resultado.
Responde un array JSON: [{"id":"...","estado":"...","nota":"...","piernas":[{"texto":"...","estado":"..."}]}]
PICKS: ${JSON.stringify(items)}`;
    let res = null;
    try { res = parseJSON(await askClaude(prompt, { maxTokens: 3000 })); } catch (e) { log("live error " + e.message); }
    for (const { p, gs } of sel) {
      const m = Array.isArray(res) && res.find((x) => x && x.id === p.id);
      if (!m) continue;
      const obj = { live: { estado: String(m.estado || "").slice(0, 30), nota: String(m.nota || "").slice(0, 160) }, liveAt: nowIso() };
      if (isCombo(p)) obj.legs = p.legs.map((l, j) => ({ ...l, estado: m.piernas && m.piernas[j] ? String(m.piernas[j].estado || "").slice(0, 30) : l.estado || null,
        final: gs[j].state === "post" ? { score: scoreTxt(gs[j]), detail: gs[j].detail } : l.final || null }));
      // Si ya no puede cambiar, se marca el resultado sin esperar al final del partido
      const est = obj.live.estado.toLowerCase();
      const early = est === "ya ganado" ? "ganado" : est === "ya perdido" ? "perdido" : null;
      if (early) Object.assign(obj, { result: early, autoResult: true, gradedAt: nowIso(),
        resultNote: (obj.live.nota || (early === "ganado" ? "Ya cumplido" : "Ya no puede cumplirse")) + " (marcado antes del final)" });
      patch(p.id, obj);
    }
  }

  /* 5) Guardar */
  for (const [id, obj] of patches) {
    const j = JSON.stringify(obj);
    await sql`UPDATE picks SET data = data || ${j}::jsonb, updated_at = now() WHERE id = ${id} AND COALESCE(data->>'result','pendiente') = 'pendiente'`;
  }
  return { picks: picks.length, matched: unmatched.length, finished: finished.length, live: live.length, updated: patches.size };
}
