/* Invitation editor. Everything you change here is saved to content.json in your
   GitHub repository when you press Publish. Nothing else needs a code change. */
(function () {
  'use strict';
  const S = window.Shared;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  const LS = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };

  const st = {
    content: null,
    base: '',
    dirty: false,
    pending: {},       // files waiting to be uploaded: path -> { blob }
    previewAssets: {}, // path -> blob: URL so the preview can show files before GitHub has them
    gh: Object.assign({ owner: '', repo: '', branch: 'main', token: '' }, LS.get('inv-gh', {})),
    showBn: LS.get('inv-showbn', true),
    pvLang: 'en',
    pvReady: false,
    publishing: false
  };

  /* ---------- tiny helpers ---------- */
  function h(tag, attrs) {
    const e = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v == null || v === false) return;
        if (k === 'class') e.className = v;
        else if (k === 'html') e.innerHTML = v;
        else if (k === 'value') e.value = v;
        else if (k === 'checked') e.checked = !!v;
        else if (k.slice(0, 2) === 'on' && typeof v === 'function') e.addEventListener(k.slice(2), v);
        else e.setAttribute(k, v === true ? '' : v);
      });
    }
    for (let i = 2; i < arguments.length; i++) append(e, arguments[i]);
    return e;
  }
  function append(e) {
    for (let i = 1; i < arguments.length; i++) {
      const c = arguments[i];
      if (c == null || c === false) continue;
      if (Array.isArray(c)) { c.forEach((x) => append(e, x)); continue; }
      e.append(c.nodeType ? c : document.createTextNode(String(c)));
    }
  }
  function getPath(o, p) { return p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o); }
  function setPath(o, p, v) {
    const ks = p.split('.');
    let a = o;
    for (let i = 0; i < ks.length - 1; i++) {
      if (a[ks[i]] == null || typeof a[ks[i]] !== 'object') a[ks[i]] = /^\d+$/.test(ks[i + 1]) ? [] : {};
      a = a[ks[i]];
    }
    a[ks[ks.length - 1]] = v;
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  function debounce(fn, ms) { let id; return function () { const a = arguments; clearTimeout(id); id = setTimeout(() => fn.apply(null, a), ms); }; }
  const enText = (v) => S.tr(v, 'en');

  let toastTimer;
  function toast(msg, isErr, ms) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), ms || (isErr ? 5200 : 2600));
  }
  function modal(content) {
    const m = $('#modal'), card = $('#modalCard');
    card.innerHTML = '';
    if (content) { append(card, content); m.hidden = false; } else m.hidden = true;
    return card;
  }
  $('#modal').addEventListener('click', (e) => { if (e.target.id === 'modal' && !st.publishing) modal(null); });

  /* ---------- GitHub ---------- */
  (function detectRepo() {
    const m = /^([a-z0-9-]+)\.github\.io$/i.exec(location.hostname);
    if (!m) return;
    const seg = location.pathname.split('/').filter(Boolean)[0];
    if (!st.gh.owner) st.gh.owner = m[1];
    if (!st.gh.repo) st.gh.repo = seg && !/\.html$/i.test(seg) ? seg : `${m[1]}.github.io`;
  })();
  const connected = () => !!(st.gh.owner && st.gh.repo && st.gh.token);

  async function gh(path, opts) {
    opts = opts || {};
    const g = st.gh;
    const url = opts.root ? `https://api.github.com${path}` : `https://api.github.com/repos/${encodeURIComponent(g.owner)}/${encodeURIComponent(g.repo)}${path}`;
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${g.token.trim()}`, 'X-GitHub-Api-Version': '2022-11-28' };
    if (opts.body) headers['Content-Type'] = 'application/json';
    const r = await fetch(url, { method: opts.method || 'GET', headers, body: opts.body ? JSON.stringify(opts.body) : undefined, cache: 'no-store' });
    if (!r.ok) {
      let msg = '';
      try { msg = (await r.json()).message || ''; } catch (e) { /* ignore */ }
      const err = new Error(msg || r.statusText);
      err.status = r.status;
      throw err;
    }
    return r.status === 204 ? null : r.json();
  }
  function friendlyError(e) {
    if (!navigator.onLine) return 'You seem to be offline. Check your internet and try again.';
    if (e.status === 401) return 'GitHub did not accept the token. It may be wrong or expired. Make a new one in Setup.';
    if (e.status === 429 || /rate limit/i.test(e.message)) return 'GitHub is limiting requests for a few minutes. Please wait a little and try again.';
    if (e.status === 403 && /archived/i.test(e.message)) return 'This repository is archived, so it is read-only. Unarchive it on GitHub (repository Settings, at the bottom) and try again.';
    if (e.status === 403) return 'The token is not allowed to change this repository. Open Setup and press "Save & check" to see exactly what to fix.';
    if (e.status === 404) return 'Repository not found. Check the username and repository name in Setup, and that the token can access that repository.';
    if (e.status === 409 || e.status === 422) return 'GitHub was busy with another change. Please press Publish again.';
    return 'Something went wrong: ' + (e.message || e);
  }
  /* GitHub only answers "403" when a token can't publish. This finds out which setting is
     wrong so Setup can say exactly what to change. */
  const lower = (s) => String(s || '').toLowerCase();
  const classicTokenUrl = (priv) => `https://github.com/settings/tokens/new?scopes=${priv ? 'repo' : 'public_repo'}&description=${encodeURIComponent('Wedding invitation editor')}`;
  async function checkAccess() {
    let me = null;
    try { me = await gh('/user', { root: true }); } catch (e) { if (e.status === 401) throw e; }
    let info;
    try { info = await gh(''); } catch (e) {
      if (e.status === 404 && me && lower(me.login) !== lower(st.gh.owner)) e.problem = { kind: 'account', me: me.login };
      throw e;
    }
    // a real write test: makes an unused blob (no commit, nothing visible) exactly like Publish does
    try {
      await gh('/git/blobs', { method: 'POST', body: { content: 'Wedding editor access check', encoding: 'utf-8' } });
    } catch (e) {
      if ((e.status === 403 || e.status === 404) && !/rate limit|archived/i.test(e.message)) {
        e.status = 403;
        e.problem = me && lower(me.login) !== lower(info.owner.login)
          ? { kind: 'account', me: me.login }
          : { kind: /^github_pat_/.test(st.gh.token.trim()) ? 'fine' : 'classic', priv: info.private };
      }
      throw e;
    }
    return info;
  }
  function accessHelp(p) {
    const owner = S.esc(st.gh.owner), repo = S.esc(st.gh.repo);
    const oneClick = h('div', { class: 'btns', style: 'margin-top:10px' },
      h('a', { class: 'btn primary sm', href: classicTokenUrl(p.priv), target: '_blank', rel: 'noopener' }, 'Make a new token (1 click)'));
    if (p.kind === 'account') {
      return h('div', { class: 'problem' },
        h('b', null, 'This token belongs to a different GitHub account.'),
        h('p', { html: `It was made by <b>@${S.esc(p.me)}</b>, but the repository belongs to <b>@${owner}</b>, so it can't change it. On GitHub, sign out, sign in as <b>@${owner}</b>, make the token there and paste it above.` }));
    }
    if (p.kind === 'classic') {
      return h('div', { class: 'problem' },
        h('b', null, 'This token is missing the "repo" permission.'),
        h('p', null, 'Make a new one with the button below. The right box is already ticked: choose an expiry date after the wedding, press Generate token at the bottom, copy the token and paste it above.'),
        oneClick);
    }
    return h('div', { class: 'problem' },
      h('b', null, 'This token can read the repository but is not allowed to change it.'),
      h('p', null, 'Fix it on GitHub. The token text stays the same, so you don\'t need to paste it again:'),
      h('ol', { class: 'steps' },
        h('li', { html: 'Open <a href="https://github.com/settings/personal-access-tokens" target="_blank" rel="noopener">github.com/settings/personal-access-tokens</a>, tap your token, then tap <b>Edit</b>.' }),
        h('li', { html: `<b>Repository access:</b> choose <i>Only select repositories</i> and pick <b>${repo}</b>. The <i>Public repositories</i> option can only read.` }),
        h('li', { html: '<b>Permissions:</b> find <b>Contents</b> (tap <i>Add permissions</i> if it isn\'t listed) and change <i>Read-only</i> to <b>Read and write</b>.' }),
        h('li', { html: 'Tap <b>Update</b>, come back here and press <b>Save &amp; check</b> again.' })),
      h('p', null, 'Or skip all that and make a simple token instead: the right box is already ticked, just pick an expiry date and press Generate token.'),
      oneClick);
  }

  function b64ToUtf8(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8').decode(bytes);
  }
  function blobToB64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',')[1]);
      fr.onerror = rej;
      fr.readAsDataURL(blob);
    });
  }
  function siteUrl() {
    const custom = st.content && st.content.share && String(st.content.share.siteUrl || '').trim();
    if (custom) return custom.replace(/\/?$/, '/');
    if (/\.github\.io$/i.test(location.hostname) || location.protocol === 'https:') {
      return location.origin + location.pathname.replace(/admin\.html$/i, '').replace(/[^/]*$/, '');
    }
    const g = st.gh;
    if (g.owner && g.repo) return g.repo.toLowerCase() === `${g.owner.toLowerCase()}.github.io` ? `https://${g.repo}/` : `https://${g.owner}.github.io/${g.repo}/`;
    return location.href.replace(/admin\.html.*$/i, '');
  }

  /* ---------- status ---------- */
  function updateStatus(text, kind) {
    const s = $('#status');
    s.className = 'status';
    let t = text;
    if (!t) {
      if (st.publishing) { t = 'Publishing…'; kind = 'busy'; }
      else if (st.dirty) { t = 'Unpublished changes'; kind = 'warn'; }
      else if (!connected()) { t = 'Not connected to GitHub'; }
      else { t = 'Everything is published'; kind = 'ok'; }
    }
    if (kind) s.classList.add(kind);
    $('span', s).textContent = t;
    $('#liveLink').href = siteUrl();
  }

  /* ---------- change tracking ---------- */
  const saveDraft = debounce(() => {
    if (st.dirty) LS.set('inv-draft', { at: Date.now(), content: st.content });
  }, 400);
  function changed() {
    st.dirty = JSON.stringify(st.content) !== st.base;
    updateStatus();
    saveDraft();
    if (!st.dirty) LS.del('inv-draft');
    sendPreviewSoon();
    if (shareCanvasOpen()) drawSharePreviewSoon();
  }
  window.addEventListener('beforeunload', (e) => {
    if (st.dirty || Object.keys(st.pending).length) { e.preventDefault(); e.returnValue = ''; }
  });

  /* ---------- preview ---------- */
  const pv = $('#pv');
  function sendPreview() {
    if (!st.content || !pv.contentWindow) return;
    pv.contentWindow.postMessage({ type: 'content', content: clone(st.content), assets: st.previewAssets, lang: st.pvLang }, location.origin);
  }
  const sendPreviewSoon = debounce(sendPreview, 180);
  window.addEventListener('message', (e) => {
    if (e.origin !== location.origin || !e.data) return;
    if (e.data.type === 'ready') { st.pvReady = true; sendPreview(); }
  });
  pv.addEventListener('load', () => setTimeout(sendPreview, 50));
  $$('#pvLang button').forEach((b) => b.addEventListener('click', () => {
    st.pvLang = b.dataset.lang;
    $$('#pvLang button').forEach((x) => x.classList.toggle('on', x === b));
    if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'lang', lang: st.pvLang }, location.origin);
  }));
  $('#replayBtn').addEventListener('click', () => { if (pv.contentWindow) pv.contentWindow.postMessage({ type: 'replay' }, location.origin); });

  /* ---------- tabs ---------- */
  function setTab(tab, checkNow) {
    $('#layout').dataset.tab = tab;
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'guests') renderGuests();
    if (tab === 'setup') renderSetup(checkNow === true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  $$('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  /* ---------- fields ---------- */
  function wrap(f, control) {
    return h('div', { class: 'f' },
      f.label ? h('span', { class: 'f-label' }, f.label) : null,
      control,
      f.help ? h('p', { class: 'f-help', html: f.help }) : null);
  }

  function fI18n(f, path) {
    const long = f.t === 'i18nLong';
    const mk = (lang) => {
      const cur = getPath(st.content, path);
      const val = cur && typeof cur === 'object' ? (cur[lang] || '') : (lang === 'en' ? (cur || '') : '');
      const props = {
        class: 'in', value: val, lang, dir: 'auto', spellcheck: lang === 'en' ? 'true' : 'false',
        placeholder: lang === 'bn' ? 'বাংলায় লিখুন (ঐচ্ছিক)' : (f.ph || ''),
        oninput: (e) => {
          let o = getPath(st.content, path);
          if (!o || typeof o !== 'object') { o = { en: typeof o === 'string' ? o : '', bn: '' }; setPath(st.content, path, o); }
          o[lang] = e.target.value;
          changed();
          if (f.onChange) f.onChange();
        }
      };
      return long ? h('textarea', Object.assign(props, { rows: f.rows || 3 })) : h('input', Object.assign(props, { type: 'text' }));
    };
    return wrap(f, h('div', { class: 'pair' },
      h('label', { class: 'lang' }, h('span', { class: 'tag' }, 'EN'), mk('en')),
      h('label', { class: 'lang bn' }, h('span', { class: 'tag' }, 'বাং'), mk('bn'))));
  }

  function fInput(f, path) {
    const type = { text: 'text', url: 'url', tel: 'tel', number: 'number', date: 'date', time: 'time' }[f.t] || 'text';
    const cur = getPath(st.content, path);
    const el = f.t === 'textarea'
      ? h('textarea', { rows: f.rows || 3, value: cur == null ? '' : cur })
      : h('input', { type, value: cur == null ? '' : cur, placeholder: f.ph || '', inputmode: f.inputmode || null, min: f.min, max: f.max });
    el.addEventListener('input', () => {
      let v = el.value;
      if (f.t === 'number') v = v === '' ? '' : Number(v);
      setPath(st.content, path, v);
      changed();
      if (f.onChange) f.onChange();
    });
    return wrap(f, el);
  }

  function fToggle(f, path, opts) {
    const cur = getPath(st.content, path);
    const on = f.default === false ? cur === true : cur !== false;
    const input = h('input', { type: 'checkbox', checked: on });
    input.addEventListener('change', () => {
      setPath(st.content, path, input.checked);
      changed();
      if (f.onChange) f.onChange(input.checked);
    });
    const lab = h('label', { class: 'switch' + (opts && opts.cls ? ' ' + opts.cls : '') }, h('span', null, f.label), input, h('span', { class: 'knob' }));
    return h('div', { class: 'f' + (opts && opts.row ? ' show-row' : ''), style: 'margin-top:8px' }, lab, f.help ? h('p', { class: 'f-help', html: f.help }) : null);
  }

  function fSelect(f, path) {
    const cur = getPath(st.content, path);
    const sel = h('select', null, f.options.map(([v, l]) => h('option', { value: v }, l)));
    sel.value = cur == null ? f.options[0][0] : cur;
    sel.addEventListener('change', () => { setPath(st.content, path, sel.value); changed(); if (f.onChange) f.onChange(); });
    return wrap(f, sel);
  }

  function fRange(f, path) {
    const cur = getPath(st.content, path);
    const out = h('b', null, Math.round((cur == null ? f.def : cur) * 100) + '%');
    const r = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: cur == null ? f.def : cur, style: 'width:100%' });
    r.addEventListener('input', () => { setPath(st.content, path, Number(r.value)); out.textContent = Math.round(r.value * 100) + '%'; changed(); });
    return wrap(Object.assign({}, f, { label: null }), h('div', null, h('span', { class: 'f-label' }, f.label, ' ', out), r));
  }

  function colorRow(label, sub, get, set) {
    const val = get() || '#000000';
    const pick = h('input', { type: 'color', value: normHex(val) });
    const hex = h('input', { class: 'hex', type: 'text', value: val, maxlength: 7, spellcheck: 'false', autocapitalize: 'off' });
    pick.addEventListener('input', () => { hex.value = pick.value; set(pick.value); });
    hex.addEventListener('input', () => {
      let v = hex.value.trim();
      if (v && v[0] !== '#') v = '#' + v;
      if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { pick.value = normHex(v); set(v.toLowerCase()); }
    });
    return h('div', { class: 'color-row' }, h('div', { class: 'cl' }, label, sub ? h('small', null, sub) : null), pick, hex);
  }
  function normHex(v) {
    v = String(v || '').trim();
    if (/^#[0-9a-f]{3}$/i.test(v)) v = '#' + v.slice(1).split('').map((x) => x + x).join('');
    return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : '#000000';
  }

  /* image upload, resized on the phone before upload so it stays light */
  function resizeImage(file, max, quality) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.width, img.height));
        const cv = document.createElement('canvas');
        cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
        const ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not read this image'))), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('Could not read this image')); };
      img.src = url;
    });
  }
  async function storeFile(path, blob, label) {
    st.previewAssets[path] = URL.createObjectURL(blob);
    if (connected()) {
      toast(`Uploading ${label}…`, false, 20000);
      try {
        await gh(`/contents/${path}`, { method: 'PUT', body: { message: `Upload ${label}`, content: await blobToB64(blob), branch: st.gh.branch || 'main' } });
        toast(`${label[0].toUpperCase() + label.slice(1)} uploaded. Press Publish to show it on the site.`);
        return;
      } catch (e) {
        toast(friendlyError(e) + ' It will be uploaded when you publish.', true);
      }
    }
    st.pending[path] = { blob };
  }
  function slug(name) { return String(name || 'file').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'file'; }

  function fImage(f, path) {
    const box = h('div', { class: 'media' });
    const draw = () => {
      box.innerHTML = '';
      const cur = getPath(st.content, path);
      const src = cur ? (st.previewAssets[cur] || cur) : '';
      const thumb = h('div', { class: 'thumb' });
      if (src) thumb.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
      const input = h('input', { type: 'file', accept: 'image/*' });
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        try {
          const blob = await resizeImage(file, f.max || 1600, 0.85);
          const p = `assets/uploads/${slug(file.name)}-${Date.now().toString(36)}.jpg`;
          await storeFile(p, blob, 'photo');
          setPath(st.content, path, p);
          changed(); draw();
          if (f.onChange) f.onChange();
        } catch (e) { toast(e.message || 'Could not use this image', true); }
      });
      append(box, [thumb, h('div', { class: 'btns', style: 'margin:0' },
        h('label', { class: 'btn ghost sm file-btn' }, cur ? 'Change photo' : 'Choose photo', input),
        cur ? h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { setPath(st.content, path, ''); changed(); draw(); if (f.onChange) f.onChange(); } }, 'Remove') : null)]);
    };
    draw();
    return wrap(f, box);
  }

  function fAudio(f, path) {
    const box = h('div');
    const draw = () => {
      box.innerHTML = '';
      const cur = getPath(st.content, path) || '';
      const src = cur ? (st.previewAssets[cur] || cur) : '';
      const input = h('input', { type: 'file', accept: 'audio/*,.mp3,.m4a,.aac,.ogg' });
      input.addEventListener('change', async () => {
        const file = input.files && input.files[0];
        if (!file) return;
        if (file.size > 20 * 1024 * 1024) { toast('That file is over 20 MB. Please pick a shorter or smaller song (under 8 MB works best).', true); return; }
        const ext = (/\.([a-z0-9]{2,4})$/i.exec(file.name) || [0, 'mp3'])[1].toLowerCase();
        const p = `assets/uploads/${slug(file.name)}-${Date.now().toString(36)}.${ext}`;
        await storeFile(p, file, 'song');
        setPath(st.content, path, p);
        changed(); draw();
      });
      append(box, [
        h('p', { class: 'f-help', style: 'margin:0 0 8px' }, cur ? 'Current song: ' + cur.split('/').pop() : 'No song chosen'),
        src ? h('audio', { controls: true, preload: 'none', src }) : null,
        h('div', { class: 'btns', style: 'margin-top:8px' },
          h('label', { class: 'btn ghost sm file-btn' }, 'Upload a song', input),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { setPath(st.content, path, 'assets/music/canon-in-d-musicbox.mp3'); changed(); draw(); } }, 'Use the default music'))
      ]);
    };
    draw();
    return wrap(f, box);
  }

  /* colour swatches with a name each: { color, name: { en, bn } } */
  const newSwatch = (hex) => ({ color: hex, name: S.colorName(hex) });
  function fColorList(f, path) {
    const box = h('div', { class: 'swatch-list' });
    const draw = () => {
      box.innerHTML = '';
      const arr = getPath(st.content, path) || [];
      arr.forEach((it, i) => {
        if (!it.name || typeof it.name !== 'object') it.name = { en: '', bn: '' };
        const auto = S.colorName(it.color);
        const names = ['en', 'bn'].map((lang) => h('input', {
          class: 'in', type: 'text', lang, dir: 'auto', value: it.name[lang] || '', placeholder: auto[lang],
          'aria-label': `Colour ${i + 1} name (${lang === 'bn' ? 'Bangla' : 'English'})`,
          oninput: (e) => { it.name[lang] = e.target.value; changed(); }
        }));
        const pick = h('input', { type: 'color', value: normHex(it.color), 'aria-label': 'Colour ' + (i + 1) });
        pick.addEventListener('input', () => {
          // names that were filled in automatically follow the colour; typed ones stay
          const before = S.colorName(it.color), after = S.colorName(pick.value);
          ['en', 'bn'].forEach((lang, k) => {
            if (!it.name[lang] || it.name[lang] === before[lang]) { it.name[lang] = after[lang]; names[k].value = after[lang]; }
            names[k].placeholder = after[lang];
          });
          it.color = pick.value;
          changed();
        });
        append(box, h('div', { class: 'swatch-item' }, pick,
          h('div', { class: 'pair' },
            h('label', { class: 'lang' }, h('span', { class: 'tag' }, 'EN'), names[0]),
            h('label', { class: 'lang bn' }, h('span', { class: 'tag' }, 'বাং'), names[1])),
          h('button', { type: 'button', class: 'icon-btn del', 'aria-label': 'Remove colour', onclick: () => { arr.splice(i, 1); changed(); draw(); } }, '✕')));
      });
      if (arr.length < 8) append(box, h('button', { type: 'button', class: 'btn ghost sm', onclick: () => { arr.push(newSwatch('#c8a25c')); setPath(st.content, path, arr); changed(); draw(); } }, '+ Add colour'));
    };
    draw();
    return wrap(f, box);
  }

  function fList(f, path) {
    const box = h('div', { class: 'list' });
    const draw = (openIndex) => {
      box.innerHTML = '';
      const arr = getPath(st.content, path) || [];
      arr.forEach((item, i) => {
        const title = h('span', { class: 'item-t' });
        const setTitle = () => {
          title.textContent = f.itemTitle(item, i);
          if (f.badge && f.badge(item)) append(title, h('span', { class: 'badge' }, f.badge(item)));
        };
        setTitle();
        const move = (d) => (e) => {
          e.preventDefault(); e.stopPropagation();
          const j = i + d;
          if (j < 0 || j >= arr.length) return;
          [arr[i], arr[j]] = [arr[j], arr[i]];
          changed(); draw(j);
        };
        const del = (e) => {
          e.preventDefault(); e.stopPropagation();
          if (!confirm(`Remove "${f.itemTitle(item, i)}"?`)) return;
          arr.splice(i, 1);
          if (f.onRemove) f.onRemove(item);
          changed(); draw();
        };
        const body = h('div', { class: 'item-body' });
        f.fields.forEach((sf) => append(body, field(Object.assign({}, sf, { onChange: () => { setTitle(); if (sf.onChange) sf.onChange(item, i, draw); } }), `${path}.${i}.${sf.k}`)));
        const det = h('details', { class: 'item' },
          h('summary', null, title,
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', onclick: move(-1) }, '↑'),
            h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', onclick: move(1) }, '↓'),
            h('button', { type: 'button', class: 'icon-btn del', 'aria-label': 'Remove', onclick: del }, '✕')),
          body);
        if (i === openIndex) det.open = true;
        append(box, det);
      });
      append(box, h('button', {
        type: 'button', class: 'btn ghost add-btn',
        onclick: () => {
          const a = getPath(st.content, path) || [];
          const it = f.newItem();
          a.push(it); setPath(st.content, path, a);
          if (f.onAdd) f.onAdd(it);
          changed(); draw(a.length - 1);
        }
      }, f.addLabel || '+ Add'));
    };
    draw();
    return h('div', { class: 'f' }, f.label ? h('span', { class: 'f-label' }, f.label) : null, box);
  }

  function field(f, path) {
    path = path || f.k;
    switch (f.t) {
      case 'i18n': case 'i18nLong': return fI18n(f, path);
      case 'toggle': return fToggle(f, path);
      case 'select': return fSelect(f, path);
      case 'range': return fRange(f, path);
      case 'image': return fImage(f, path);
      case 'audio': return fAudio(f, path);
      case 'colors': return fColorList(f, path);
      case 'list': return fList(f, path);
      case 'html': return h('div', { class: 'f', html: f.html });
      default: return fInput(f, path);
    }
  }

  /* ---------- the editor layout ---------- */
  const COLOR_LABELS = [
    ['curtain', 'Curtain', 'The big curtains on the first screen'],
    ['curtainLines', 'Curtain folds', 'Thin lines on the curtain'],
    ['accent', 'Main colour', 'Names, titles, buttons, seal'],
    ['gold', 'Gold details', 'Scratch circles, tassels, small accents'],
    ['background', 'Page background', ''],
    ['card', 'Card background', 'Inside the framed cards'],
    ['text', 'Text', 'Normal writing'],
    ['muted', 'Soft text', 'Small labels and notes'],
    ['buttonText', 'Button text', 'Writing on coloured buttons']
  ];
  const SECTION_NAMES = {
    reveal: 'Date reveal (scratch)', countdown: 'Countdown', families: 'Families', photo: 'Photo',
    events: 'Events & programme', venue: 'Location map', menu: 'Menu', dressCode: 'Dress code',
    gifts: 'Gifts', rsvp: 'RSVP', closing: 'Closing note'
  };
  const DEFAULT_ORDER = ['reveal', 'countdown', 'families', 'photo', 'events', 'venue', 'menu', 'dressCode', 'gifts', 'rsvp', 'closing'];

  function mainToggleChange(item, i, redraw) {
    if (item.main) {
      (st.content.events.items || []).forEach((x, j) => { if (j !== i) x.main = false; });
      changed();
      redraw(i);
    }
  }

  const GROUPS = [
    {
      id: 'names', ic: '♥', title: 'Names & first screen', desc: 'Couple names, curtain text, invitation line',
      fields: [
        { k: 'couple.name1', t: 'i18n', label: 'First name (shown on top)' },
        { k: 'couple.name2', t: 'i18n', label: 'Second name' },
        { k: 'couple.joiner', t: 'i18n', label: 'Between the names', help: 'Usually & in English and ও in Bangla' },
        { k: 'hero.bismillah', t: 'toggle', label: 'Show Bismillah at the top', help: 'بسم الله الرحمن الرحيم in Arabic calligraphy, above everything on the first page.' },
        { k: 'hero.topLine', t: 'i18n', label: 'Small line above the names' },
        { k: 'hero.invitation', t: 'i18nLong', label: 'Invitation line under the names', rows: 2 },
        { k: 'intro.tapHint', t: 'i18n', label: 'Text on the closed curtain' },
        { k: 'couple.monogram', t: 'i18n', label: 'Letters on the wax seal (optional)', help: 'Leave empty to use the first letter of each name automatically.' },
        { k: 'intro.guestGreeting', t: 'i18n', label: 'Personal greeting for guest links', help: '<b>{name}</b> is replaced by the guest\'s name. See the Guest links tab.' },
        { k: 'intro.youAreInvited', t: 'i18n', label: 'Line under the personal greeting' },
        { k: 'hero.scrollHint', t: 'i18n', label: 'Scroll hint at the bottom' }
      ]
    },
    { id: 'order', ic: '☰', title: 'Sections: on / off & order', desc: 'Turn RSVP, gifts, dress code and others on or off', custom: renderOrder },
    { id: 'theme', ic: '🎨', title: 'Theme & colours', desc: 'Pick a ready theme or change any colour', custom: renderTheme },
    {
      id: 'events', ic: '📅', title: 'Events, dates & venues', desc: 'Holud, wedding, reception and so on', section: 'events',
      fields: [
        { k: 'events.eyebrow', t: 'i18n', label: 'Small line above the title' },
        { k: 'events.title', t: 'i18n', label: 'Title' },
        {
          k: 'events.items', t: 'list', label: 'Events', addLabel: '+ Add an event',
          itemTitle: (it, i) => enText(it.name) || `Event ${i + 1}`,
          badge: (it) => (it.main ? 'Main day' : ''),
          newItem: () => ({ main: false, name: { en: 'New event', bn: '' }, date: '', time: '18:00', venue: { en: '', bn: '' }, address: { en: '', bn: '' }, note: { en: '', bn: '' }, mapLink: '' }),
          fields: [
            { k: 'name', t: 'i18n', label: 'Event name' },
            { k: 'date', t: 'date', label: 'Date' },
            { k: 'time', t: 'time', label: 'Time' },
            { k: 'venue', t: 'i18n', label: 'Venue name' },
            { k: 'address', t: 'i18nLong', label: 'Address', rows: 2 },
            { k: 'note', t: 'i18n', label: 'Note (optional)', help: 'For example the colour to wear' },
            { k: 'mapLink', t: 'url', label: 'Google Maps link (optional)', ph: 'https://maps.app.goo.gl/…', help: 'In Google Maps, open the place, tap <b>Share</b>, copy the link and paste it here. If empty, the venue name and address are used.' },
            { k: 'main', t: 'toggle', default: false, label: 'This is the main wedding day', help: 'The date reveal, countdown and "Add to calendar" use the main day.', onChange: mainToggleChange }
          ]
        },
        { k: 'events.showIllustration', t: 'toggle', label: 'Show the palace drawing at the bottom of the card' },
        { k: 'settings.timezone', t: 'select', label: 'Time zone of the wedding', options: [['+06:00', 'Bangladesh (GMT+6)'], ['+05:30', 'India (GMT+5:30)'], ['+05:00', 'Pakistan (GMT+5)'], ['+04:00', 'UAE (GMT+4)'], ['+03:00', 'Saudi Arabia (GMT+3)'], ['+00:00', 'UK in winter (GMT)'], ['+01:00', 'UK in summer (GMT+1)'], ['-05:00', 'New York in winter (GMT-5)'], ['+08:00', 'Malaysia / Singapore (GMT+8)'], ['+10:00', 'Sydney in winter (GMT+10)']], help: 'Keeps the countdown correct for guests in other countries.' }
      ]
    },
    {
      id: 'reveal', ic: '✨', title: 'Date reveal', desc: 'Gold circles guests scratch to see the date', section: 'reveal',
      fields: [
        { k: 'reveal.title', t: 'i18n', label: 'Title' },
        { k: 'reveal.subtitle', t: 'i18n', label: 'Instruction' },
        { k: 'reveal.after', t: 'i18n', label: 'Message after the date is revealed' },
        { k: 'reveal.revealAll', t: 'i18n', label: 'Small "reveal" link', help: 'For guests who prefer to tap instead of scratching.' },
        { t: 'html', html: '<p class="f-help">The date itself comes from the event marked as the main wedding day.</p>' }
      ]
    },
    {
      id: 'countdown', ic: '⏳', title: 'Countdown', desc: 'Days, hours, minutes to the main day', section: 'countdown',
      fields: [
        { k: 'countdown.title', t: 'i18n', label: 'Title' },
        { k: 'countdown.days', t: 'i18n', label: 'Word for days' },
        { k: 'countdown.hours', t: 'i18n', label: 'Word for hours' },
        { k: 'countdown.minutes', t: 'i18n', label: 'Word for minutes' },
        { k: 'countdown.seconds', t: 'i18n', label: 'Word for seconds' },
        { k: 'countdown.done', t: 'i18n', label: 'Message once the day arrives' }
      ]
    },
    {
      id: 'families', ic: '👪', title: 'Families', desc: 'Parents of the couple', section: 'families',
      fields: [
        { k: 'families.eyebrow', t: 'i18n', label: 'Small line on top' },
        { k: 'families.family1', t: 'i18nLong', label: 'Under the first name', rows: 2, help: 'Press Enter for a new line.' },
        { k: 'families.family2', t: 'i18nLong', label: 'Under the second name', rows: 2 }
      ]
    },
    {
      id: 'photo', ic: '📷', title: 'Photo', desc: 'An optional photo of the couple', section: 'photo',
      fields: [
        { k: 'photo.image', t: 'image', label: 'Photo', help: 'It is made smaller automatically so the page stays fast.' },
        { k: 'photo.title', t: 'i18n', label: 'Title' },
        { k: 'photo.caption', t: 'i18nLong', label: 'Caption (optional)', rows: 2 }
      ]
    },
    {
      id: 'venue', ic: '📍', title: 'Location map', desc: 'Map and directions button', section: 'venue',
      fields: [
        { k: 'venue.title', t: 'i18n', label: 'Title' },
        { k: 'venue.name', t: 'i18n', label: 'Venue name' },
        { k: 'venue.address', t: 'i18nLong', label: 'Address', rows: 2 },
        { k: 'venue.mapSearch', t: 'text', label: 'What the map should show', ph: 'e.g. Senakunja, Dhaka Cantonment', help: 'Type it the way you would search in Google Maps.' },
        { k: 'venue.mapLink', t: 'url', label: 'Google Maps link for the button (optional)', ph: 'https://maps.app.goo.gl/…', help: 'In Google Maps, tap <b>Share</b> on the place and paste the link here.' },
        { k: 'venue.button', t: 'i18n', label: 'Button text' }
      ]
    },
    {
      id: 'menu', ic: '🍽', title: 'Menu', desc: 'The food being served', section: 'menu',
      fields: [
        { k: 'menu.eyebrow', t: 'i18n', label: 'Small line on top' },
        { k: 'menu.title', t: 'i18n', label: 'Title' },
        {
          k: 'menu.items', t: 'list', label: 'Courses', addLabel: '+ Add a course',
          itemTitle: (it, i) => enText(it.course) || `Course ${i + 1}`,
          newItem: () => ({ course: { en: 'New course', bn: '' }, dishes: { en: '', bn: '' } }),
          fields: [
            { k: 'course', t: 'i18n', label: 'Course name' },
            { k: 'dishes', t: 'i18nLong', label: 'Dishes', rows: 2, help: 'Separate dishes with · or a new line.' }
          ]
        }
      ]
    },
    {
      id: 'dress', ic: '👗', title: 'Dress code', desc: 'What to wear and suggested colours', section: 'dressCode',
      fields: [
        { k: 'dressCode.title', t: 'i18n', label: 'Title' },
        { k: 'dressCode.heading', t: 'i18n', label: 'Short heading' },
        { k: 'dressCode.text', t: 'i18nLong', label: 'Description' },
        { k: 'dressCode.colorsLabel', t: 'i18n', label: 'Label above the colours' },
        { k: 'dressCode.colors', t: 'colors', label: 'Suggested colours', help: 'Tap a circle to change the colour. Its name is filled in for you and shown under the circle; type your own name to change it. ✕ removes a colour.' }
      ]
    },
    {
      id: 'gifts', ic: '🎁', title: 'Gifts', desc: 'A note about gifts, optional bKash or bank details', section: 'gifts',
      fields: [
        { k: 'gifts.eyebrow', t: 'i18n', label: 'Small line on top' },
        { k: 'gifts.title', t: 'i18n', label: 'Title' },
        { k: 'gifts.text', t: 'i18nLong', label: 'Message' },
        { k: 'gifts.details', t: 'i18nLong', label: 'Details shown on tap (optional)', rows: 3, help: 'For example: bKash 01XXXXXXXXX. Leave empty to hide the button.' },
        { k: 'gifts.detailsButton', t: 'i18n', label: 'Button text' }
      ]
    },
    {
      id: 'rsvp', ic: '✉', title: 'RSVP', desc: 'Guests reply to you on WhatsApp', section: 'rsvp',
      fields: [
        { k: 'rsvp.title', t: 'i18n', label: 'Title' },
        { k: 'rsvp.text', t: 'i18nLong', label: 'Message', rows: 2 },
        { k: 'rsvp.whatsapp', t: 'tel', label: 'WhatsApp number that receives replies', ph: '8801XXXXXXXXX', inputmode: 'tel', help: 'Country code first, no + or spaces. Example: <b>8801712345678</b>' },
        { k: 'rsvp.phone', t: 'tel', label: 'Phone number for a "Call us" button (optional)', ph: '+8801XXXXXXXXX', inputmode: 'tel' },
        { k: 'rsvp.formUrl', t: 'url', label: 'Use a Google Form instead (optional)', ph: 'https://forms.gle/…', help: 'If you paste a form link, guests see a button to that form instead of the WhatsApp form.' },
        { k: 'rsvp.maxGuests', t: 'number', label: 'Most guests one person can bring', min: 1, max: 30 },
        { k: 'rsvp.nameLabel', t: 'i18n', label: 'Label: name' },
        { k: 'rsvp.yesLabel', t: 'i18n', label: 'Label: attending' },
        { k: 'rsvp.noLabel', t: 'i18n', label: 'Label: not attending' },
        { k: 'rsvp.guestsLabel', t: 'i18n', label: 'Label: number of guests' },
        { k: 'rsvp.messageLabel', t: 'i18n', label: 'Label: note' },
        { k: 'rsvp.button', t: 'i18n', label: 'Send button' },
        { k: 'rsvp.messageTemplate', t: 'i18nLong', label: 'WhatsApp message guests send you', rows: 3, help: '{name}, {status}, {couple}, {guests} and {message} are filled in automatically.' },
        { k: 'rsvp.yesWord', t: 'i18n', label: 'Word used for {status} when attending' },
        { k: 'rsvp.noWord', t: 'i18n', label: 'Word used for {status} when not attending' },
        { k: 'rsvp.nameMissing', t: 'i18n', label: 'Reminder if the name is empty' },
        { k: 'rsvp.formButton', t: 'i18n', label: 'Google Form button text' },
        { k: 'rsvp.callButton', t: 'i18n', label: 'Call button text' }
      ]
    },
    {
      id: 'closing', ic: '💌', title: 'Closing note', desc: 'Last message, hashtag, add to calendar', section: 'closing',
      fields: [
        { k: 'closing.title', t: 'i18n', label: 'Title' },
        { k: 'closing.text', t: 'i18nLong', label: 'Message', rows: 2 },
        { k: 'closing.signature', t: 'i18n', label: 'Line before your names' },
        { k: 'closing.hashtag', t: 'text', label: 'Hashtag (optional)', ph: '#RafiWedsNabila' },
        { k: 'closing.calendarButton', t: 'i18n', label: 'Add to calendar button' },
        { k: 'labels.directions', t: 'i18n', label: 'Text on the Directions links' }
      ]
    },
    {
      id: 'custom', ic: '＋', title: 'Extra sections', desc: 'Add your own sections, like parking info or a live stream',
      fields: [
        {
          k: 'custom.items', t: 'list', addLabel: '+ Add a section',
          itemTitle: (it, i) => enText(it.title) || `Extra section ${i + 1}`,
          badge: (it) => (it.show === false ? 'Off' : ''),
          newItem: () => ({ id: Date.now().toString(36), show: true, eyebrow: { en: '', bn: '' }, title: { en: 'Good to Know', bn: 'জেনে রাখুন' }, heading: { en: '', bn: '' }, text: { en: 'Write anything you want guests to know here.', bn: '' }, image: '', buttonText: { en: '', bn: '' }, buttonLink: '' }),
          onAdd: () => { st.content.settings.sectionOrder = currentOrder(); refill('order'); },
          onRemove: (it) => { st.content.settings.sectionOrder = currentOrder().filter((k) => k !== 'custom:' + it.id); refill('order'); },
          fields: [
            { k: 'show', t: 'toggle', label: 'Show this section', onChange: () => refill('order') },
            { k: 'title', t: 'i18n', label: 'Title (fancy script)' },
            { k: 'eyebrow', t: 'i18n', label: 'Small line above the title (optional)' },
            { k: 'heading', t: 'i18n', label: 'Short heading (optional)' },
            { k: 'text', t: 'i18nLong', label: 'Text', rows: 3 },
            { k: 'image', t: 'image', label: 'Picture (optional)' },
            { k: 'buttonText', t: 'i18n', label: 'Button text (optional)' },
            { k: 'buttonLink', t: 'url', label: 'Button link (optional)', ph: 'https://…', help: 'For example a YouTube live link, hotel booking page or Facebook event.' }
          ]
        }
      ]
    },
    { id: 'music', ic: '♪', title: 'Music', desc: 'Background song that starts when the curtain opens', custom: renderMusic },
    { id: 'language', ic: 'অ', title: 'Language', desc: 'English, বাংলা, or both', custom: renderLanguage },
    { id: 'share', ic: '🔗', title: 'Link preview', desc: 'What people see when the link is shared on WhatsApp or Facebook', custom: renderShare }
  ];

  function renderForm() {
    const form = $('#form');
    const openIds = $$('.grp[open]', form).map((d) => d.dataset.id);
    form.innerHTML = '';
    GROUPS.forEach((g) => {
      const body = h('div', { class: 'grp-body' });
      const hiddenChip = h('span', { class: 'grp-hidden' }, 'Hidden');
      const updateChip = () => { hiddenChip.hidden = !(g.section && st.content[g.section] && st.content[g.section].show === false); };
      const fill = () => {
        body.innerHTML = '';
        if (g.section) append(body, fToggle({ label: 'Show this section on the invitation', onChange: () => { updateChip(); refreshOrder(); } }, `${g.section}.show`, { row: true }));
        if (g.custom) append(body, g.custom());
        else g.fields.forEach((f) => append(body, field(f)));
      };
      updateChip();
      const det = h('details', { class: 'grp', 'data-id': g.id },
        h('summary', null, h('span', { class: 'grp-ic', 'aria-hidden': 'true' }, g.ic), h('span', { class: 'grp-t' }, h('b', null, g.title), h('small', null, g.desc)), hiddenChip),
        body);
      let filled = false;
      det.addEventListener('toggle', () => {
        if (det.open && !filled) { fill(); filled = true; }
        if (det.open && g.id === 'share') drawSharePreviewSoon();
      });
      det._refill = () => { if (filled) fill(); updateChip(); };
      if (openIds.includes(g.id)) { det.open = true; fill(); filled = true; }
      append(form, det);
    });
  }
  function refill(id) { const d = $(`.grp[data-id="${id}"]`); if (d && d._refill) d._refill(); }
  function refreshOrder() { refill('order'); $$('.grp').forEach((d) => { if (d.dataset.id !== 'order' && d._refill) { const g = GROUPS.find((x) => x.id === d.dataset.id); if (g && g.section) { const chip = $('.grp-hidden', d); chip.hidden = st.content[g.section].show !== false; } } }); }

  function renderTheme() {
    const box = h('div');
    const c = st.content.settings;
    const tiles = h('div', { class: 'themes' });
    Object.keys(S.THEMES).forEach((key) => {
      const th = S.THEMES[key];
      append(tiles, h('button', {
        type: 'button', class: 'theme-tile' + (c.theme === key ? ' on' : ''),
        onclick: () => { c.theme = key; c.colors = Object.assign({}, th.colors); changed(); refill('theme'); toast(`${th.name} theme applied`); }
      }, h('div', { class: 'sw' }, h('i', { style: `background:${th.colors.curtain}` }), h('i', { style: `background:${th.colors.accent}` }), h('i', { style: `background:${th.colors.gold}` }), h('i', { style: `background:${th.colors.background}` })), h('b', null, th.name)));
    });
    append(box, h('p', { class: 'f-help', style: 'margin-top:12px' }, 'Ready-made themes. Tap one, then fine-tune any colour below.'), tiles);
    const list = h('div', { style: 'margin-top:16px' });
    COLOR_LABELS.forEach(([k, label, sub]) => append(list, colorRow(label, sub, () => c.colors[k], (v) => { c.colors[k] = v; c.theme = 'custom'; $$('.theme-tile', tiles).forEach((t) => t.classList.remove('on')); changed(); })));
    append(box, h('span', { class: 'f-label', style: 'margin-top:16px' }, 'Every colour'), list);
    return box;
  }

  function renderMusic() {
    return h('div', null,
      fToggle({ label: 'Play music when the curtain opens' }, 'settings.music.enabled', { row: true }),
      fAudio({ label: 'Song', help: 'MP3 works on every phone. Keep it under 8 MB so it loads fast. The default is a soft music-box version of Pachelbel\'s Canon (public domain).' }, 'settings.music.src'),
      fRange({ label: 'Volume', min: 0.1, max: 1, step: 0.05, def: 0.6 }, 'settings.music.volume'));
  }

  function renderLanguage() {
    const showBn = h('input', { type: 'checkbox', checked: st.showBn });
    showBn.addEventListener('change', () => { st.showBn = showBn.checked; LS.set('inv-showbn', st.showBn); document.body.classList.toggle('no-bn', !st.showBn); });
    return h('div', null,
      fSelect({ label: 'Language guests see first', options: [['en', 'English'], ['bn', 'বাংলা (Bangla)']] }, 'settings.defaultLanguage'),
      fToggle({ label: 'Show the EN / বাং switch button', help: 'Guests can switch language with the round button at the top right.' }, 'settings.showLanguageSwitch'),
      fI18n({ label: 'Text on the switch button', help: 'English side is shown while the page is in English, so it usually says বাং.' }, 'labels.language'),
      h('div', { class: 'f show-row' }, h('label', { class: 'switch' }, h('span', null, 'Show Bangla boxes in this editor'), showBn, h('span', { class: 'knob' }))),
      h('p', { class: 'f-help' }, 'If a Bangla box is empty, the English text is used in its place.'));
  }

  function customItems() { return (st.content.custom && Array.isArray(st.content.custom.items)) ? st.content.custom.items : []; }
  function currentOrder() {
    const s = st.content.settings;
    let order = Array.isArray(s.sectionOrder) ? s.sectionOrder.slice() : DEFAULT_ORDER.slice();
    DEFAULT_ORDER.forEach((k) => { if (!order.includes(k)) order.push(k); });
    customItems().forEach((it) => { const key = 'custom:' + it.id; if (!order.includes(key)) { const ci = order.indexOf('closing'); order.splice(ci < 0 ? order.length : ci, 0, key); } });
    const ids = customItems().map((it) => 'custom:' + it.id);
    return order.filter((k, i) => (SECTION_NAMES[k] || ids.includes(k)) && order.indexOf(k) === i);
  }
  function renderOrder() {
    const box = h('div');
    const order = currentOrder();
    st.content.settings.sectionOrder = order;
    order.forEach((k, i) => {
      const isCustom = k.indexOf('custom:') === 0;
      const sec = isCustom ? customItems().find((x) => 'custom:' + x.id === k) : (st.content[k] || (st.content[k] = {}));
      const name = isCustom ? 'Extra: ' + (enText(sec.title) || 'section') : SECTION_NAMES[k];
      const cb = h('input', { type: 'checkbox', checked: sec.show !== false, 'aria-label': 'Show ' + name });
      const row = h('div', { class: 'order-row' + (sec.show === false ? ' off' : '') },
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move up', disabled: i === 0 ? true : null, onclick: () => { [order[i - 1], order[i]] = [order[i], order[i - 1]]; changed(); refill('order'); } }, '↑'),
        h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Move down', disabled: i === order.length - 1 ? true : null, onclick: () => { [order[i + 1], order[i]] = [order[i], order[i + 1]]; changed(); refill('order'); } }, '↓'),
        h('b', null, name),
        h('label', { class: 'switch on-off', style: 'padding:0' }, cb, h('span', { class: 'knob' })));
      cb.addEventListener('change', () => {
        sec.show = cb.checked; row.classList.toggle('off', !cb.checked); changed();
        if (isCustom) refill('custom'); else GROUPS.forEach((g) => { if (g.section === k) refill(g.id); });
      });
      append(box, row);
    });
    return h('div', null, h('p', { class: 'f-help', style: 'margin-top:12px' }, 'Switch a section on to show it, off to hide it. Arrows change the order. The curtain and names always come first.'), box);
  }

  /* ---------- share image (WhatsApp / Facebook link preview) ---------- */
  const fontsReady = (async () => {
    const list = [
      ['Pinyon Script', 'pinyon-script.woff2', {}],
      ['Cormorant Garamond', 'cormorant-600.woff2', { weight: '600' }],
      ['Cormorant Garamond', 'cormorant-400-italic.woff2', { style: 'italic' }],
      ['Galada', 'galada-bengali.woff2', {}],
      ['Noto Serif Bengali', 'noto-serif-bengali-400.woff2', {}]
    ];
    if (!window.FontFace) return;
    await Promise.all(list.map(async ([fam, file, d]) => {
      try { const ff = new FontFace(fam, `url(assets/fonts/${file})`, d); await ff.load(); document.fonts.add(ff); } catch (e) { /* fall back to system fonts */ }
    }));
  })();

  async function drawShareCard(cv) {
    await fontsReady;
    const W = 1200, H = 630;
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const c = st.content, col = c.settings.colors, lang = c.settings.defaultLanguage === 'bn' ? 'bn' : 'en';
    const t = (v) => S.tr(v, lang);
    ctx.fillStyle = col.background; ctx.fillRect(0, 0, W, H);
    S.paintCurtains(ctx, W, H, 1, { curtain: col.curtain, curtainLines: col.curtainLines, gold: col.gold }, { slice: 1 }, 1);
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    const spaced = (txt, font, y, color, spacing) => {
      ctx.font = font; ctx.fillStyle = color;
      if ('letterSpacing' in ctx) { ctx.letterSpacing = spacing + 'px'; ctx.fillText(txt, W / 2 + spacing / 2, y, 900); ctx.letterSpacing = '0px'; }
      else ctx.fillText(txt, W / 2, y, 900);
    };
    const serif = lang === 'bn' ? '"Noto Serif Bengali", serif' : '"Cormorant Garamond", Georgia, serif';
    const script = lang === 'bn' ? '"Galada", "Pinyon Script", cursive' : '"Pinyon Script", "Galada", cursive';
    const top = t(c.hero.topLine);
    if (top) spaced(lang === 'bn' ? top : top.toUpperCase(), `600 ${lang === 'bn' ? 26 : 22}px ${serif}`, 178, col.muted, lang === 'bn' ? 0 : 6);
    // names on one line if they fit at a good size, otherwise on two lines, always inside the card
    const fitFont = (txt, size, min, maxW) => {
      ctx.font = `${size}px ${script}`;
      while (ctx.measureText(txt).width > maxW && size > min) { size -= 2; ctx.font = `${size}px ${script}`; }
      return size;
    };
    const joiner = t(c.couple.joiner) || '&';
    const names = `${t(c.couple.name1)} ${joiner} ${t(c.couple.name2)}`;
    ctx.fillStyle = col.accent;
    if (fitFont(names, lang === 'bn' ? 96 : 118, 72, 860) > 72 || ctx.measureText(names).width <= 860) {
      ctx.fillText(names, W / 2, 330, 900);
    } else {
      const lines = [`${t(c.couple.name1)} ${joiner}`, t(c.couple.name2)];
      const size = Math.min(...lines.map((l) => fitFont(l, lang === 'bn' ? 80 : 92, 30, 860)));
      ctx.font = `${size}px ${script}`;
      ctx.fillText(lines[0], W / 2, 268, 900);
      ctx.fillText(lines[1], W / 2, 268 + size * 0.95, 900);
    }
    const ev = S.mainEvent(c);
    if (ev && ev.date) {
      ctx.font = `italic 36px ${serif}`; ctx.fillStyle = col.text;
      ctx.fillText(S.formatDateLong(ev.date, lang), W / 2, 418, 900);
    }
    const inv = t(c.intro.youAreInvited);
    if (inv) spaced(lang === 'bn' ? inv : inv.toUpperCase(), `600 ${lang === 'bn' ? 26 : 21}px ${serif}`, 492, col.accent, lang === 'bn' ? 0 : 7);
    return cv;
  }
  const shareCanvasOpen = () => !!$('.grp[data-id="share"][open] canvas');
  const drawSharePreviewSoon = debounce(() => { const cv = $('.grp[data-id="share"][open] canvas'); if (cv) drawShareCard(cv); }, 300);

  function renderShare() {
    const s = st.content.share || (st.content.share = {});
    const custom = !!s.customImage;
    const prev = h('div', { class: 'share-prev' },
      custom && s.image ? h('img', { src: st.previewAssets[s.image] || s.image, alt: '' }) : h('canvas', { width: 1200, height: 630 }),
      h('div', { class: 'meta' }, h('b', null, s.title || autoShareTitle()), h('span', null, s.description || '')));
    const refresh = () => { $('b', prev).textContent = s.title || autoShareTitle(); $('.meta span', prev).textContent = s.description || ''; };
    return h('div', null,
      fInput({ t: 'text', label: 'Title', ph: autoShareTitle(), help: 'Leave empty to use your names automatically.', onChange: refresh }, 'share.title'),
      fInput({ t: 'textarea', rows: 2, label: 'Description', onChange: refresh }, 'share.description'),
      h('span', { class: 'f-label', style: 'margin-top:14px' }, 'Preview'),
      prev,
      h('p', { class: 'f-help' }, custom ? 'Using your own image.' : 'This picture is made automatically from your names, date and colours each time you publish.'),
      fToggle({ label: 'Use my own picture instead', default: false, onChange: () => refill('share') }, 'share.customImage'),
      custom ? fImage({ label: 'Picture (1200 × 630 looks best)', max: 1200, onChange: () => refill('share') }, 'share.image') : null,
      fInput({ t: 'url', label: 'Custom web address (optional)', ph: 'https://…', help: 'Only if you connected your own domain. Leave empty for the normal GitHub Pages address.' }, 'share.siteUrl'),
      h('p', { class: 'f-help' }, 'WhatsApp and Facebook remember previews for a while, so a new picture can take some time to appear for links that were already shared.'));
  }

  function autoShareTitle() { return `${enText(st.content.couple.name1)} & ${enText(st.content.couple.name2)} are getting married`; }
  function shareBlock() {
    const s = st.content.share || {};
    const esc = S.esc;
    const base = siteUrl();
    const img = s.customImage && s.image ? s.image : 'assets/img/og.jpg';
    const imgUrl = /^https?:/i.test(img) ? img : base + img.replace(/^\//, '') + '?v=' + Date.now().toString(36);
    const title = s.title || autoShareTitle();
    return [
      '<!-- SHARE:START -->',
      `  <title>${esc(title)}</title>`,
      `  <meta name="description" content="${esc(s.description || '')}">`,
      '  <meta property="og:type" content="website">',
      `  <meta property="og:url" content="${esc(base)}">`,
      `  <meta property="og:title" content="${esc(title)}">`,
      `  <meta property="og:description" content="${esc(s.description || '')}">`,
      `  <meta property="og:image" content="${esc(imgUrl)}">`,
      '  <meta property="og:image:width" content="1200">',
      '  <meta property="og:image:height" content="630">',
      '  <meta name="twitter:card" content="summary_large_image">',
      '  <!-- SHARE:END -->'
    ].join('\n');
  }

  /* ---------- publish ---------- */
  async function publish() {
    if (st.publishing) return;
    if (!connected()) {
      modal([
        h('h3', null, 'Connect GitHub first'),
        h('p', null, 'Publishing saves your changes to your GitHub repository, which updates the live site. It takes two minutes to set up once.'),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn primary', onclick: () => { modal(null); setTab('setup'); } }, 'Open Setup'),
          h('button', { type: 'button', class: 'btn ghost', onclick: () => { modal(null); downloadBackup(); } }, 'Download content.json'),
          h('button', { type: 'button', class: 'btn ghost', onclick: () => modal(null) }, 'Cancel'))
      ]);
      return;
    }
    const steps = ['Preparing your changes', 'Uploading to GitHub', 'Saving', 'Updating the live site'];
    const list = h('ul', { class: 'prog' }, steps.map((s) => h('li', null, s)));
    const note = h('p', { class: 'f-help' }, 'Keep this page open for a moment.');
    const closeBtn = h('button', { type: 'button', class: 'btn ghost', hidden: true, onclick: () => modal(null) }, 'Close');
    modal([h('h3', null, 'Publishing'), list, note, h('div', { class: 'btns' }, closeBtn)]);
    const mark = (i) => $$('li', list).forEach((li, j) => { li.className = j < i ? 'done' : (j === i ? 'doing' : ''); });
    st.publishing = true; updateStatus();
    const branch = st.gh.branch || 'main';
    try {
      mark(0);
      const files = [];
      const snapshot = clone(st.content);
      files.push({ path: 'content.json', content: JSON.stringify(snapshot, null, 2) + '\n', encoding: 'utf-8' });
      if (!(snapshot.share && snapshot.share.customImage)) {
        const cv = await drawShareCard(document.createElement('canvas'));
        files.push({ path: 'assets/img/og.jpg', content: cv.toDataURL('image/jpeg', 0.86).split(',')[1], encoding: 'base64' });
      }
      const idx = await gh(`/contents/index.html?ref=${encodeURIComponent(branch)}`);
      const html = b64ToUtf8(idx.content);
      if (/<!-- SHARE:START -->[\s\S]*?<!-- SHARE:END -->/.test(html)) {
        const nh = html.replace(/<!-- SHARE:START -->[\s\S]*?<!-- SHARE:END -->/, shareBlock());
        if (nh !== html) files.push({ path: 'index.html', content: nh, encoding: 'utf-8' });
      }
      for (const p of Object.keys(st.pending)) files.push({ path: p, content: await blobToB64(st.pending[p].blob), encoding: 'base64' });

      mark(1);
      const tree = [];
      for (const f of files) {
        const b = await gh('/git/blobs', { method: 'POST', body: { content: f.content, encoding: f.encoding } });
        tree.push({ path: f.path, mode: '100644', type: 'blob', sha: b.sha });
      }

      mark(2);
      let attempt = 0, newSha;
      for (;;) {
        const ref = await gh(`/git/ref/heads/${encodeURIComponent(branch)}`);
        const head = await gh(`/git/commits/${ref.object.sha}`);
        const t = await gh('/git/trees', { method: 'POST', body: { base_tree: head.tree.sha, tree } });
        const commit = await gh('/git/commits', { method: 'POST', body: { message: 'Update invitation from the editor', tree: t.sha, parents: [ref.object.sha] } });
        try { await gh(`/git/refs/heads/${encodeURIComponent(branch)}`, { method: 'PATCH', body: { sha: commit.sha } }); newSha = commit.sha; break; } catch (e) { if (++attempt > 2) throw e; }
      }
      st.pending = {};
      st.base = JSON.stringify(snapshot);
      st.dirty = JSON.stringify(st.content) !== st.base;
      if (!st.dirty) LS.del('inv-draft');
      LS.set('inv-last-publish', { at: Date.now(), sha: newSha });

      mark(3);
      note.textContent = 'Saved. GitHub is updating your site, this usually takes under a minute…';
      const live = await waitForLive(snapshot);
      mark(4);
      st.publishing = false; updateStatus();
      note.innerHTML = live
        ? '<span class="ok-text">Done! Everyone with the link now sees the new version.</span> If an old version shows on a phone, pull down to refresh.'
        : '<span class="ok-text">Saved.</span> GitHub is still updating the site. It should show the new version within a couple of minutes.';
      closeBtn.hidden = false;
      append(closeBtn.parentNode, h('a', { class: 'btn primary', href: siteUrl(), target: '_blank', rel: 'noopener' }, 'Open the site'));
    } catch (e) {
      st.publishing = false; updateStatus();
      note.innerHTML = '';
      append(note, h('span', { class: 'err-text' }, friendlyError(e)));
      closeBtn.hidden = false;
      if ([401, 403, 404].includes(e.status)) append(closeBtn.parentNode, h('button', { type: 'button', class: 'btn primary', onclick: () => { modal(null); setTab('setup', true); } }, 'Fix in Setup'));
    }
  }
  async function waitForLive(snapshot) {
    const want = JSON.stringify(snapshot);
    const url = siteUrl() + 'content.json';
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      try {
        const r = await fetch(url + '?check=' + Date.now(), { cache: 'no-store' });
        if (r.ok && JSON.stringify(await r.json()) === want) return true;
      } catch (e) { /* not live yet, or a different site */ }
    }
    return false;
  }
  $('#publishBtn').addEventListener('click', publish);

  /* ---------- backup ---------- */
  function downloadBackup() {
    const blob = new Blob([JSON.stringify(st.content, null, 2) + '\n'], { type: 'application/json' });
    const a = h('a', { href: URL.createObjectURL(blob), download: 'content.json' });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  /* ---------- guest links ---------- */
  function renderGuests() {
    const pane = $('#pane-guests');
    const saved = LS.get('inv-guests', { names: '', lang: '', msg: '' });
    const defMsg = 'Dear {name}, with great joy we invite you to our wedding. Please open your invitation here: {link}';
    const names = h('textarea', { class: 'in-area', rows: 6, placeholder: 'Rahim Uncle\nNadia Apu\nThe Chowdhury Family', value: saved.names || '' });
    const msg = h('textarea', { class: 'in-area', rows: 3, value: saved.msg || defMsg });
    const lang = h('select', null, h('option', { value: '' }, 'Guest\'s last choice / default'), h('option', { value: 'en' }, 'English'), h('option', { value: 'bn' }, 'বাংলা'));
    lang.value = saved.lang || '';
    const out = h('div');
    const base = siteUrl();
    const linkFor = (n) => base + '?to=' + encodeURIComponent(n).replace(/%20/g, '+') + (lang.value ? '&lang=' + lang.value : '');
    const copy = async (text) => {
      try { await navigator.clipboard.writeText(text); toast('Copied'); }
      catch (e) { const ta = h('textarea', { value: text, style: 'position:fixed;opacity:0' }); document.body.append(ta); ta.select(); document.execCommand('copy'); ta.remove(); toast('Copied'); }
    };
    const build = () => {
      LS.set('inv-guests', { names: names.value, lang: lang.value, msg: msg.value });
      out.innerHTML = '';
      const list = names.value.split('\n').map((x) => x.trim()).filter(Boolean);
      if (!list.length) { append(out, h('p', { class: 'f-help' }, 'Type guest names above, one per line.')); return; }
      list.forEach((n) => {
        const link = linkFor(n);
        const text = msg.value.replace(/\{name\}/g, n).replace(/\{link\}/g, link);
        append(out, h('div', { class: 'guest-row' },
          h('div', { class: 'gn' }, h('b', null, n), h('small', null, link)),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: () => copy(text) }, 'Copy'),
          h('a', { class: 'btn sm wa', href: 'https://wa.me/?text=' + encodeURIComponent(text), target: '_blank', rel: 'noopener' }, 'WhatsApp')));
      });
      append(out, h('div', { class: 'btns' }, h('button', { type: 'button', class: 'btn ghost', onclick: () => copy(list.map((n) => `${n}: ${linkFor(n)}`).join('\n')) }, 'Copy all links')));
    };
    const deb = debounce(build, 250);
    [names, msg].forEach((x) => x.addEventListener('input', deb));
    lang.addEventListener('change', build);
    pane.innerHTML = '';
    append(pane, [
      h('div', { class: 'card' },
        h('h3', null, 'Your invitation link'),
        h('p', null, 'Share this with everyone, or make personal links below.'),
        h('div', { class: 'guest-row' }, h('div', { class: 'gn' }, h('b', null, base)), h('button', { type: 'button', class: 'btn ghost sm', onclick: () => copy(base) }, 'Copy'),
          h('a', { class: 'btn sm wa', href: 'https://wa.me/?text=' + encodeURIComponent(base), target: '_blank', rel: 'noopener' }, 'WhatsApp'))),
      h('div', { class: 'card' },
        h('h3', null, 'Personal links'),
        h('p', null, 'Each guest sees their own name on the curtain, like "Dear Rahim Uncle". Their name is also filled into the RSVP form.'),
        h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Guest names, one per line'), names),
        h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Message to send with the link'), msg, h('p', { class: 'f-help' }, '{name} and {link} are filled in for each guest.')),
        h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Open the invitation in'), lang),
        h('div', { style: 'margin-top:12px' }, out))
    ]);
    build();
  }

  /* ---------- setup ---------- */
  function renderSetup(checkNow) {
    const pane = $('#pane-setup');
    const g = st.gh;
    const owner = h('input', { type: 'text', value: g.owner, placeholder: 'your-github-username', autocapitalize: 'off', spellcheck: 'false' });
    const repo = h('input', { type: 'text', value: g.repo, placeholder: 'wedding-invitation', autocapitalize: 'off', spellcheck: 'false' });
    const branch = h('input', { type: 'text', value: g.branch || 'main', autocapitalize: 'off', spellcheck: 'false' });
    const token = h('input', { type: 'password', value: g.token, placeholder: 'github_pat_… or ghp_…', autocomplete: 'off', spellcheck: 'false' });
    const result = h('div', { class: 'f-help' }, connected() ? 'Saved on this device.' : '');
    const save = async () => {
      st.gh = { owner: owner.value.trim(), repo: repo.value.trim().replace(/\.git$/, ''), branch: branch.value.trim() || 'main', token: token.value.trim() };
      LS.set('inv-gh', st.gh);
      updateStatus();
      if (!connected()) { result.innerHTML = '<span class="err-text">Fill in all fields first.</span>'; return; }
      result.textContent = 'Checking…';
      try {
        const info = await checkAccess();
        result.innerHTML = '<span class="ok-text">Connected to ' + S.esc(info.full_name) + '. Publishing works, you\'re all set.</span>';
        toast('Connected to GitHub');
      } catch (e) {
        result.innerHTML = '';
        append(result, e.problem ? accessHelp(e.problem) : h('span', { class: 'err-text' }, friendlyError(e)));
      }
    };
    const restoreIn = h('input', { type: 'file', accept: 'application/json,.json' });
    restoreIn.addEventListener('change', async () => {
      const f = restoreIn.files && restoreIn.files[0];
      if (!f) return;
      try {
        const data = JSON.parse(await f.text());
        if (!data || !data.couple || !data.settings) throw new Error('bad');
        st.content = data; changed(); renderForm(); toast('Backup loaded. Press Publish to put it live.');
      } catch (e) { toast('That file is not an invitation backup.', true); }
    });
    pane.innerHTML = '';
    append(pane, [
      h('div', { class: 'card' },
        h('h3', null, 'Connect GitHub'),
        h('p', null, 'This lets the Publish button save your changes to the live site. You only do this once per phone or computer.'),
        h('div', { class: 'row2' },
          h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'GitHub username'), owner),
          h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Repository name'), repo)),
        h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Access token'), token),
        h('details', { class: 'f' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--a)' }, 'How do I get a token?'),
          h('p', { class: 'f-help', style: 'margin-top:10px', html: '<b>Quickest:</b> sign in to GitHub as <b>@' + S.esc(g.owner || 'the repository owner') + '</b> and tap the button. The right permission is already ticked: choose an expiry date after the wedding, press <b>Generate token</b> at the bottom, copy the token (it starts with ghp_) and paste it above. It can change all your public repositories, so keep it private.' }),
          h('div', { class: 'btns', style: 'margin-top:8px' }, h('a', { class: 'btn ghost sm', href: classicTokenUrl(false), target: '_blank', rel: 'noopener' }, 'Make a token (1 click)')),
          h('p', { class: 'f-help', style: 'margin-top:14px', html: '<b>Safest:</b> a token that works only for this one repository.' }),
          h('ol', { class: 'steps' },
            h('li', { html: 'Open <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">github.com/settings/personal-access-tokens/new</a> (sign in if asked).' }),
            h('li', { html: '<b>Token name:</b> wedding editor. <b>Expiration:</b> pick a date after the wedding.' }),
            h('li', { html: '<b>Repository access:</b> choose <i>Only select repositories</i> and pick <b>' + S.esc(g.repo || 'your invitation repository') + '</b>. Not <i>Public repositories</i>: that one can only read.' }),
            h('li', { html: '<b>Permissions:</b> find <b>Contents</b> (tap <i>Add permissions</i> if it isn\'t listed) and set it to <b>Read and write</b>. It starts as <i>Read-only</i>, which is not enough to publish.' }),
            h('li', { html: 'Press <b>Generate token</b>, copy it, and paste it in the box above.' })),
          h('p', { class: 'f-help' }, 'The token is saved only on this device. Never share it with anyone. If you lose your phone, delete the token on GitHub.')),
        h('details', { class: 'f' }, h('summary', { style: 'cursor:pointer;font-weight:600;color:var(--muted)' }, 'Advanced'),
          h('div', { class: 'f' }, h('span', { class: 'f-label' }, 'Branch'), branch)),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn primary', onclick: save }, 'Save & check'),
          connected() ? h('button', { type: 'button', class: 'btn ghost', onclick: () => { st.gh.token = ''; LS.set('inv-gh', st.gh); renderSetup(); updateStatus(); toast('Token removed from this device'); } }, 'Forget token') : null),
        result),
      h('div', { class: 'card' },
        h('h3', null, 'Backup'),
        h('p', null, 'Keep a copy of all your text and settings, or bring an older copy back.'),
        h('div', { class: 'btns' },
          h('button', { type: 'button', class: 'btn ghost', onclick: downloadBackup }, 'Download backup'),
          h('label', { class: 'btn ghost file-btn' }, 'Restore a backup', restoreIn),
          h('button', { type: 'button', class: 'btn danger', onclick: async () => { if (!confirm('Throw away all changes that are not published yet?')) return; LS.del('inv-draft'); st.pending = {}; await load(true); toast('Back to the published version'); } }, 'Undo unpublished changes')))
    ]);
    if (checkNow && connected()) save();
  }

  /* ---------- load ---------- */
  function normalise(c) {
    c.settings = c.settings || {};
    c.settings.colors = Object.assign({}, S.THEMES.classic.colors, c.settings.colors || {});
    c.settings.music = c.settings.music || { enabled: true, src: 'assets/music/canon-in-d-musicbox.mp3', volume: 0.6 };
    ['couple', 'intro', 'hero', 'labels', 'share', 'events', 'reveal', 'countdown', 'families', 'photo', 'venue', 'menu', 'dressCode', 'gifts', 'rsvp', 'closing', 'custom'].forEach((k) => { c[k] = c[k] || {}; });
    if (!Array.isArray(c.custom.items)) c.custom.items = [];
    if (Array.isArray(c.dressCode.colors)) c.dressCode.colors = c.dressCode.colors.filter(Boolean).map((x) => (typeof x === 'object' ? x : newSwatch(x)));
    return c;
  }
  async function load(ignoreDraft) {
    let c = null;
    if (connected()) {
      try { const f = await gh(`/contents/content.json?ref=${encodeURIComponent(st.gh.branch || 'main')}`); c = JSON.parse(b64ToUtf8(f.content)); } catch (e) { if (e.status === 401) toast(friendlyError(e), true); }
    }
    if (!c) {
      try { const r = await fetch('content.json?v=' + Date.now(), { cache: 'no-store' }); if (r.ok) c = await r.json(); } catch (e) { /* offline */ }
    }
    if (!c) { $('#form').innerHTML = '<div class="card"><h3>Could not load your invitation</h3><p>Check your internet and refresh this page.</p></div>'; updateStatus('Offline'); return; }
    c = normalise(c);
    st.base = JSON.stringify(c);
    const draft = !ignoreDraft && LS.get('inv-draft', null);
    if (draft && draft.content && JSON.stringify(normalise(draft.content)) !== st.base) {
      st.content = normalise(draft.content);
      const b = $('#banner');
      b.innerHTML = '';
      append(b, [
        h('p', null, h('b', null, 'Unpublished changes restored. '), 'These were saved on this device ' + new Date(draft.at).toLocaleString() + '.'),
        h('div', { class: 'btns', style: 'margin:0' },
          h('button', { type: 'button', class: 'btn sm primary', onclick: () => { b.hidden = true; publish(); } }, 'Publish them'),
          h('button', { type: 'button', class: 'btn sm ghost', onclick: () => { st.content = JSON.parse(st.base); LS.del('inv-draft'); b.hidden = true; changed(); renderForm(); } }, 'Discard'))
      ]);
      b.hidden = false;
    } else {
      st.content = c;
      $('#banner').hidden = true;
    }
    st.dirty = JSON.stringify(st.content) !== st.base;
    document.body.classList.toggle('no-bn', !st.showBn);
    st.pvLang = st.content.settings.defaultLanguage === 'bn' ? 'bn' : 'en';
    $$('#pvLang button').forEach((x) => x.classList.toggle('on', x.dataset.lang === st.pvLang));
    renderForm();
    updateStatus();
    sendPreview();
  }

  window.InvEditor = { drawShareCard };
  load();
})();
