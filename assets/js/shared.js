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

  /* Bismillah in Nastaliq calligraphy: the outline of the ﷽ (U+FDFD) glyph from
     Noto Nastaliq Urdu (SIL Open Font License), so no extra font has to load. */
  const BISMILLAH_PATH = 'M251 452Q229 452 215 442Q201 433 194 418Q188 404 188 388Q188 366 192 343Q197 320 209 294L205 294L204 288Q207 287 212 284Q218 282 224 278Q233 273 244 266Q254 260 262 254Q266 251 268 249Q270 247 272 245Q274 242 276 237Q279 232 284 224Q288 215 292 209Q296 203 299 199Q303 194 308 191Q314 188 322 184Q331 179 335 174Q339 168 340 160Q341 156 342 153Q342 150 342 145Q343 140 343 132Q343 124 343 110Q343 97 343 77Q343 67 345 57Q346 48 349 38Q351 29 354 21Q358 12 361 4L366 6Q366 9 365 14Q364 19 364 27Q364 35 363 48Q363 60 362 80Q362 94 361 105Q359 116 358 127Q356 138 354 151Q353 154 352 160Q350 166 348 173Q346 180 343 185Q340 192 337 196Q334 200 330 203Q326 206 322 209Q317 212 310 216Q304 221 300 224Q296 226 294 230Q291 233 288 239Q285 244 280 254Q277 260 274 266Q270 271 266 275Q262 280 257 285Q254 286 246 288Q238 291 218 293Q211 309 208 324Q204 338 204 351Q204 368 209 378Q214 389 223 396Q231 402 242 404Q252 407 263 407Q281 407 296 401Q312 395 324 382Q335 370 342 356Q348 342 351 327Q354 311 356 294Q356 276 356 256L360 254Q365 255 369 256Q373 256 376 256Q385 256 398 250Q410 245 422 230Q428 222 434 216Q439 209 443 206Q446 196 454 185Q461 174 473 165Q481 159 489 155Q498 152 506 148Q513 145 520 142Q526 139 534 136Q528 133 519 132Q510 130 502 129Q493 128 487 128Q479 128 473 130Q467 133 462 139L456 136Q464 119 475 111Q486 103 500 103Q506 103 516 105Q525 106 534 109Q544 111 551 114Q558 117 561 119L562 121Q558 128 552 135Q546 141 540 145Q535 149 527 153Q518 157 509 162Q500 166 491 170Q483 174 478 177Q465 184 462 188Q459 192 459 195Q459 198 461 199Q464 201 471 206Q474 207 477 209Q479 211 479 216Q479 218 478 223Q476 228 473 233Q470 238 466 241Q462 244 458 244Q454 244 451 243Q448 241 444 239Q440 237 435 237Q430 237 423 244Q416 250 408 258Q404 263 400 267Q396 271 392 274Q387 278 381 280Q375 282 368 282H367Q366 300 363 318Q360 336 355 354Q349 372 341 389Q332 405 321 418Q306 434 289 443Q271 452 251 452ZM0 507Q0 501 0 495Q0 489 0 482Q0 476 0 470Q0 463 0 456Q0 424 1 397Q2 370 6 348Q10 326 19 308Q25 295 31 285Q38 276 46 267Q54 259 65 252Q77 245 92 237Q96 227 101 217Q106 207 112 198Q118 188 124 180Q130 172 137 165Q148 154 160 147Q172 140 184 140Q190 140 193 142Q196 143 199 145Q202 147 205 149Q208 150 212 150Q222 150 230 147Q238 144 245 138Q252 133 258 128L277 112Q275 111 271 109Q267 108 260 105Q254 103 244 99Q238 97 234 96Q230 95 225 95Q219 95 215 97Q210 99 208 104L201 102Q209 86 218 79Q228 72 240 72Q248 72 258 76Q268 80 278 84Q288 89 294 92Q297 92 298 93Q300 94 302 94Q303 94 304 94L305 98Q304 98 299 103Q294 107 288 114Q281 120 274 127Q266 135 259 142Q249 152 240 160Q231 168 222 172Q214 177 204 177Q197 177 194 174Q190 172 186 169Q182 167 176 167Q157 167 145 176Q132 186 123 201Q129 202 136 204Q143 206 148 209Q153 212 153 216Q153 220 151 226Q149 232 145 238Q142 245 138 251Q133 258 129 260Q126 262 122 263Q110 265 99 268Q88 270 78 274Q64 279 52 287Q39 295 32 309Q28 316 25 326Q23 336 21 348Q20 357 19 366Q18 375 17 384Q16 394 16 404Q15 414 14 424Q13 447 12 462Q12 476 11 485Q10 494 10 499Q10 504 9 507ZM465 294 464 288Q470 286 481 280Q492 274 504 266Q506 265 509 263Q511 262 514 260Q516 258 518 256Q521 255 523 253Q527 250 530 247Q532 244 535 239Q538 234 543 224Q549 214 553 208Q557 201 560 197Q564 194 569 190Q574 188 582 184Q591 179 595 174Q599 169 600 160Q602 154 602 148Q602 143 602 138L603 78Q603 66 605 56Q606 47 608 38Q611 29 614 20Q618 12 621 4L626 6Q626 9 625 13Q625 17 624 22Q624 28 624 36Q624 43 623 54L622 80Q622 90 620 105Q619 119 616 134Q614 150 611 163Q607 177 603 185Q599 194 595 199Q591 204 585 207Q580 211 570 216Q562 222 557 226Q552 230 549 238Q546 242 544 246Q542 250 540 254Q535 264 530 270Q526 278 517 285Q514 286 510 288Q505 289 497 290Q491 291 483 292Q475 293 465 294ZM798 507Q798 500 797 494Q797 488 797 482Q797 476 797 469Q797 463 797 456Q797 428 798 401Q799 374 803 350Q807 326 816 308Q822 294 829 284Q836 274 844 266Q852 258 864 251Q874 244 890 237Q894 225 900 213Q906 201 913 191Q920 181 925 174Q927 172 933 166Q938 160 946 154Q954 148 963 144Q973 140 983 140Q988 140 991 141Q994 143 996 144Q998 146 1001 147Q1003 149 1006 149Q1015 149 1020 144Q1026 138 1028 132H1032Q1034 134 1038 136Q1041 138 1046 138Q1052 138 1055 134Q1059 130 1060 124L1066 124Q1066 125 1066 126Q1068 128 1070 129Q1072 129 1074 129Q1080 129 1083 126Q1086 122 1088 109Q1088 104 1089 98Q1089 92 1089 85Q1090 76 1092 70Q1094 63 1097 57Q1100 50 1106 43L1111 44Q1110 47 1110 50Q1109 53 1108 57Q1108 62 1108 66Q1108 70 1107 74Q1107 82 1104 94Q1102 105 1098 116Q1095 127 1090 135Q1086 144 1080 150Q1074 156 1066 156Q1064 156 1062 156Q1060 155 1057 153Q1052 160 1048 162Q1043 165 1038 165Q1033 165 1030 163Q1026 162 1024 160Q1020 165 1013 170Q1007 176 998 176Q993 176 991 174Q988 173 986 171Q984 170 981 168Q978 167 972 167Q960 167 951 172Q941 177 934 185Q926 192 921 201Q926 202 931 203Q936 205 940 206Q945 208 948 211Q950 214 950 216Q950 220 947 229Q944 238 939 246Q936 251 932 256Q928 260 924 261Q922 262 916 263Q911 264 905 266Q898 267 894 268Q880 272 867 277Q854 283 844 290Q834 298 829 309Q825 317 824 322Q822 327 820 334Q819 343 817 358Q816 373 814 390Q813 406 812 422Q811 439 810 454Q809 469 808 483Q808 497 806 507ZM997 83 996 79Q1005 77 1013 74Q1021 72 1026 69Q1032 67 1032 66V65Q1024 62 1017 61Q1010 60 1008 60Q1004 60 1003 60Q1001 61 1000 62L997 61Q1000 53 1004 49Q1008 45 1013 45Q1017 45 1026 47Q1036 48 1049 54L1050 58Q1050 59 1046 62Q1043 65 1038 69Q1034 72 1029 75Q1024 78 1022 79Q1021 79 1016 80Q1010 81 1005 82Q1000 83 997 83ZM1074 227Q1070 223 1067 220Q1064 216 1060 214Q1057 210 1053 208V206Q1055 204 1058 200Q1061 196 1064 192Q1068 189 1070 186Q1074 183 1075 182H1077Q1087 188 1092 193Q1097 198 1097 203Q1097 208 1092 213Q1086 219 1076 227ZM261 51 259 50Q260 44 264 40Q268 35 273 32Q278 29 280 28Q289 22 298 18Q306 13 315 8Q317 7 318 6Q320 6 320 5L322 6Q320 12 318 16Q314 20 309 23L274 42Q268 45 265 47Q262 49 261 51ZM1048 332 1047 330Q1048 325 1052 320Q1056 316 1060 313Q1065 310 1068 308Q1077 303 1086 298Q1094 294 1102 289Q1104 288 1106 287Q1107 286 1108 286L1110 287Q1108 292 1105 296Q1102 300 1096 304L1062 322Q1056 326 1053 328Q1050 330 1048 332ZM864 394 862 392Q863 387 867 382Q871 378 876 375Q881 372 884 370Q892 365 901 360Q910 356 918 351Q920 350 921 349Q923 348 924 348L926 349Q924 354 921 358Q918 362 912 366L877 384Q871 388 868 390Q866 392 864 394ZM280 347Q276 343 272 340Q269 336 266 334Q262 330 259 328V326Q260 324 263 320Q266 316 270 312Q273 309 276 306Q279 303 280 302H283Q292 308 297 313Q302 318 302 323Q302 328 297 333Q292 339 282 347ZM654 194 649 192Q650 186 651 175Q653 163 653 145L656 83Q656 72 657 63Q657 55 659 47Q661 38 665 28Q670 17 676 2L682 4Q680 8 678 21Q677 34 676 54L672 124Q670 140 666 158Q662 175 654 194ZM394 194 388 192Q390 186 391 175Q392 163 393 145L395 83Q396 72 396 63Q397 55 399 47Q401 38 405 28Q409 17 416 2L421 4Q419 8 418 21Q416 34 415 54L411 124Q410 140 406 158Q402 175 394 194ZM94 361Q90 357 87 354Q83 350 80 348Q76 344 73 342V340Q74 338 78 334Q80 330 84 326Q87 322 90 320Q93 317 95 316H97Q103 320 108 323Q112 326 114 330Q118 324 124 318Q130 312 132 311H134Q144 318 149 322Q154 327 154 332Q154 337 148 343Q144 349 134 356H131Q127 352 123 348Q119 344 115 342Q112 350 96 361ZM520 61Q515 61 513 58Q510 55 510 50Q510 44 513 40L516 40V41Q517 45 518 47Q520 48 523 48Q528 48 531 44Q534 41 536 31L540 30Q542 35 548 35Q553 35 555 31Q557 27 558 18L562 18V20Q562 26 561 33Q559 39 555 43Q550 48 543 48Q539 48 537 46Q534 54 529 57Q525 61 520 61ZM652 250 648 245Q657 236 668 225Q679 214 689 202Q700 191 708 182Q716 173 720 168L724 170Q724 172 723 174Q723 176 723 178Q723 189 729 194Q735 199 742 199Q754 199 763 190Q771 180 776 162L782 162Q782 164 782 165Q782 166 782 168Q782 179 786 185Q791 191 800 191Q811 191 816 185Q821 179 822 172Q822 167 822 162Q822 157 822 152Q822 140 826 128Q830 116 837 103L842 105Q841 110 840 116Q839 122 839 130Q838 145 837 158Q836 170 833 181Q830 192 825 203Q822 208 817 215Q812 222 805 226Q798 230 789 230Q782 230 776 228Q770 225 767 220Q765 223 760 228Q756 232 749 236Q742 239 732 239Q721 239 714 235Q707 231 704 225Q700 219 699 213Q672 236 652 250ZM874 192 868 191Q870 185 871 173Q872 162 873 144L875 81Q876 70 876 62Q877 54 879 45Q881 37 885 26Q889 16 896 0L901 2Q899 7 898 20Q896 32 895 52L891 123Q890 139 886 156Q882 174 874 192ZM758 122Q754 122 752 120Q749 117 749 112Q749 106 752 102L755 101V102Q756 106 757 108Q759 110 762 110Q766 110 770 106Q772 102 775 93L779 92Q781 96 787 96Q792 96 794 92Q796 88 797 80L801 79V82Q801 88 800 94Q798 100 794 105Q789 109 782 109Q778 109 776 107Q772 115 768 119Q764 122 758 122ZM776 75 773 74Q774 70 775 62Q775 54 776 40Q776 34 777 30Q778 25 780 21Q782 16 785 10L788 12Q787 13 786 19Q786 25 785 36L785 41Q785 49 782 58Q780 67 776 75Z';
  SVG.bismillah = () => `<svg viewBox="0 0 1111 507" class="orn-bismillah" role="img" lang="ar" aria-label="بسم الله الرحمن الرحيم"><path d="${BISMILLAH_PATH}"/></svg>`;

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

  /* ---------- colour names (dress code swatches) ----------
     Picks the nearest named colour, compared in OKLab so it matches what the eye sees. */
  const COLOR_NAMES = [
    ['#ffffff', 'White', 'সাদা'], ['#f7f3ea', 'Off-white', 'অফ-হোয়াইট'], ['#efe2cc', 'Ivory', 'আইভরি'],
    ['#e9d8b4', 'Cream', 'ক্রিম'], ['#f1dcc0', 'Champagne', 'শ্যাম্পেন'], ['#d8c3a5', 'Beige', 'বেইজ'],
    ['#c8a25c', 'Gold', 'সোনালি'], ['#d4af37', 'Gold', 'সোনালি'], ['#c0c0c0', 'Silver', 'রুপালি'],
    ['#8c8c8c', 'Grey', 'ধূসর'], ['#3a3a3a', 'Charcoal', 'চারকোল'], ['#111111', 'Black', 'কালো'],
    ['#d62828', 'Red', 'লাল'], ['#b8323a', 'Red', 'লাল'], ['#8e1b24', 'Maroon', 'মেরুন'],
    ['#5c1020', 'Burgundy', 'বারগান্ডি'], ['#f6d1d6', 'Blush Pink', 'হালকা গোলাপি'], ['#ee9fb5', 'Pink', 'গোলাপি'],
    ['#e0457b', 'Rani Pink', 'রানি গোলাপি'], ['#b0185e', 'Magenta', 'ম্যাজেন্টা'], ['#f6c7a5', 'Peach', 'পিচ'],
    ['#f08070', 'Coral', 'কোরাল'], ['#f28c28', 'Orange', 'কমলা'], ['#b7410e', 'Rust', 'মরিচা রঙ'], ['#b87333', 'Copper', 'তামাটে'],
    ['#f5c518', 'Yellow', 'হলুদ'], ['#ffe81a', 'Yellow', 'হলুদ'], ['#fff3a6', 'Light Yellow', 'হালকা হলুদ'], ['#d4a017', 'Mustard', 'সরিষা হলুদ'],
    ['#8b5a2b', 'Brown', 'বাদামি'], ['#5a3a22', 'Chocolate', 'চকলেট'], ['#2e8b57', 'Green', 'সবুজ'], ['#228b22', 'Green', 'সবুজ'],
    ['#5fbf3a', 'Parrot Green', 'টিয়া সবুজ'], ['#0f5a43', 'Emerald', 'পান্না সবুজ'], ['#0b3d2e', 'Bottle Green', 'বোতল সবুজ'],
    ['#6b7a2a', 'Olive', 'জলপাই'], ['#a8dcc1', 'Mint', 'মিন্ট'], ['#9caf88', 'Sage', 'সেজ সবুজ'],
    ['#1f7a7a', 'Teal', 'টিল'], ['#40c4c4', 'Turquoise', 'ফিরোজা'], ['#87ceeb', 'Sky Blue', 'আকাশি'],
    ['#1f5fbf', 'Blue', 'নীল'], ['#2b4fa8', 'Royal Blue', 'রয়্যাল ব্লু'], ['#1d2b4f', 'Navy Blue', 'নেভি ব্লু'], ['#14206e', 'Navy Blue', 'নেভি ব্লু'],
    ['#c7b8e0', 'Lavender', 'ল্যাভেন্ডার'], ['#6a2c91', 'Purple', 'বেগুনি'], ['#4b1d52', 'Plum', 'গাঢ় বেগুনি']
  ];
  function hexToLab(hex) {
    let h = String(hex || '').trim().replace(/^#/, '');
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    if (!/^[0-9a-f]{6}/i.test(h)) return null;
    const n = parseInt(h.slice(0, 6), 16);
    const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const r = lin((n >> 16) & 255), gr = lin((n >> 8) & 255), b = lin(n & 255);
    const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * gr + 0.0514459929 * b);
    const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * gr + 0.1073969566 * b);
    const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * gr + 0.6299787005 * b);
    return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
  }
  let namedLab = null;
  function colorName(hex) {
    const lab = hexToLab(hex);
    if (!lab) return { en: '', bn: '' };
    namedLab = namedLab || COLOR_NAMES.map((c) => hexToLab(c[0]));
    let best = 0, bestD = Infinity;
    namedLab.forEach((l, i) => {
      const d = (l[0] - lab[0]) ** 2 + (l[1] - lab[1]) ** 2 + (l[2] - lab[2]) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    });
    return { en: COLOR_NAMES[best][1], bn: COLOR_NAMES[best][2] };
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
    THEMES, colorName,
    tr, esc, escBr, num, toBnDigits, firstGrapheme,
    MONTHS, WEEKDAYS, parseDate, formatDateLong, dateParts, formatTime, instant, mainEvent,
    GEO, clamp, easeInOut, openEdge, edgeAt, curtainPaths, paintCurtains, wavyFrame, SVG
  };
})(window);
