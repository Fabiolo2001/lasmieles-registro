// Cuotas automáticas con The Odds API (casa Hard Rock; si no la tiene, otra casa de EE. UU. de referencia).
// Variable en Netlify: ODDS_API_KEY. Plan gratis = 500 créditos/mes: una consulta por liga con solo los
// mercados que hacen falta, guardada 2 horas, y nunca se gasta si quedan menos de 25 créditos.
// Solo moneyline, spread y total del partido. Props, combinadas y mercados raros: a mano.
import { getStore } from "@netlify/blobs";

const BOOKS = ["hardrockbet", "draftkings", "fanduel", "betmgm"]; // hasta 10 casas cuentan como 1 región
const BOOK_NAME = { hardrockbet: "Hard Rock", draftkings: "DraftKings", fanduel: "FanDuel", betmgm: "BetMGM" };
const KEYS = {
  mlb: "baseball_mlb", nhl: "icehockey_nhl", nba: "basketball_nba", nfl: "americanfootball_nfl",
  ncaaf: "americanfootball_ncaaf", ncaab: "basketball_ncaab", ufc: "mma_mixed_martial_arts",
  "eng.1": "soccer_epl", "esp.1": "soccer_spain_la_liga", "ita.1": "soccer_italy_serie_a", "ger.1": "soccer_germany_bundesliga",
  "fra.1": "soccer_france_ligue_one", "uefa.champions": "soccer_uefa_champs_league", "uefa.europa": "soccer_uefa_europa_league",
  "uefa.europa.conf": "soccer_uefa_europa_conference_league", "usa.1": "soccer_usa_mls", "mex.1": "soccer_mexico_ligamx",
  "por.1": "soccer_portugal_primeira_liga", "ned.1": "soccer_netherlands_eredivisie", "bel.1": "soccer_belgium_first_div",
  "tur.1": "soccer_turkey_super_league", "arg.1": "soccer_argentina_primera_division", "bra.1": "soccer_brazil_campeonato",
  "conmebol.libertadores": "soccer_conmebol_copa_libertadores", "conmebol.sudamericana": "soccer_conmebol_copa_sudamericana",
  "eng.2": "soccer_efl_champ", "esp.2": "soccer_spain_segunda_division", "ita.2": "soccer_italy_serie_b", "ger.2": "soccer_germany_bundesliga2",
  "eng.fa": "soccer_fa_cup", "eng.league_cup": "soccer_england_efl_cup", "esp.copa_del_rey": "soccer_spain_copa_del_rey",
};
const MKT = { ml: "h2h", spread: "spreads", total: "totals" };
const store = () => getStore({ name: "estado", consistency: "strong" });

const norm = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(fc|cf|sc|ac|afc|cd|ud|sd|club|de|the)\b/g, " ").replace(/[^a-z0-9]+/g, " ").trim();
const same = (a, b) => { const x = norm(a), y = norm(b); if (!x || !y) return false; if (x === y || x.includes(y) || y.includes(x)) return true;
  const wx = x.split(" "), wy = new Set(y.split(" ")); return wx.filter((w) => w.length > 3 && wy.has(w)).length >= 1; };

const strict = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };
const findTeam = (list, name, extra = () => true) => list.find((x) => strict(x.name, name) && extra(x)) || list.find((x) => same(x.name, name) && extra(x));

export const oddsEnabled = () => !!Netlify.env.get("ODDS_API_KEY");

