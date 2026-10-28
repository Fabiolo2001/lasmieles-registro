/* Conecta la página con las funciones de Netlify (/api/...).
   Imita la pequeña API que usa la página (db, assets, sample, downloads)
   para que el resto del código no cambie. */
(function () {
  const RID = () => Array.from(crypto.getRandomValues(new Uint8Array(15)), b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
  async function call(method, path, body, headers) {
    let r;
    try {
      r = await fetch('/api/' + path, {
        method, credentials: 'same-origin',
        headers: body instanceof Blob ? headers : body !== undefined ? { 'content-type': 'application/json' } : undefined,
        body: body instanceof Blob ? body : body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (e) { throw { code: 'unavailable', message: 'Sin conexión' }; }
    if (r.status === 401) { window.dispatchEvent(new Event('lm-sesion-caducada')); throw { code: 'not_granted', message: 'Sesión caducada' }; }
    let j = null; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw { code: r.status === 413 ? 'quota_exceeded' : r.status === 400 ? 'invalid_argument' : 'unavailable', message: (j && j.error) || r.statusText };
    return j;
  }

  function makeDb() {
    const subs = new Set();
    const snapOf = rows => {
      const docs = rows.map(r => ({ id: r.id, exists: true, data: () => r.data }));
      return { docs, size: docs.length, empty: !docs.length };
    };
    const fetchRows = (table, where) => call('GET', 'docs/' + table + (where ? '?month=' + encodeURIComponent(where[1]) : ''));
    async function run(s) {
      try { const rows = await fetchRows(s.table, s.where); if (s.alive) s.cb(snapOf(rows)); }
      catch (e) { console.warn(e); }
    }
    const timers = {};
    function refresh(table) {
      clearTimeout(timers[table]);
      timers[table] = setTimeout(() => subs.forEach(s => { if (s.table === table) run(s); }), 120);
    }
    // Ver los cambios del resto del equipo
    setInterval(() => { if (document.visibilityState === 'visible') { refresh('picks'); refresh('notes'); } }, 15000);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { refresh('picks'); refresh('notes'); } });

    function docRef(table, id) {
      const p = 'docs/' + table + '/' + encodeURIComponent(id);
      return {
        id,
        async set(data) { await call('PUT', p, data); refresh(table); },
        async update(patch) { await call('PATCH', p, patch); refresh(table); },
        async delete() { await call('DELETE', p); refresh(table); },
      };
    }
    function collection(table) {
      const q = where => ({
        where: (f, op, v) => q([f, v]),
        onSnapshot: cb => { const s = { table, where, cb, alive: true }; subs.add(s); run(s); return () => { s.alive = false; subs.delete(s); }; },
        get: async () => snapOf(await fetchRows(table, where)),
      });
      return Object.assign(q(null), {
        doc: id => docRef(table, id || RID()),
        add: async data => { const r = docRef(table, RID()); await r.set(data); return r; },
      });
    }
    return { collection, doc: path => { const [t, id] = path.split('/'); return docRef(t, id); } };
  }

  /* Reduce la foto antes de subirla o enviarla a Claude */
  async function shrink(file, max, q) {
    try {
      const bmp = await createImageBitmap(file);
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      return await new Promise(r => c.toBlob(r, 'image/jpeg', q));
    } catch (e) { return file; }
  }
  const toB64 = blob => new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1]);
    fr.onerror = rej; fr.readAsDataURL(blob);
  });

  const assets = {
    async upload(file) {
      const blob = await shrink(file, 2000, 0.85);
      const j = await call('POST', 'fotos', blob, { 'content-type': blob.type || 'image/jpeg' });
      return { id: j.id, url: '/api/fotos/' + j.id.split('/').map(encodeURIComponent).join('/') };
    },
  };

  function parseJsonLoose(t) {
    const tries = [t];
    const f = t.match(/```(?:json)?\s*([\s\S]*?)```/); if (f) tries.push(f[1]);
    const a = t.search(/[\[{]/), b = Math.max(t.lastIndexOf(']'), t.lastIndexOf('}'));
    if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
    for (const s of tries) { try { return JSON.parse(s); } catch (e) {} }
    throw { code: 'invalid_json', message: 'Respuesta sin JSON', text: t };
  }
  async function ask(prompt, opts = {}) {
    const imgs = [];
    for (const f of [].concat(opts.images || []).slice(0, 6)) {
      const blob = await shrink(f, 1568, 0.85);
      imgs.push({ type: 'image/jpeg', data: await toB64(blob) });
    }
    let r;
    try {
      r = await fetch('/api/leer', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, images: imgs }) });
    } catch (e) { throw { code: 'upstream_error', message: 'Sin conexión' }; }
    if (r.status === 401) { window.dispatchEvent(new Event('lm-sesion-caducada')); throw { code: 'not_granted', message: 'Sesión caducada' }; }
    if (!r.ok) {
      let j = {}; try { j = await r.json(); } catch (e) {}
      throw { code: r.status === 429 ? 'rate_limited' : r.status === 413 ? 'image_rejected' : 'upstream_error', message: j.error || r.statusText };
    }
    const rd = r.body.getReader(); const dec = new TextDecoder();
    let text = '';
    for (;;) { const { value, done } = await rd.read(); if (done) break; text += dec.decode(value, { stream: true }); }
    text += dec.decode();
    const i = text.indexOf('\u0000');
    const flag = i >= 0 ? text.slice(i + 1) : '';
    if (i >= 0) text = text.slice(0, i);
    if (flag === 'ERROR') throw { code: 'upstream_error', message: 'Se cortó la lectura', text };
    if (flag === 'RECHAZADO') throw { code: 'refused', message: 'Rechazado' };
    if (!text.trim()) throw { code: 'empty_completion', message: 'Sin respuesta' };
    return { text, truncated: flag === 'CORTADO' };
  }
  const sample = (p, o) => ask(p, o);
  sample.json = async (p, o) => { const { text, truncated } = await ask(p, o); if (truncated) throw { code: 'invalid_json', message: 'Respuesta cortada', text }; return parseJsonLoose(text); };
  sample.limits = async () => ({ maxPromptBytes: 262144, images: { maxCount: 6, maxInputBytes: 20e6, mediaTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] } });

  const downloads = {
    async save({ filename, data }) {
      const blob = data instanceof Blob ? data : new Blob([data]);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = filename;
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      return { status: 'saved' };
    },
  };

  window.LM = { call, makeDb, assets, sample, downloads };
})();
