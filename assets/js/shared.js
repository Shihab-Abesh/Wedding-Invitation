/* Shared helpers used by both the invitation (app.js) and the editor (admin.js).
   Text, dates, curtain geometry and the hand-drawn SVG ornaments live here. */
(function (g) {
  'use strict';

  /* ---------- text + language ---------- */
  const BN_DIGITS = '০১২৩৪৫৬৭৮৯';
  const toBnDigits = (s) => String(s).replace(/[0-9]/g, (d) => BN_DIGITS[d]);

  function tr(v, lang) {
    if (v == null) return '';
    if (typeof v === 'string' || typeof v === 'number') return String(v);
    const want = v[lang];
    if (want != null && String(want).trim() !== '') return String(want);
    return String(v.en || v.bn || '');
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // escape + keep line breaks
  const escBr = (s) => esc(s).replace(/\n/g, '<br>');

  const num = (n, lang) => (lang === 'bn' ? toBnDigits(n) : String(n));

  function firstGrapheme(str) {
    str = String(str || '').trim();
    if (!str) return '';
    try {
      if (g.Intl && Intl.Segmenter) {
        const it = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(str)[Symbol.iterator]();
        return it.next().value.segment;
      }
    } catch (e) { /* fall through */ }
    return Array.from(str)[0];
  }

  /* ---------- dates ---------- */
  const MONTHS = {
    en: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    bn: ['জানুয়ারি', 'ফেব্রুয়ারি', 'মার্চ', 'এপ্রিল', 'মে', 'জুন', 'জুলাই', 'আগস্ট', 'সেপ্টেম্বর', 'অক্টোবর', 'নভেম্বর', 'ডিসেম্বর']
  };
  const MONTHS_SHORT_EN = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'Aug', 'Sept', 'Oct', 'Nov', 'Dec'];
  const WEEKDAYS = {
    en: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    bn: ['রবিবার', 'সোমবার', 'মঙ্গলবার', 'বুধবার', 'বৃহস্পতিবার', 'শুক্রবার', 'শনিবার']
  };

  function parseDate(s) {
    const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(s || '').trim());
    if (!m) return null;
    return { y: +m[1], m: +m[2], d: +m[3] };
  }

  function weekdayOf(p) { return new Date(Date.UTC(p.y, p.m - 1, p.d)).getUTCDay(); }

  function formatDateLong(s, lang) {
    const p = parseDate(s);
    if (!p) return '';
    const wd = WEEKDAYS[lang === 'bn' ? 'bn' : 'en'][weekdayOf(p)];
    if (lang === 'bn') return `${wd}, ${toBnDigits(p.d)} ${MONTHS.bn[p.m - 1]} ${toBnDigits(p.y)}`;
    return `${wd}, ${p.d} ${MONTHS.en[p.m - 1]} ${p.y}`;
  }

  function dateParts(s, lang) {
    const p = parseDate(s);
    if (!p) return { day: '', month: '', year: '' };
    if (lang === 'bn') return { day: toBnDigits(p.d), month: MONTHS.bn[p.m - 1], year: toBnDigits(p.y) };
    return { day: String(p.d), month: MONTHS_SHORT_EN[p.m - 1], year: String(p.y) };
  }

  function formatTime(t, lang) {
    const m = /^(\d{1,2}):(\d{2})/.exec(String(t || '').trim());
    if (!m) return String(t || '');
    const h = +m[1], mi = m[2];
    const h12 = ((h + 11) % 12) + 1;
    if (lang === 'bn') {
      let part = 'রাত';
      if (h >= 4 && h < 12) part = 'সকাল';
      else if (h >= 12 && h < 15) part = 'দুপুর';
      else if (h >= 15 && h < 18) part = 'বিকেল';
      else if (h >= 18 && h < 20) part = 'সন্ধ্যা';
      return `${part} ${toBnDigits(h12)}:${toBnDigits(mi)}`;
    }
    return `${h12}:${mi} ${h < 12 ? 'AM' : 'PM'}`;
  }

  function instant(dateStr, timeStr, tz) {
    const p = parseDate(dateStr);
    if (!p) return null;
    const tm = /^(\d{1,2}):(\d{2})/.exec(String(timeStr || '')) || [0, '0', '00'];
    const pad = (n) => String(n).padStart(2, '0');
    const zone = /^[+-]\d{2}:\d{2}$/.test(tz || '') ? tz : '+06:00';
    const d = new Date(`${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(tm[1])}:${tm[2]}:00${zone}`);
    return isNaN(d) ? null : d;
  }

  function mainEvent(content) {
    const items = (content.events && content.events.items) || [];
    return items.find((e) => e.main) || items[0] || null;
  }

  /* ---------- curtain geometry ----------
     Inner edge of the LEFT curtain as a fraction of the width, for a height
     fraction yN (0 top, 1 bottom) and opening progress p (0 closed, 1 tied back). */
  const GEO = { closed: 0.503, top: 0.35, tie: 0.085, tieY: 0.6, bottom: 0.205, maxDelay: 0.2 };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  function openEdge(yN, geo) {
    const G = geo || GEO;
    if (yN <= G.tieY) {
      const s = 1 - yN / G.tieY;
      return G.tie + (G.top - G.tie) * s * s;
    }
    const s = (yN - G.tieY) / (1 - G.tieY);
    return G.tie + (G.bottom - G.tie) * s * s;
  }

  function edgeAt(yN, p, geo) {
    const G = geo || GEO;
    const delay = G.maxDelay * Math.min(1, Math.abs(yN - G.tieY) / 0.6);
    const q = easeInOut(clamp((p - delay) / (1 - G.maxDelay), 0, 1));
    return G.closed + (openEdge(yN, G) - G.closed) * q;
  }

  /* Returns path strings for the left curtain (mirror it for the right one). */
  function curtainPaths(W, H, p, geo) {
    const G = geo || GEO;
    const steps = 36;
    const edge = [];
    for (let i = 0; i <= steps; i++) {
      const yN = i / steps;
      edge.push([edgeAt(yN, p, G) * W, yN * H]);
    }
    const f = (n) => n.toFixed(1);
    let shape = `M0 0 L${f(edge[0][0])} 0`;
    for (let i = 1; i < edge.length; i++) shape += ` L${f(edge[i][0])} ${f(edge[i][1])}`;
    shape += ` L0 ${f(H)} Z`;

    let rim = `M${f(edge[0][0])} 0`;
    for (let i = 1; i < edge.length; i++) rim += ` L${f(edge[i][0])} ${f(edge[i][1])}`;

    const n = clamp(Math.round((G.closed * W) / 24), 9, 26);
    let lines = '', shadows = '';
    for (let k = 0; k < n; k++) {
      const fl = (k + 0.62) / n; // light fold line
      const fs = (k + 0.18) / n; // shadow fold
      let a = '', b = '';
      for (let i = 0; i <= steps; i++) {
        const [ex, y] = edge[i];
        const wob = Math.sin(y / 41 + k * 1.9) * 1.6 * (ex / (G.closed * W));
        a += (i ? ' L' : 'M') + f(fl * ex + wob) + ' ' + f(y);
        b += (i ? ' L' : 'M') + f(fs * ex + wob * 0.6) + ' ' + f(y);
      }
      lines += a + ' ';
      shadows += b + ' ';
    }
    const tieX = edgeAt(G.tieY, p, G) * W;
    return { shape, rim, lines, shadows, tieX, tieY: G.tieY * H, count: n };
  }

  /* Paints both curtains onto a 2D canvas.
     The fabric is drawn once into an offscreen bitmap; every animation frame only copies
     thin horizontal slices of it, squeezed to the curtain's width at that height.
     That is very cheap for phones and makes the folds bunch up naturally at the tie-back.
     ctx is pre-scaled so 1 unit = 1 CSS pixel. col = { curtain, curtainLines, gold } */
  function buildFabric(W, H, dpr, col) {
    const G = GEO;
    const fw = Math.ceil(G.closed * W) + 2;
    const cv = document.createElement('canvas');
    cv.width = Math.round(fw * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = col.curtain; c.fillRect(0, 0, fw, H);
    const gr = c.createLinearGradient(0, 0, 0, H);
    gr.addColorStop(0, 'rgba(0,0,0,.28)'); gr.addColorStop(0.18, 'rgba(0,0,0,.04)');
    gr.addColorStop(0.8, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,.2)');
    c.fillStyle = gr; c.fillRect(0, 0, fw, H);
    const n = clamp(Math.round((G.closed * W) / 24), 9, 26);
    const sp = (G.closed * W) / n;
    const lines = (offset, wobScale) => {
      c.beginPath();
      for (let k = 0; k < n; k++) {
        const x0 = (k + offset) * sp;
        for (let y = 0; y <= H; y += 6) {
          const x = x0 + Math.sin(y / 41 + k * 1.9) * 1.6 * wobScale;
          if (y) c.lineTo(x, y); else c.moveTo(x, y);
        }
      }
    };
    c.lineCap = 'round';
    // soft fold shadow: a wide faint band + a narrower darker core
    lines(0.18, 0.6); c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = sp * 0.62; c.stroke();
    c.strokeStyle = 'rgba(0,0,0,.08)'; c.lineWidth = sp * 0.28; c.stroke();
    // fold highlight + thread line
    lines(0.62, 1); c.strokeStyle = 'rgba(255,255,255,.06)'; c.lineWidth = sp * 0.3; c.stroke();
    c.globalAlpha = 0.85; c.strokeStyle = col.curtainLines; c.lineWidth = 1.1; c.stroke();
    return { cv, fw, n };
  }

  function paintCurtains(ctx, W, H, p, col, cache, dpr) {
    const G = GEO;
    dpr = dpr || 1;
    cache = cache || {};
    const key = [W, H, dpr, col.curtain, col.curtainLines].join('|');
    if (cache.key !== key) { cache.fab = buildFabric(W, H, dpr, col); cache.key = key; }
    const fab = cache.fab;
    const slice = (cache.slice) || (H > 900 ? 4 : 3);
    const rows = Math.ceil(H / slice);
    const ex = new Float32Array(rows + 1);
    for (let i = 0; i <= rows; i++) ex[i] = edgeAt(Math.min(1, (i * slice) / H), p, G) * W;
    const sh = slice * dpr;
    const k = fab.fw / (G.closed * W);
    for (let side = 0; side < 2; side++) {
      ctx.save();
      if (side) { ctx.translate(W, 0); ctx.scale(-1, 1); }
      // smooth outline as a clip, so the slice steps never show
      ctx.save();
      ctx.beginPath(); ctx.moveTo(0, 0);
      for (let i = 0; i <= rows; i++) ctx.lineTo(ex[i], Math.min(H, i * slice));
      ctx.lineTo(0, H); ctx.closePath(); ctx.clip();
      for (let i = 0; i < rows; i++) {
        const y = i * slice;
        const w = Math.max(ex[i], ex[i + 1]) + 1.5;
        ctx.drawImage(fab.cv, 0, y * dpr, fab.cv.width, Math.min(sh, fab.cv.height - y * dpr), 0, y, w * k, slice + 0.6);
      }
      ctx.restore();
      // inner edge shadow (also hides the slice steps)
      ctx.beginPath(); ctx.moveTo(ex[0], 0);
      for (let i = 1; i <= rows; i += 2) ctx.lineTo(ex[i], i * slice);
      ctx.lineTo(ex[rows], H);
      ctx.strokeStyle = 'rgba(0,0,0,.24)'; ctx.lineWidth = 2.6; ctx.stroke();
      // tie-back rope + tassel
      const tieA = clamp((p - 0.62) / 0.3, 0, 1);
      if (tieA > 0) {
        const ty = G.tieY * H, tx = edgeAt(G.tieY, p, G) * W;
        ctx.globalAlpha = tieA;
        ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(-4, ty - 6); ctx.quadraticCurveTo(tx * 0.5, ty + 9, tx + 5, ty);
        ctx.strokeStyle = col.gold; ctx.lineWidth = 4.5; ctx.stroke();
        ctx.setLineDash([2, 4]); ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = col.gold;
        ctx.beginPath(); ctx.arc(tx + 5, ty, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(tx + 2, ty + 4); ctx.lineTo(tx + 9, ty + 4); ctx.lineTo(tx + 12, ty + 30);
        ctx.quadraticCurveTo(tx + 5, ty + 34, tx - 1, ty + 30); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,.18)'; ctx.lineWidth = 0.8;
        for (let q = 0; q < 3; q++) { ctx.beginPath(); ctx.moveTo(tx + 3 + q * 2.6, ty + 8); ctx.lineTo(tx + 1.5 + q * 3.6, ty + 30); ctx.stroke(); }
        ctx.globalAlpha = 1;
      }
      ctx.restore();
    }
    return cache;
  }

  /* ---------- ornaments (original line art) ---------- */
  const SVG = {};

  SVG.rings = () => `
  <svg viewBox="0 0 64 48" class="orn orn-rings" aria-hidden="true">
    <circle cx="25" cy="29" r="12.5"/><circle cx="39" cy="29" r="12.5"/>
    <path d="M39 16.5 l-4.2-5 l2.4-3.4 h3.6 l2.4 3.4 z"/>
    <path d="M35 11.5 h8.4 M37.2 8.1 l1.8 3.4 l1.8-3.4" class="thin"/>
  </svg>`;

  SVG.flourish = () => `
  <svg viewBox="0 0 220 24" class="orn orn-flourish" aria-hidden="true">
    <path d="M6 12 C40 12 62 4 86 12 C96 15 102 15 104 12"/>
    <path d="M214 12 C180 12 158 4 134 12 C124 15 118 15 116 12"/>
    <path d="M110 5 l5 7 l-5 7 l-5 -7 z" class="fill"/>
    <circle cx="96" cy="12" r="1.6" class="fill"/><circle cx="124" cy="12" r="1.6" class="fill"/>
  </svg>`;

  SVG.bow = () => `
  <svg viewBox="0 0 140 84" class="orn orn-bow" aria-hidden="true">
    <path class="bg" d="M64 30 C46 6 14 4 16 26 C18 44 46 40 63 35 Z"/>
    <path class="bg" d="M76 30 C94 6 126 4 124 26 C122 44 94 40 77 35 Z"/>
    <path class="bg" d="M65 37 C58 50 46 64 32 78 L41 75 L44 83 C56 68 64 54 69 40 Z"/>
    <path class="bg" d="M75 37 C82 50 94 64 108 78 L99 75 L96 83 C84 68 76 54 71 40 Z"/>
    <path d="M58 30 C44 20 30 17 24 25"/><path d="M82 30 C96 20 110 17 116 25"/>
    <ellipse class="bg" cx="70" cy="32" rx="7.5" ry="8.5"/>
    <path d="M66 28 C68 31 72 31 74 28" class="thin"/>
  </svg>`;

  SVG.pavilion = () => `
  <svg viewBox="0 0 320 190" class="orn orn-pavilion" aria-hidden="true">
    <path class="bg" d="M38 178 V154 H282 V178 Z M70 154 V96 H250 V154 Z M120 96 V82 H200 V96 Z M118 82 C110 62 128 44 160 33 C192 44 210 62 202 82 Z"/>
    <path d="M8 178 H312"/>
    <path d="M38 178 V154 H282 V178 M30 154 H290 M46 166 H274"/>
    <path d="M70 154 V96 H250 V154"/>
    <path d="M64 96 H256 M66 90 H254 V96 M66 90 V96"/>
    <path d="M74 90 v-4 h6 v4 M88 90 v-4 h6 v4 M102 90 v-4 h6 v4 M212 90 v-4 h6 v4 M226 90 v-4 h6 v4 M240 90 v-4 h6 v4"/>
    <path d="M138 154 V122 Q138 108 160 98 Q182 108 182 122 V154"/>
    <path d="M144 154 V124 Q144 113 160 105 Q176 113 176 124 V154" class="thin"/>
    <path d="M92 154 V128 Q92 118 105 111 Q118 118 118 128 V154"/>
    <path d="M202 154 V128 Q202 118 215 111 Q228 118 228 128 V154"/>
    <circle cx="105" cy="101" r="3.2" class="thin"/><circle cx="215" cy="101" r="3.2" class="thin"/>
    <path d="M120 96 V82 H200 V96 M118 82 H202"/>
    <path d="M128 82 v14 M140 82 v14 M152 82 v14 M168 82 v14 M180 82 v14 M192 82 v14" class="thin"/>
    <path d="M118 82 C110 62 128 44 160 33 C192 44 210 62 202 82"/>
    <path d="M136 80 C132 64 144 50 160 42 C176 50 188 64 184 80" class="thin"/>
    <path d="M160 33 V20 M156 24 h8"/><circle cx="160" cy="17" r="2.6"/>
    <path d="M80 90 V76 M98 90 V76 M77 76 H101 M78 76 C80 64 98 64 100 76 M89 66 V60"/>
    <path d="M222 90 V76 M240 90 V76 M219 76 H243 M220 76 C222 64 240 64 242 76 M231 66 V60"/>
    <path d="M50 154 V82 M60 154 V82 M46 124 H64 M46 100 H64 M47 82 H63 M48 82 C49 70 61 70 62 82 M55 72 V64"/>
    <path d="M260 154 V82 M270 154 V82 M256 124 H274 M256 100 H274 M257 82 H273 M258 82 C259 70 271 70 272 82 M265 72 V64"/>
    <path class="dots" d="M55 66 C80 90 104 92 128 80"/><path class="dots" d="M265 66 C240 90 216 92 192 80"/>
    <path class="dots" d="M64 104 C90 118 120 118 138 112"/><path class="dots" d="M256 104 C230 118 200 118 182 112"/>
    <path d="M18 178 C16 166 22 158 28 154 M18 178 C22 168 30 164 34 166 M18 178 C12 170 6 170 4 172" class="thin"/>
    <path d="M302 178 C304 166 298 158 292 154 M302 178 C298 168 290 164 286 166 M302 178 C308 170 314 170 316 172" class="thin"/>
    <circle cx="28" cy="152" r="2.4" class="thin"/><circle cx="292" cy="152" r="2.4" class="thin"/>
  </svg>`;

  SVG.gift = () => {
    let leaves = '';
    const leaf = (cx, cy, ang) => `<ellipse cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" rx="5.4" ry="2.2" transform="rotate(${ang.toFixed(1)} ${cx.toFixed(1)} ${cy.toFixed(1)})"/>`;
    for (let i = 0; i < 8; i++) {
      const deg = 115 + i * 14; // along the left side, bottom to top
      const a = deg * Math.PI / 180;
      const x = 50 + Math.cos(a) * 38, y = 52 + Math.sin(a) * 38;
      const ang = deg + 90 - 28 * (i % 2 ? 1 : -1);
      leaves += leaf(x, y, ang);
      leaves += leaf(100 - x, y, 180 - ang);
    }
    return `
  <svg viewBox="0 0 100 100" class="orn orn-gift" aria-hidden="true">
    <path d="M40 89 A38 38 0 0 1 23 25 M60 89 A38 38 0 0 0 77 25" class="thin"/>
    <g class="leaves">${leaves}</g>
    <rect x="33" y="47" width="34" height="27" rx="1.5"/>
    <rect x="30" y="40" width="40" height="8" rx="1.5"/>
    <path d="M50 40 V74"/>
    <path d="M50 40 C44 28 34 31 39 38 C41 40 46 40 50 40 Z"/>
    <path d="M50 40 C56 28 66 31 61 38 C59 40 54 40 50 40 Z"/>
    <path d="M47 92 l3 -4 l3 4" class="thin"/>
  </svg>`;
  };

  SVG.music = (on) => on
    ? `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/></svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/><path d="M3 3l18 18"/></svg>`;

  /* wavy rounded frame path, sized to the element */
  function wavyFrame(w, h, opt) {
    const o = Object.assign({ inset: 10, radius: 26, amp: 3.2, wave: 24 }, opt || {});
    const x0 = o.inset, y0 = o.inset, x1 = w - o.inset, y1 = h - o.inset, r = o.radius;
    const sw = x1 - x0 - 2 * r, sh = y1 - y0 - 2 * r;
    if (sw <= 0 || sh <= 0) return '';
    const arc = (Math.PI / 2) * r;
    const per = 2 * sw + 2 * sh + 4 * arc;
    const waves = Math.max(8, Math.round(per / o.wave));
    const lam = per / waves;
    const segs = [
      { len: sw, pt: (t) => [x0 + r + t, y0, 0, -1] },
      { len: arc, pt: (t) => { const a = -Math.PI / 2 + t / r; return [x1 - r + Math.cos(a) * r, y0 + r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; } },
      { len: sh, pt: (t) => [x1, y0 + r + t, 1, 0] },
      { len: arc, pt: (t) => { const a = t / r; return [x1 - r + Math.cos(a) * r, y1 - r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; } },
      { len: sw, pt: (t) => [x1 - r - t, y1, 0, 1] },
      { len: arc, pt: (t) => { const a = Math.PI / 2 + t / r; return [x0 + r + Math.cos(a) * r, y1 - r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; } },
      { len: sh, pt: (t) => [x0, y1 - r - t, -1, 0] },
      { len: arc, pt: (t) => { const a = Math.PI + t / r; return [x0 + r + Math.cos(a) * r, y0 + r + Math.sin(a) * r, Math.cos(a), Math.sin(a)]; } }
    ];
    let d = '', s = 0;
    const step = 2.5;
    segs.forEach((seg) => {
      for (let t = 0; t < seg.len; t += step) {
        const [x, y, nx, ny] = seg.pt(t);
        const off = Math.sin(((s + t) / lam) * Math.PI * 2) * o.amp;
        d += (d ? 'L' : 'M') + (x + nx * off).toFixed(1) + ' ' + (y + ny * off).toFixed(1);
      }
      s += seg.len;
    });
    return d + 'Z';
  }

  /* ---------- colour themes ---------- */
  const THEMES = {
    classic: { name: 'Classic Red', colors: { curtain: '#b3141f', curtainLines: '#fdeee8', accent: '#7b1626', gold: '#c8a25c', background: '#fbf7f1', card: '#fffdf9', text: '#4f3b37', muted: '#8a7470', buttonText: '#fff8f0' } },
    maroon: { name: 'Royal Maroon', colors: { curtain: '#6e0f1d', curtainLines: '#e8c98a', accent: '#6e0f1d', gold: '#c9a24d', background: '#fbf4e8', card: '#fffaf1', text: '#3f2a25', muted: '#8b7360', buttonText: '#fbf1dc' } },
    emerald: { name: 'Emerald', colors: { curtain: '#0f5a43', curtainLines: '#f3e7c4', accent: '#0f4d3a', gold: '#c8a24a', background: '#f7f5ee', card: '#fdfcf7', text: '#2e3b34', muted: '#6f7d74', buttonText: '#f8f1dc' } },
    blush: { name: 'Blush Rose', colors: { curtain: '#d98c97', curtainLines: '#fff3f3', accent: '#a2475a', gold: '#d4af7a', background: '#fff8f6', card: '#fffdfc', text: '#5a3d42', muted: '#9a7a80', buttonText: '#fff7f5' } },
    navy: { name: 'Midnight Navy', colors: { curtain: '#1d2b4f', curtainLines: '#e9d9a8', accent: '#24345e', gold: '#c9a85a', background: '#f6f4ef', card: '#fdfcf9', text: '#2e3446', muted: '#737a8c', buttonText: '#f7efd9' } },
    holud: { name: 'Holud Yellow', colors: { curtain: '#e0a01a', curtainLines: '#fff4d6', accent: '#a14d0c', gold: '#d18a17', background: '#fffaf0', card: '#fffdf7', text: '#4d3a1f', muted: '#8f7a58', buttonText: '#fff8e8' } }
  };

  g.Shared = {
    THEMES,
    tr, esc, escBr, num, toBnDigits, firstGrapheme,
    MONTHS, WEEKDAYS, parseDate, formatDateLong, dateParts, formatTime, instant, mainEvent,
    GEO, clamp, easeInOut, openEdge, edgeAt, curtainPaths, paintCurtains, wavyFrame, SVG
  };
})(window);