/* Busca la cuota de cada pick (no combinado, ya vinculado y con mercado clasificado). Devuelve [{id, odds, book}] */
export async function buscarCuotas(picks, log = console.log) {
  const key = Netlify.env.get("ODDS_API_KEY");
  if (!key) return [];
  const st = store();
  const meta = (await st.get("odds-meta", { type: "json" }).catch(() => null)) || {};
  const want = picks.filter((p) => p.mkt && MKT[p.mkt.t] && p.game && KEYS[p.game.league] && !(p.mkt.t === "total" && p.mkt.de && p.mkt.de !== "partido"));
  const bySport = {};
  for (const p of want) (bySport[KEYS[p.game.league]] ||= new Set()).add(MKT[p.mkt.t]);
  const out = [];
  for (const [sport, mset] of Object.entries(bySport)) {
    // Caché por mercado: solo se piden los mercados que no estén guardados de las últimas 2 horas
    const cached = {};
    for (const mk of mset) { const c = await st.get("odds-" + sport + "-" + mk, { type: "json" }).catch(() => null); if (c && Date.now() - c.at < 2 * 3600e3) cached[mk] = c.events; }
    const missing = [...mset].filter((mk) => !cached[mk]).sort();
    if (missing.length) {
      if (meta.remaining != null && meta.remaining < 25 + missing.length) { log("cuotas: quedan pocos créditos (" + meta.remaining + ")"); continue; }
      const url = `https://api.the-odds-api.com/v4/sports/${sport}/odds?apiKey=${encodeURIComponent(key)}&regions=us&markets=${missing.join(",")}&oddsFormat=american&bookmakers=${BOOKS.join(",")}`;
      let events = [];
      try {
        const r = await fetch(url);
        const rem = Number(r.headers.get("x-requests-remaining"));
        if (isFinite(rem)) { meta.remaining = rem; meta.used = Number(r.headers.get("x-requests-used")) || meta.used; meta.at = Date.now(); }
        if (r.ok) events = await r.json(); else log("cuotas " + sport + " " + r.status);
      } catch (e) { log("cuotas " + sport + " " + e.message); continue; }
      for (const mk of missing) {
        const evs = (Array.isArray(events) ? events : []).map((e) => ({ home_team: e.home_team, away_team: e.away_team,
          bookmakers: (e.bookmakers || []).map((b) => ({ key: b.key, markets: (b.markets || []).filter((m) => m.key === mk) })) }));
        cached[mk] = evs;
        await st.setJSON("odds-" + sport + "-" + mk, { at: Date.now(), events: evs }).catch(() => {});
      }
    }
    const merged = {};
    for (const [mk, evs] of Object.entries(cached)) for (const e of evs) {
      const k = e.home_team + "|" + e.away_team; const t = (merged[k] ||= { home_team: e.home_team, away_team: e.away_team, bookmakers: [] });
      for (const b of e.bookmakers) { let tb = t.bookmakers.find((x) => x.key === b.key); if (!tb) t.bookmakers.push(tb = { key: b.key, markets: [] }); tb.markets.push(...b.markets); }
    }
    const data = { events: Object.values(merged) };
    for (const p of want.filter((x) => KEYS[x.game.league] === sport)) {
      const [away, home] = String(p.game.name || "").split(" vs ");
      const evs = data.events || [];
      const ev = evs.find((e) => strict(e.home_team, home) && strict(e.away_team, away)) || evs.find((e) => (same(e.home_team, home) && same(e.away_team, away)) || (same(e.home_team, away) && same(e.away_team, home)));
      if (!ev) continue;
      const team = p.mkt.lado === "home" ? home : p.mkt.lado === "away" ? away : null;
      for (const bk of BOOKS) {
        const b = (ev.bookmakers || []).find((x) => x.key === bk);
        const m = b && (b.markets || []).find((x) => x.key === MKT[p.mkt.t]);
        if (!m) continue;
        let o = null;
        if (p.mkt.t === "ml" && team) o = findTeam(m.outcomes, team);
        else if (p.mkt.t === "spread" && team && p.mkt.linea != null) o = findTeam(m.outcomes, team, (x) => Number(x.point) === Number(p.mkt.linea));
        else if (p.mkt.t === "total" && p.mkt.ou && p.mkt.linea != null) o = m.outcomes.find((x) => x.name.toLowerCase() === p.mkt.ou && Number(x.point) === Number(p.mkt.linea));
        if (o && isFinite(Number(o.price))) { out.push({ id: p.id, odds: Math.round(Number(o.price)), book: BOOK_NAME[bk] || bk }); break; }
      }
    }
  }
  await st.setJSON("odds-meta", meta).catch(() => {});
  log("cuotas: " + out.length + " encontradas; créditos restantes " + (meta.remaining ?? "?"));
  return out;
}

export async function creditosCuotas() {
  try { return (await store().get("odds-meta", { type: "json" })) || {}; } catch { return {}; }
}
