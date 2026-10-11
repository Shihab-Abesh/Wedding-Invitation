/* Wedding invitation: renders everything from content.json.
   You normally never need to touch this file. Edit your details at /admin.html */
(function () {
  'use strict';
  const S = window.Shared;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const params = new URLSearchParams(location.search);
  const PREVIEW = params.has('preview');
  const guestName = (params.get('to') || params.get('guest') || '').replace(/\s+/g, ' ').trim().slice(0, 60);
  const REDUCED = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const DEFAULT_ORDER = ['reveal', 'countdown', 'families', 'photo', 'events', 'venue', 'menu', 'dressCode', 'gifts', 'rsvp', 'closing'];

  const state = {
    content: null, lang: 'en', // the invitation is in English only
    opened: false, opening: false,
    revealed: [false, false, false], celebrated: false,
    assets: {}, firstRender: true, timer: null, observers: []
  };

  /* ---------- helpers ---------- */
  const t = (v) => S.tr(v, state.lang);
  const esc = S.esc, escBr = S.escBr;
  const asset = (p) => (p && state.assets[p]) || p || '';
  function safeUrl(u) {
    u = String(u || '').trim();
    if (!u) return '';
    if (/^(https?:|tel:|mailto:)/i.test(u)) return u;
    if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return ''; // block javascript: and friends
    return u;
  }
  const safeColor = (c) => (/^#[0-9a-f]{3,8}$/i.test(String(c || '').trim()) ? c.trim() : '#cccccc');
  function hexRgb(hex) {
    let h = safeColor(hex).slice(1);
    if (h.length === 3) h = h.split('').map((x) => x + x).join('');
    const n = parseInt(h.slice(0, 6), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, to, amt) {
    const a = hexRgb(hex), b = to === 'white' ? [255, 255, 255] : [0, 0, 0];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * amt)).join(',')})`;
  }
  function debounce(fn, ms) { let id; return function () { clearTimeout(id); id = setTimeout(fn, ms); }; }
  function coupleNames() {
    const c = state.content.couple;
    return `${t(c.name1)} ${t(c.joiner) || '&'} ${t(c.name2)}`;
  }

  /* ---------- theme ---------- */
  function applyTheme() {
    const col = Object.assign({}, S.THEMES.classic.colors, state.content.settings.colors || {});
    const root = document.documentElement.style;
    const map = { curtain: '--curtain', curtainLines: '--curtain-lines', accent: '--accent', gold: '--gold', background: '--bg', card: '--card', text: '--text', muted: '--muted', buttonText: '--btn-text' };
    Object.keys(map).forEach((k) => root.setProperty(map[k], safeColor(col[k])));
    root.setProperty('--accent-rgb', hexRgb(col.accent).join(','));
    root.setProperty('--gold-rgb', hexRgb(col.gold).join(','));
    root.setProperty('--text-rgb', hexRgb(col.text).join(','));
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', state.opened ? safeColor(col.background) : safeColor(col.curtain));
  }

  /* ---------- curtains ---------- */
  const cur = { W: 0, H: 0, p: 0, dpr: 1, canvas: null, ctx: null, cache: {} };
  function setupCurtains() {
    cur.canvas = $('#curtains');
    cur.ctx = cur.canvas.getContext('2d');
    cur.cache = {};
    sizeCurtains();
    window.addEventListener('resize', debounce(sizeCurtains, 120));
  }
  function sizeCurtains() {
    const r = $('#hero').getBoundingClientRect();
    if (!r.width || !r.height) return;
    // phones resize while scrolling (address bar); skip redraws when nothing really changed
    if (Math.abs(r.width - cur.W) < 1 && Math.abs(r.height - cur.H) < 1) return;
    cur.W = r.width; cur.H = r.height;
    cur.dpr = Math.min(2, window.devicePixelRatio || 1);
    cur.canvas.width = Math.round(cur.W * cur.dpr);
    cur.canvas.height = Math.round(cur.H * cur.dpr);
    cur.cache = {};
    drawCurtains(cur.p);
  }
  function drawCurtains(p) {
    if (!cur.ctx || !cur.W) return;
    const ctx = cur.ctx, col = state.content.settings.colors;
    ctx.setTransform(cur.dpr, 0, 0, cur.dpr, 0, 0);
    ctx.clearRect(0, 0, cur.W, cur.H);
    cur.cache = S.paintCurtains(ctx, cur.W, cur.H, p, {
      curtain: safeColor(col.curtain), curtainLines: safeColor(col.curtainLines), gold: safeColor(col.gold)
    }, cur.cache, cur.dpr);
  }
  function openCurtains(fast) {
    if (state.opened || state.opening) return;
    state.opening = true;
    document.body.classList.add('opening');
    if (!PREVIEW) playMusic();
    const dur = fast ? 1 : (REDUCED ? 900 : 2700);
    const t0 = performance.now();
    setTimeout(() => document.body.classList.add('opened'), fast ? 0 : dur * 0.33);
    function frame(now) {
      const p = Math.min(1, (now - t0) / dur);
      cur.p = p;
      drawCurtains(p);
      if (p < 1) requestAnimationFrame(frame);
      else {
        state.opening = false; state.opened = true;
        document.body.classList.remove('locked', 'opening');
        document.body.classList.add('opened');
        applyTheme();
      }
    }
    requestAnimationFrame(frame);
  }
  function closeCurtains() {
    state.opened = false; state.opening = false; cur.p = 0;
    document.body.classList.remove('opened', 'opening');
    document.body.classList.add('locked');
    window.scrollTo(0, 0);
    drawCurtains(0);
    applyTheme();
  }

  /* ---------- seal + intro text ---------- */
  function sealSVG() {
    const c = state.content.couple;
    const mono = t(c.monogram).trim();
    let d = '';
    for (let k = 0; k <= 48; k++) {
      const a = (k / 48) * Math.PI * 2;
      const r = 46 + Math.sin(a * 7) * 1.3 + Math.sin(a * 13 + 1) * 1 + Math.cos(a * 5) * 0.8;
      d += (k ? 'L' : 'M') + (50 + Math.cos(a) * r).toFixed(2) + ' ' + (50 + Math.sin(a) * r).toFixed(2);
    }
    d += 'Z';
    const text = mono
      ? `<text x="50" y="59" text-anchor="middle" style="font-family:var(--script);fill:var(--gold);font-size:${mono.length > 4 ? 20 : 28}px">${esc(mono)}</text>`
      : `<text x="50" y="59" text-anchor="middle" style="font-family:var(--script);fill:var(--gold);font-size:29px">${esc(S.firstGrapheme(t(c.name1)))}<tspan dx="1" dy="-3" style="font-size:17px">&amp;</tspan><tspan dx="1" dy="3">${esc(S.firstGrapheme(t(c.name2)))}</tspan></text>`;
    return `<svg viewBox="0 0 100 100" aria-hidden="true">
      <defs><radialGradient id="sealG" cx="38%" cy="32%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".3"/><stop offset=".45" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".3"/></radialGradient></defs>
      <path d="${d}" style="fill:var(--accent)"/><path d="${d}" fill="url(#sealG)"/>
      <circle cx="50" cy="50" r="35.5" fill="none" stroke="#000" stroke-opacity=".28" stroke-width="1.6"/>
      <circle cx="50" cy="50.9" r="35.5" fill="none" stroke="#fff" stroke-opacity=".22" stroke-width="1"/>
      ${text}</svg>`;
  }
  // "Dear {name}" for personal links; empty when there is no guest name or the greeting was cleared
  const guestGreeting = () => (guestName ? t(state.content.intro.guestGreeting).replace('{name}', guestName).trim() : '');
  function renderIntro() {
    const c = state.content;
    $('#seal').innerHTML = sealSVG();
    $('#tapHint').textContent = t(c.intro.tapHint);
    const note = $('#guestNote');
    const greeting = guestGreeting(), invited = t(c.intro.youAreInvited).trim();
    if (greeting) {
      note.innerHTML = `${esc(greeting)}${invited ? `<small>${esc(invited)}</small>` : ''}`;
      note.hidden = false;
    } else { note.hidden = true; }
    $('#openBtn').setAttribute('aria-label', t(c.intro.tapHint));
  }

  /* ---------- hero ---------- */
  function renderHero() {
    const c = state.content, h = c.hero, cp = c.couple;
    const greet = guestGreeting() ? `<p class="greet" style="--d:.1s">${esc(guestGreeting())},</p>` : '';
    const bismillah = h.bismillah !== false ? `<div class="bismillah" style="--d:0s">${S.SVG.bismillah()}</div>` : '';
    $('#heroInner').innerHTML = `
      ${bismillah}
      ${greet}
      <p class="top-line" style="--d:.25s">${escBr(t(h.topLine))}</p>
      <h1 class="names" style="--d:.5s"><span class="n">${esc(t(cp.name1))}</span><span class="amp">${esc(t(cp.joiner) || '&')}</span><span class="n">${esc(t(cp.name2))}</span></h1>
      <p class="invite" style="--d:.85s">${escBr(t(h.invitation))}</p>
      <div class="scroll-hint" style="--d:1.6s">${esc(t(h.scrollHint))}</div>`;
  }

  /* ---------- keep every text inside the screen ----------
     Long names and words shrink until they fit their line, so nothing is cut off at the
     screen edge. Only text that still doesn't fit at the smallest size breaks onto a new line. */
  function shrinkToFit(el, min) {
    el.style.overflowWrap = 'normal';
    const avail = el.clientWidth;
    let fs = parseFloat(getComputedStyle(el).fontSize);
    for (let i = 0; i < 5 && avail && el.scrollWidth > avail + 1 && fs > min; i++) {
      fs = Math.max(min, fs * (avail / el.scrollWidth) * 0.98);
      el.style.fontSize = fs + 'px';
    }
    el.style.overflowWrap = '';
  }
  function fitWidth(el, min) { el.style.fontSize = ''; shrinkToFit(el, min); }
  function fitNames() {
    $$('.names .amp').forEach((el) => { el.style.fontSize = ''; });
    const b = $('.hero .bismillah');
    if (b) b.style.width = '';
    $$('.names .n').forEach((el) => {
      el.classList.remove('wrap');
      el.style.fontSize = '';
      const avail = el.clientWidth;
      if (!avail || el.scrollWidth <= avail + 1) return;
      const base = parseFloat(getComputedStyle(el).fontSize);
      const oneLine = base * (avail / el.scrollWidth);
      // a full name of several words goes onto two lines rather than becoming tiny
      if (oneLine < base * 0.6 && /\s/.test(el.textContent.trim())) {
        el.classList.add('wrap');
        let fs = Math.min(base * 0.8, oneLine * 1.9);
        el.style.fontSize = fs + 'px';
        // shrink until the name takes at most two lines (.wrap has line-height 1.1)
        while (Math.round(el.offsetHeight / (fs * 1.1)) > 2 && fs > 22) { fs = Math.max(22, fs * 0.93); el.style.fontSize = fs + 'px'; }
      }
      shrinkToFit(el, 22);
      if (el.scrollWidth > el.clientWidth + 1) el.classList.add('wrap'); // last resort: break the word
    });
    // both names at the same size, like on a printed card
    const ns = $$('.names .n');
    if (ns.some((el) => el.style.fontSize)) {
      const size = Math.min(...ns.map((el) => parseFloat(getComputedStyle(el).fontSize)));
      ns.forEach((el) => { el.style.fontSize = size + 'px'; });
    }
  }
  // the first screen has a fixed height, so shrink the names until everything fits on it
  function fitHeroHeight() {
    const inner = $('#heroInner');
    const kids = $$('#heroInner > :not(.scroll-hint)');
    if (!kids.length || !inner.clientHeight) return;
    const cs = getComputedStyle(inner), padT = parseFloat(cs.paddingTop), boxB = inner.clientHeight - parseFloat(cs.paddingBottom);
    // the content is centred, so its bottom half must also clear the "scroll" hint
    const hint = $('#heroInner > .scroll-hint');
    const avail = Math.min(boxB - padT, hint ? 2 * (hint.offsetTop - 10 - (padT + boxB) / 2) : Infinity);
    const first = kids[0], last = kids[kids.length - 1];
    const used = () => last.offsetTop + last.offsetHeight + parseFloat(getComputedStyle(last).marginBottom) - first.offsetTop + parseFloat(getComputedStyle(first).marginTop);
    for (let i = 0; i < 5; i++) {
      const u = used();
      if (u <= avail) return;
      const k = Math.max(0.6, avail / u);
      $$('.names .n, .names .amp').forEach((el) => { el.style.fontSize = Math.max(18, parseFloat(getComputedStyle(el).fontSize) * k) + 'px'; });
      const b = $('.hero .bismillah');
      if (b) b.style.width = Math.max(100, b.offsetWidth * k) + 'px';
    }
  }
  function fitSeal() {
    const tx = $('#seal text');
    if (!tx || !tx.getComputedTextLength) return;
    tx.removeAttribute('textLength'); tx.removeAttribute('lengthAdjust');
    if (tx.getComputedTextLength() > 62) { tx.setAttribute('textLength', '62'); tx.setAttribute('lengthAdjust', 'spacingAndGlyphs'); }
  }
  const FIT = [
    ['#guestNote', 16], ['.hero .greet', 12], ['.hero .top-line', 9], ['.hero .invite', 9],
    ['.script-title', 20], ['.fam-label', 14], ['.fam-name', 12], ['.event-name', 10], ['.event-venue', 12],
    ['.venue-name', 12], ['.dress-heading', 10], ['.menu-course h4', 10], ['.signature', 16], ['.hashtag', 10],
    ['.footer-note', 10], ['.swatch span', 10], ['.scratch .val', 10], ['.countdown-done', 16]
  ];
  function fitAll() {
    if (!state.content) return;
    fitNames();
    FIT.forEach(([sel, min]) => $$(sel).forEach((el) => fitWidth(el, min)));
    fitSeal();
    fitHeroHeight();
  }
  const fitAllSoon = debounce(fitAll, 150);

  /* ---------- sections ---------- */
  const SECTIONS = {
    reveal(c) {
      const r = c.reveal, ev = S.mainEvent(c);
      if (!ev) return '';
      const parts = S.dateParts(ev.date, state.lang);
      const all = state.revealed.every(Boolean);
      const circles = ['day', 'month', 'year'].map((k, i) =>
        `<div class="scratch${state.revealed[i] ? ' done' : ''}" data-i="${i}"><span class="val">${esc(parts[k])}</span>${state.revealed[i] ? '' : '<canvas aria-label="scratch"></canvas>'}</div>`).join('');
      return `<section class="block" id="s-reveal">
        ${S.SVG.rings()}
        <h2 class="script-title">${esc(t(r.title))}</h2>
        <p class="eyebrow">${esc(t(r.subtitle))}</p>
        <div class="scratch-row">${circles}</div>
        <button type="button" class="reveal-all"${all ? ' hidden' : ''}>${esc(t(r.revealAll))}</button>
        <div class="after-reveal${all ? ' show' : ''}">
          <p class="script-title">${esc(t(r.after))}</p>
          <p class="lead">${esc(S.formatDateLong(ev.date, state.lang))}${ev.time ? ' · ' + esc(S.formatTime(ev.time, state.lang)) : ''}</p>
        </div>
      </section>`;
    },
    countdown(c) {
      const k = c.countdown, ev = S.mainEvent(c);
      if (!ev) return '';
      const cell = (key, lbl) => `<div><b data-k="${key}">–</b><span>${esc(t(lbl))}</span></div>`;
      return `<section class="block" id="s-countdown">
        <h2 class="script-title">${esc(t(k.title))}</h2>
        <div class="countdown">${cell('d', k.days)}${cell('h', k.hours)}${cell('m', k.minutes)}${cell('s', k.seconds)}</div>
        <p class="countdown-done" hidden>${esc(t(k.done))}</p>
      </section>`;
    },
    families(c) {
      const f = c.families, cp = c.couple;
      return `<section class="block" id="s-families">
        <p class="eyebrow">${esc(t(f.eyebrow))}</p>
        <div class="families">
          <div><div class="fam-label">${esc(t(cp.name1))}</div><p class="fam-name">${escBr(t(f.family1))}</p></div>
          <div class="fam-amp">${esc(t(cp.joiner) || '&')}</div>
          <div><div class="fam-label">${esc(t(cp.name2))}</div><p class="fam-name">${escBr(t(f.family2))}</p></div>
        </div>
      </section>`;
    },
    photo(c) {
      const p = c.photo;
      if (!p.image) return '';
      return `<section class="block" id="s-photo">
        <h2 class="script-title">${esc(t(p.title))}</h2>
        <div class="photo-frame"><img src="${esc(safeUrl(asset(p.image)))}" alt="${esc(coupleNames())}" loading="lazy"></div>
        ${t(p.caption) ? `<p class="photo-caption">${escBr(t(p.caption))}</p>` : ''}
      </section>`;
    },
    events(c) {
      const e = c.events, items = e.items || [];
      if (!items.length) return '';
      const list = items.map((ev) => {
        const q = [S.tr(ev.venue, 'en'), S.tr(ev.address, 'en')].filter(Boolean).join(', ');
        const url = safeUrl(ev.mapLink) || (q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : '');
        return `<div class="event">
          <p class="event-name">${esc(t(ev.name))}</p>
          ${ev.date ? `<p class="event-date">${esc(S.formatDateLong(ev.date, state.lang))}</p>` : ''}
          ${ev.time ? `<p class="event-time">${esc(S.formatTime(ev.time, state.lang))}</p>` : ''}
          ${t(ev.venue) ? `<p class="event-venue">${esc(t(ev.venue))}</p>` : ''}
          ${t(ev.address) ? `<p class="event-address">${escBr(t(ev.address))}</p>` : ''}
          ${t(ev.note) ? `<p class="event-note">${escBr(t(ev.note))}</p>` : ''}
          ${url ? `<a class="link-caps" href="${esc(url)}" target="_blank" rel="noopener">${esc(t(c.labels.directions))} &rarr;</a>` : ''}
        </div>`;
      }).join('');
      return `<section class="block" id="s-events">
        <div class="frame-card${e.showIllustration !== false ? ' has-art' : ''}">
          <svg class="frame" aria-hidden="true"><path/></svg>
          ${S.SVG.bow()}
          <p class="eyebrow">${esc(t(e.eyebrow))}</p>
          <h2 class="script-title">${esc(t(e.title))}</h2>
          ${list}
          ${e.showIllustration !== false ? S.SVG.pavilion() : ''}
        </div>
      </section>`;
    },
    venue(c) {
      const v = c.venue;
      const q = v.mapSearch || [S.tr(v.name, 'en'), S.tr(v.address, 'en')].filter(Boolean).join(', ');
      const link = safeUrl(v.mapLink) || 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q);
      return `<section class="block" id="s-venue">
        <h2 class="script-title">${esc(t(v.title))}</h2>
        ${t(v.name) ? `<p class="venue-name">${esc(t(v.name))}</p>` : ''}
        ${t(v.address) ? `<p class="event-address">${escBr(t(v.address))}</p>` : ''}
        ${q ? `<div class="map-wrap"><iframe title="map" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?q=${encodeURIComponent(q)}&z=15&output=embed"></iframe></div>` : ''}
        <a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${esc(t(v.button))}</a>
      </section>`;
    },
    menu(c) {
      const m = c.menu, items = m.items || [];
      if (!items.length) return '';
      return `<section class="block" id="s-menu">
        <div class="frame-card menu-card">
          <svg class="frame" aria-hidden="true"><path/></svg>
          <p class="eyebrow">${esc(t(m.eyebrow))}</p>
          <h2 class="script-title">${esc(t(m.title))}</h2>
          ${items.map((it) => `<div class="menu-course"><h4>${esc(t(it.course))}</h4><p>${escBr(t(it.dishes))}</p></div>`).join('')}
        </div>
      </section>`;
    },
    dressCode(c) {
      const d = c.dressCode;
      // each colour is { color, name: { en } }; older files have plain "#hex" strings
      const cols = (d.colors || []).map((x) => (x && typeof x === 'object' ? x : { color: x })).filter((x) => x.color);
      const swatch = (x) => {
        const name = t(x.name).trim() || S.colorName(x.color);
        return `<div class="swatch"><i style="background:${safeColor(x.color)}"></i><span>${esc(name)}</span></div>`;
      };
      return `<section class="block" id="s-dress">
        <h2 class="script-title">${esc(t(d.title))}</h2>
        ${t(d.heading) ? `<p class="dress-heading">${esc(t(d.heading))}</p>` : ''}
        ${t(d.text) ? `<p class="lead">${escBr(t(d.text))}</p>` : ''}
        ${cols.length ? `${t(d.colorsLabel) ? `<p class="swatch-label">${esc(t(d.colorsLabel))}</p>` : ''}<div class="swatches">${cols.map(swatch).join('')}</div>` : ''}
      </section>`;
    },
    gifts(c) {
      const g = c.gifts, det = t(g.details).trim();
      return `<section class="block" id="s-gifts">
        ${S.SVG.gift()}
        <p class="eyebrow">${esc(t(g.eyebrow))}</p>
        <h2 class="script-title">${esc(t(g.title))}</h2>
        ${t(g.text) ? `<p class="lead">${escBr(t(g.text))}</p>` : ''}
        ${det ? `<button type="button" class="btn btn-ghost gift-toggle">${esc(t(g.detailsButton))}</button><div class="gift-details" hidden>${esc(det)}</div>` : ''}
      </section>`;
    },
    rsvp(c) {
      const r = c.rsvp;
      const wa = String(r.whatsapp || '').replace(/[^0-9]/g, '');
      const phone = String(r.phone || '').replace(/[^0-9+]/g, '');
      const form = safeUrl(r.formUrl);
      const max = Math.max(1, Math.min(30, parseInt(r.maxGuests, 10) || 10));
      let body = '';
      if (form) {
        body = `<a class="btn" href="${esc(form)}" target="_blank" rel="noopener">${esc(t(r.formButton))}</a>`;
      } else if (wa) {
        body = `<form class="rsvp-form" novalidate>
          <div class="field"><label for="rv-name">${esc(t(r.nameLabel))}</label><input id="rv-name" name="name" autocomplete="name" value="${esc(guestName)}" maxlength="60"></div>
          <div class="field choice" role="radiogroup">
            <label><input type="radio" name="att" value="yes" checked><span>${esc(t(r.yesLabel))}</span></label>
            <label><input type="radio" name="att" value="no"><span>${esc(t(r.noLabel))}</span></label>
          </div>
          <div class="field rv-guests"><label for="rv-guests">${esc(t(r.guestsLabel))}</label><select id="rv-guests" name="guests">${Array.from({ length: max }, (_, i) => `<option value="${i + 1}">${S.num(i + 1, state.lang)}</option>`).join('')}</select></div>
          <div class="field"><label for="rv-msg">${esc(t(r.messageLabel))}</label><textarea id="rv-msg" name="msg" rows="2" maxlength="400"></textarea></div>
          <p class="form-msg" aria-live="polite"></p>
          <button class="btn" type="submit"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.8 11.9 11.9 0 0 0 4.6 4c1.7.7 2.3.8 3.2.7.5-.1 1.5-.6 1.7-1.2.2-.6.2-1.1.2-1.2-.1-.1-.3-.2-.5-.3Z"/></svg>${esc(t(r.button))}</button>
        </form>`;
      }
      if (phone) body += `<div class="btn-row"><a class="btn btn-ghost" href="tel:${esc(phone)}">${esc(t(r.callButton))}</a></div>`;
      return `<section class="block" id="s-rsvp">
        <h2 class="script-title">${esc(t(r.title))}</h2>
        ${t(r.text) ? `<p class="lead">${escBr(t(r.text))}</p>` : ''}
        ${body}
      </section>`;
    },
    closing(c) {
      const k = c.closing, ev = S.mainEvent(c);
      let cal = '';
      const start = ev && S.instant(ev.date, ev.time, c.settings.timezone);
      if (start) {
        const end = new Date(start.getTime() + 4 * 3600 * 1000);
        const f = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
        const loc = [S.tr(ev.venue, 'en'), S.tr(ev.address, 'en')].filter(Boolean).join(', ');
        const url = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
          '&text=' + encodeURIComponent(`${S.tr(ev.name, 'en')}: ${S.tr(c.couple.name1, 'en')} & ${S.tr(c.couple.name2, 'en')}`) +
          '&dates=' + f(start) + '/' + f(end) + '&location=' + encodeURIComponent(loc) +
          '&details=' + encodeURIComponent(location.href.split('?')[0]);
        cal = `<a class="btn btn-ghost" href="${esc(url)}" target="_blank" rel="noopener">${esc(t(k.calendarButton))}</a>`;
      }
      return `<section class="block" id="s-closing">
        ${S.SVG.rings()}
        <h2 class="script-title">${esc(t(k.title))}</h2>
        ${t(k.text) ? `<p class="lead">${escBr(t(k.text))}</p>` : ''}
        <p class="signature"><small>${esc(t(k.signature))}</small>${esc(coupleNames())}</p>
        ${k.hashtag ? `<p class="hashtag">${esc(k.hashtag)}</p>` : ''}
        ${cal}
      </section>`;
    }
  };

  function renderCustom(it) {
    const link = safeUrl(it.buttonLink);
    return `<section class="block" id="s-custom-${esc(it.id)}">
      ${it.image ? `<div class="photo-frame" style="margin-top:0;margin-bottom:22px"><img src="${esc(safeUrl(asset(it.image)))}" alt="" loading="lazy"></div>` : ''}
      ${t(it.eyebrow) ? `<p class="eyebrow">${esc(t(it.eyebrow))}</p>` : ''}
      ${t(it.title) ? `<h2 class="script-title">${esc(t(it.title))}</h2>` : ''}
      ${t(it.heading) ? `<p class="dress-heading">${esc(t(it.heading))}</p>` : ''}
      ${t(it.text) ? `<p class="lead">${escBr(t(it.text))}</p>` : ''}
      ${link && t(it.buttonText) ? `<a class="btn" href="${esc(link)}" target="_blank" rel="noopener">${esc(t(it.buttonText))}</a>` : ''}
    </section>`;
  }

  function sectionOrder(c) {
    const order = (Array.isArray(c.settings.sectionOrder) ? c.settings.sectionOrder : DEFAULT_ORDER).slice();
    DEFAULT_ORDER.forEach((k) => { if (!order.includes(k)) order.push(k); });
    const customs = (c.custom && Array.isArray(c.custom.items)) ? c.custom.items : [];
    customs.forEach((it) => {
      const key = 'custom:' + it.id;
      if (!order.includes(key)) { const ci = order.indexOf('closing'); order.splice(ci < 0 ? order.length : ci, 0, key); }
    });
    return order.filter((k, i) => order.indexOf(k) === i);
  }

  function renderMain() {
    const c = state.content;
    const order = sectionOrder(c);
    const customs = (c.custom && Array.isArray(c.custom.items)) ? c.custom.items : [];
    const parts = [];
    order.forEach((k) => {
      if (k.indexOf('custom:') === 0) {
        const it = customs.find((x) => 'custom:' + x.id === k);
        if (it && it.show !== false) parts.push(renderCustom(it));
        return;
      }
      if (!SECTIONS[k] || !c[k] || c[k].show === false) return;
      const html = SECTIONS[k](c);
      if (html) parts.push(html);
    });
    const divider = `<div class="divider" aria-hidden="true">${S.SVG.flourish()}</div>`;
    const ev = S.mainEvent(c);
    const year = ev && S.parseDate(ev.date) ? S.num(S.parseDate(ev.date).y, state.lang) : '';
    $('#app').innerHTML = parts.join(divider) +
      `<footer class="footer-note">${esc(coupleNames())}${year ? ' · ' + year : ''}</footer>`;
    afterRender();
  }

  /* ---------- behaviour after each render ---------- */
  function afterRender() {
    // wavy frames
    $$('.frame-card').forEach((card) => {
      const draw = () => {
        const w = card.clientWidth, h = card.clientHeight;
        const svg = $('svg.frame', card);
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
        const isMenu = card.classList.contains('menu-card');
        $('path', svg).setAttribute('d', S.wavyFrame(w, h, isMenu ? { inset: 4, radius: 56, amp: 2.4, wave: 22 } : { inset: 4, radius: 28 }));
      };
      draw();
      if (window.ResizeObserver) { const ro = new ResizeObserver(draw); ro.observe(card); state.observers.push(ro); }
    });
    // scratch cards
    $$('.scratch').forEach((el) => initScratch(el, +el.dataset.i));
    const ra = $('.reveal-all');
    if (ra) ra.addEventListener('click', () => [0, 1, 2].forEach((i) => setTimeout(() => completeScratch(i), i * 260)));
    // countdown
    startCountdown();
    // gifts
    const gt = $('.gift-toggle');
    if (gt) gt.addEventListener('click', () => { const d = $('.gift-details'); d.hidden = !d.hidden; });
    // rsvp
    const form = $('.rsvp-form');
    if (form) setupRsvp(form);
    // entrance animations
    $$('#app .block').forEach((b) => b.classList.add('fade-up'));
    if (state.firstRender && 'IntersectionObserver' in window && !REDUCED) {
      const io = new IntersectionObserver((entries) => entries.forEach((en) => { if (en.isIntersecting) { en.target.classList.add('in'); io.unobserve(en.target); } }), { threshold: 0.12, rootMargin: '0px 0px -5% 0px' });
      $$('#app .block').forEach((b) => io.observe(b));
      state.observers.push(io);
    } else {
      $$('#app .block').forEach((b) => b.classList.add('in'));
    }
    state.firstRender = false;
  }

  /* ---------- scratch to reveal ---------- */
  function paintFoil(ctx, s, dpr) {
    const gold = state.content.settings.colors.gold;
    const r = s / 2;
    ctx.save();
    ctx.beginPath(); ctx.arc(r, r, r - 0.5, 0, Math.PI * 2); ctx.clip();
    const g = ctx.createRadialGradient(r * 0.72, r * 0.62, r * 0.08, r, r, r);
    g.addColorStop(0, mix(gold, 'white', 0.55));
    g.addColorStop(0.5, safeColor(gold));
    g.addColorStop(1, mix(gold, 'black', 0.28));
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    for (let rr = 2; rr < r; rr += 1.7 * dpr) {
      ctx.strokeStyle = `rgba(255,255,255,${(0.04 + 0.09 * Math.abs(Math.sin(rr * 0.45))).toFixed(3)})`;
      ctx.lineWidth = 0.8 * dpr;
      ctx.beginPath(); ctx.arc(r, r, rr, 0, Math.PI * 2); ctx.stroke();
    }
    if (ctx.createConicGradient) {
      const cg = ctx.createConicGradient(-0.7, r, r);
      [[0, 0], [0.1, 0.42], [0.22, 0], [0.5, 0], [0.6, 0.32], [0.72, 0], [1, 0]].forEach(([o, a]) => cg.addColorStop(o, `rgba(255,255,255,${a})`));
      ctx.fillStyle = cg; ctx.fillRect(0, 0, s, s);
    }
    ctx.strokeStyle = 'rgba(0,0,0,.2)'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(r, r, r - dpr, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  function initScratch(el, i) {
    const cv = $('canvas', el);
    if (!cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const size = Math.max(40, el.clientWidth);
    cv.width = cv.height = Math.round(size * dpr);
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    paintFoil(ctx, cv.width, dpr);
    const total = countOpaque(ctx, cv.width);
    let drawing = false, last = null, lastCheck = 0;
    const pos = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * cv.width, (e.clientY - r.top) / r.height * cv.height]; };
    const stroke = (a, b) => {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.lineWidth = cv.width * 0.22; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0] + 0.01, b[1]); ctx.stroke();
    };
    const check = () => {
      if (state.revealed[i]) return;
      const left = countOpaque(ctx, cv.width);
      if (total && (1 - left / total) > 0.48) completeScratch(i);
    };
    cv.addEventListener('pointerdown', (e) => { drawing = true; try { cv.setPointerCapture(e.pointerId); } catch (x) { /* ignore */ } last = pos(e); stroke(last, last); e.preventDefault(); });
    cv.addEventListener('pointermove', (e) => {
      if (!drawing) return;
      const p = pos(e); stroke(last, p); last = p;
      const now = performance.now();
      if (now - lastCheck > 140) { lastCheck = now; check(); }
    });
    ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((n) => cv.addEventListener(n, () => { if (drawing) { drawing = false; check(); } }));
  }
  function countOpaque(ctx, s) {
    const data = ctx.getImageData(0, 0, s, s).data;
    let n = 0;
    for (let k = 3; k < data.length; k += 4 * 7) if (data[k] > 90) n++;
    return n;
  }
  function completeScratch(i) {
    if (state.revealed[i]) return;
    state.revealed[i] = true;
    const el = $(`.scratch[data-i="${i}"]`);
    if (el) {
      el.classList.add('done');
      const cv = $('canvas', el);
      if (cv) setTimeout(() => cv.remove(), 800);
    }
    if (navigator.vibrate) { try { navigator.vibrate(18); } catch (e) { /* ignore */ } }
    if (state.revealed.every(Boolean)) {
      const ra = $('.reveal-all'); if (ra) ra.hidden = true;
      const ar = $('.after-reveal'); if (ar) ar.classList.add('show');
      if (!state.celebrated) {
        state.celebrated = true;
        const row = $('.scratch-row');
        const r = row ? row.getBoundingClientRect() : { left: innerWidth / 2, width: 0, top: innerHeight / 2, height: 0 };
        confetti(r.left + r.width / 2, r.top + r.height / 2);
      }
    }
  }

  /* ---------- confetti ---------- */
  function confetti(x, y) {
    if (REDUCED) return;
    const cv = $('#confetti'), ctx = cv.getContext('2d');
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = innerWidth, H = innerHeight;
    cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const col = state.content.settings.colors;
    const colors = [safeColor(col.accent), safeColor(col.curtain), safeColor(col.gold), mix(col.gold, 'white', 0.35), mix(col.accent, 'black', 0.25)];
    const pick = () => colors[Math.floor(Math.random() * colors.length)];
    const P = [];
    for (let k = 0; k < 130; k++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.1, sp = 6 + Math.random() * 11;
      P.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, w: 3 + Math.random() * 4, h: 7 + Math.random() * 8, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.35, t: Math.random() * 6.3, vt: 0.08 + Math.random() * 0.12, c: pick() });
    }
    for (let k = 0; k < 90; k++) {
      P.push({ x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 2, vy: 1 + Math.random() * 2.5, w: 3 + Math.random() * 4, h: 7 + Math.random() * 8, r: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.25, t: Math.random() * 6.3, vt: 0.06 + Math.random() * 0.1, c: pick() });
    }
    const t0 = performance.now();
    (function loop(now) {
      ctx.clearRect(0, 0, W, H);
      let alive = 0;
      P.forEach((p) => {
        p.vy += 0.22; p.vx *= 0.985; p.vy *= 0.985; p.vy = Math.min(p.vy, 4.2);
        p.x += p.vx + Math.sin(p.t) * 0.6; p.y += p.vy; p.r += p.vr; p.t += p.vt;
        if (p.y < H + 30) alive++;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r); ctx.scale(1, Math.cos(p.t));
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (alive && now - t0 < 9000) requestAnimationFrame(loop);
      else ctx.clearRect(0, 0, W, H);
    })(t0);
  }

  /* ---------- countdown ---------- */
  function startCountdown() {
    clearInterval(state.timer);
    const box = $('.countdown');
    if (!box) return;
    const ev = S.mainEvent(state.content);
    const target = ev && S.instant(ev.date, ev.time, state.content.settings.timezone);
    const tick = () => {
      if (!target) return;
      let ms = target - Date.now();
      if (ms <= 0) { box.hidden = true; const d = $('.countdown-done'); if (d) d.hidden = false; clearInterval(state.timer); return; }
      const d = Math.floor(ms / 864e5); ms -= d * 864e5;
      const h = Math.floor(ms / 36e5); ms -= h * 36e5;
      const m = Math.floor(ms / 6e4); ms -= m * 6e4;
      const s = Math.floor(ms / 1e3);
      const set = (k, v) => { const el = $(`[data-k="${k}"]`, box); if (el) el.textContent = S.num(k === 'd' ? v : String(v).padStart(2, '0'), state.lang); };
      set('d', d); set('h', h); set('m', m); set('s', s);
    };
    tick();
    state.timer = setInterval(tick, 1000);
  }

  /* ---------- RSVP via WhatsApp ---------- */
  function setupRsvp(form) {
    const r = state.content.rsvp;
    const guestsField = $('.rv-guests', form);
    form.addEventListener('change', () => { guestsField.style.display = form.att.value === 'no' ? 'none' : ''; });
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      const msgEl = $('.form-msg', form);
      if (!name) { msgEl.textContent = t(r.nameMissing); form.name.focus(); return; }
      msgEl.textContent = '';
      const yes = form.att.value !== 'no';
      const text = t(r.messageTemplate)
        .replace('{name}', name)
        .replace('{status}', yes ? t(r.yesWord) : t(r.noWord))
        .replace('{couple}', coupleNames())
        .replace('{guests}', yes ? S.num(form.guests.value, state.lang) : S.num(0, state.lang))
        .replace('{message}', form.msg.value.trim())
        .trim();
      const url = 'https://wa.me/' + String(r.whatsapp).replace(/[^0-9]/g, '') + '?text=' + encodeURIComponent(text);
      const w = window.open(url, '_blank');
      if (!w) location.href = url;
    });
  }

  /* ---------- music ---------- */
  const audio = document.getElementById('bgm');
  const musicBtn = document.getElementById('musicBtn');
  let wantMusic = false;
  function setupMusic() {
    const m = state.content.settings.music || {};
    if (!m.enabled || !m.src) { musicBtn.hidden = true; audio.pause(); return; }
    const src = asset(m.src);
    if (audio.dataset.src !== src) { audio.src = src; audio.dataset.src = src; }
    audio.volume = Math.max(0, Math.min(1, m.volume == null ? 0.6 : +m.volume));
    musicBtn.hidden = false;
    updateMusicBtn();
  }
  function updateMusicBtn() {
    const on = !audio.paused;
    musicBtn.innerHTML = S.SVG.music(on);
    musicBtn.classList.toggle('playing', on);
    musicBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  function playMusic() {
    const m = state.content.settings.music || {};
    if (!m.enabled || !m.src) return;
    wantMusic = true;
    const p = audio.play();
    if (p && p.catch) p.catch(() => { wantMusic = false; updateMusicBtn(); });
  }
  musicBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (audio.paused) playMusic(); else { wantMusic = false; audio.pause(); }
  });
  audio.addEventListener('play', updateMusicBtn);
  audio.addEventListener('pause', updateMusicBtn);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { if (!audio.paused) audio.pause(); }
    else if (wantMusic && state.opened) audio.play().catch(() => {});
  });

  /* ---------- top level ---------- */
  function renderAll() {
    const c = state.content;
    document.title = (c.share && c.share.title) || `${S.tr(c.couple.name1, 'en')} & ${S.tr(c.couple.name2, 'en')} are getting married`;
    applyTheme();
    drawCurtains(cur.p);
    renderIntro();
    renderHero();
    renderMain();
    setupMusic();
    fitAll();
  }

  function normalise(c) {
    c.settings = c.settings || {};
    c.settings.colors = Object.assign({}, S.THEMES.classic.colors, c.settings.colors || {});
    ['couple', 'intro', 'hero', 'labels'].forEach((k) => { c[k] = c[k] || {}; });
    return c;
  }

  function start(content) {
    state.content = normalise(content);
    setupCurtains();
    renderAll();
    $('#openBtn').addEventListener('click', () => openCurtains(false));
    window.addEventListener('resize', fitAllSoon);
    if (document.fonts) {
      if (document.fonts.ready) document.fonts.ready.then(fitAll);
      // a font that finishes loading late changes every width
      if (document.fonts.addEventListener) document.fonts.addEventListener('loadingdone', fitAllSoon);
    }
    if (PREVIEW) setTimeout(() => openCurtains(false), 700);
    if (params.has('open')) openCurtains(true);
  }

  // live preview from the editor
  if (PREVIEW) {
    window.addEventListener('message', (e) => {
      if (e.origin !== location.origin) return;
      const m = e.data || {};
      if (m.type === 'content' && m.content) {
        state.assets = m.assets || {};
        const first = !state.content;
        state.content = normalise(m.content);
        if (first) start(state.content); else renderAll();
      } else if (m.type === 'replay') {
        closeCurtains();
        state.revealed = [false, false, false]; state.celebrated = false;
        renderAll();
        setTimeout(() => openCurtains(false), 600);
      }
    });
  }

  function fail() {
    $('#app').innerHTML = '<p style="padding:3rem 1.5rem;text-align:center">Sorry, the invitation could not load. Please refresh the page.</p>';
    document.body.classList.remove('locked');
  }

  fetch('content.json?v=' + Date.now(), { cache: 'no-store' })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.json(); })
    .then((c) => { if (!state.content) start(c); })
    .catch(() => { if (window.__CONTENT__) start(window.__CONTENT__); else if (!PREVIEW) fail(); });
  if (PREVIEW && window.parent !== window) window.parent.postMessage({ type: 'ready' }, location.origin);
})();
