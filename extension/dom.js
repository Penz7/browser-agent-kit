// This single function is injected into pages with chrome.scripting.executeScript.
// It must be self-contained: no imports, no closures over module scope.
export function agentDom(action, args) {
  args = args || {};
  const w = window;
  const d = document;
  if (!w.__akRefs) w.__akRefs = { byRef: new Map(), byEl: new WeakMap(), n: 0 };
  const R = w.__akRefs;

  const INTERACTIVE = [
    'a[href]', 'button', 'input', 'select', 'textarea', 'summary', 'label[for]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
    '[role="menuitem"]', '[role="menuitemcheckbox"]', '[role="menuitemradio"]', '[role="option"]',
    '[role="switch"]', '[role="slider"]', '[role="combobox"]', '[role="textbox"]', '[role="searchbox"]',
    '[role="spinbutton"]', '[role="treeitem"]', '[contenteditable=""]', '[contenteditable="true"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])'
  ].join(',');
  const SKIP_TAGS = new Set(['script', 'style', 'noscript', 'template', 'svg', 'path', 'meta', 'link', 'head', 'br', 'hr']);
  const LANDMARKS = new Set(['nav', 'main', 'header', 'footer', 'aside', 'form', 'dialog', 'table', 'ul', 'ol', 'section', 'article', 'fieldset']);

  const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  const trunc = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
  const refFor = (el) => {
    let r = R.byEl.get(el);
    if (!r) { r = 'ref_' + (++R.n); R.byEl.set(el, r); R.byRef.set(r, el); }
    return r;
  };
  const elOf = (ref) => { const el = R.byRef.get(ref); return el && el.isConnected ? el : null; };
  const notFound = (ref) => ({ error: `${ref} not found or no longer on the page. Call read_page or find again to get fresh refs.` });

  const isHidden = (el) => {
    if (el.getAttribute('aria-hidden') === 'true') return true;
    const cs = getComputedStyle(el);
    return cs.display === 'none' || cs.visibility === 'hidden';
  };
  const hasBox = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < w.innerHeight && r.left < w.innerWidth;
  };
  const labelText = (el) => {
    if (el.labels && el.labels.length) return Array.from(el.labels).map((l) => l.innerText).join(' ');
    const lb = el.getAttribute('aria-labelledby');
    if (lb) return lb.split(/\s+/).map((id) => { const n = d.getElementById(id); return n ? n.innerText : ''; }).join(' ');
    return '';
  };
  const nameOf = (el) => {
    const tag = el.tagName.toLowerCase();
    const own = (tag === 'input' || tag === 'select' || tag === 'textarea')
      ? ((el.type === 'submit' || el.type === 'button' || el.type === 'reset') ? el.value : '')
      : el.innerText;
    return clean(el.getAttribute('aria-label') || labelText(el) || el.getAttribute('placeholder') ||
      el.getAttribute('title') || el.getAttribute('alt') || own || el.getAttribute('name') ||
      el.getAttribute('data-testid') || el.id || '');
  };
  const roleOf = (el) => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const tag = el.tagName.toLowerCase();
    if (tag === 'a') return 'link';
    if (tag === 'button' || tag === 'summary') return 'button';
    if (tag === 'select') return 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'label') return 'label';
    if (tag === 'input') {
      const t = (el.type || 'text').toLowerCase();
      return { checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button', reset: 'button', range: 'slider', file: 'file', number: 'spinbutton' }[t] || 'textbox';
    }
    if (/^h[1-6]$/.test(tag)) return tag;
    if (tag === 'img') return 'img';
    if (el.isContentEditable) return 'textbox';
    return 'clickable';
  };
  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const ref = refFor(el);
    const role = roleOf(el);
    const name = trunc(nameOf(el), 80);
    const extras = [];
    if ((tag === 'input' || tag === 'textarea' || tag === 'select') && el.value && el.type !== 'password' && el.type !== 'checkbox' && el.type !== 'radio') {
      extras.push(`value="${trunc(clean(el.value), 40)}"`);
    }
    if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) extras.push(el.checked ? 'checked' : 'unchecked');
    else if (el.hasAttribute('aria-checked')) extras.push(el.getAttribute('aria-checked') === 'true' ? 'checked' : 'unchecked');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') extras.push('disabled');
    if (tag === 'a' && el.href) extras.push(`href="${trunc(el.href, 60)}"`);
    if (el.hasAttribute('aria-expanded')) extras.push('expanded=' + el.getAttribute('aria-expanded'));
    if (el.hasAttribute('aria-selected') && el.getAttribute('aria-selected') === 'true') extras.push('selected');
    if (tag === 'input' && el.type && !['text', 'checkbox', 'radio', 'submit', 'button'].includes(el.type)) extras.push('type=' + el.type);
    if (!inView(el)) extras.push('offscreen');
    return `[${ref}] ${role} "${name}"${extras.length ? ' ' + extras.join(' ') : ''}`;
  };

  const snapshot = (mode, maxLines) => {
    const lines = [];
    let total = 0;
    const walk = (el, depth) => {
      if (lines.length >= maxLines) { total++; return; }
      if (el.nodeType !== 1) return;
      const tag = el.tagName.toLowerCase();
      if (SKIP_TAGS.has(tag) || isHidden(el)) return;
      const pad = '  '.repeat(depth);
      let emitted = false;
      const interactive = el.matches(INTERACTIVE) && hasBox(el);
      if (interactive) {
        lines.push(pad + describe(el));
        emitted = true;
        total++;
      } else if (mode !== 'interactive') {
        if (/^h[1-6]$/.test(tag)) { lines.push(`${pad}${tag} "${trunc(clean(el.innerText), 100)}"`); emitted = true; }
        else if (tag === 'img' && el.alt) { lines.push(`${pad}img "${trunc(clean(el.alt), 60)}"`); emitted = true; }
        else if (LANDMARKS.has(tag) || el.getAttribute('role')) { lines.push(`${pad}${el.getAttribute('role') || tag}${el.getAttribute('aria-label') ? ' "' + trunc(clean(el.getAttribute('aria-label')), 60) + '"' : ''}`); emitted = true; }
        else {
          const direct = clean(Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' '));
          if (direct) { lines.push(`${pad}text "${trunc(direct, 120)}"`); emitted = true; }
        }
        if (emitted) total++;
      }
      if (interactive && ['a', 'button', 'select', 'textarea', 'input', 'summary'].includes(tag)) return;
      for (const c of el.children) walk(c, depth + (emitted ? 1 : 0));
    };
    if (d.body) walk(d.body, 0);
    return {
      url: location.href,
      title: d.title,
      lines,
      truncated: lines.length >= maxLines,
      iframes: d.querySelectorAll('iframe').length,
      viewport: { width: w.innerWidth, height: w.innerHeight },
      scroll: { x: Math.round(w.scrollX), y: Math.round(w.scrollY), pageHeight: d.documentElement.scrollHeight }
    };
  };

  const center = (el) => {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
  };

  const setNativeValue = (el, value) => {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype
      : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value); else el.value = value;
  };
  const fire = (el, type, init) => el.dispatchEvent(new (type === 'input' ? InputEvent : Event)(type, { bubbles: true, cancelable: true, ...(init || {}) }));

  switch (action) {
    case 'snapshot':
      return snapshot(args.mode || 'full', args.maxLines || 600);

    case 'resolve': {
      const el = elOf(args.ref);
      if (!el) return notFound(args.ref);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const c = center(el);
      const top = d.elementFromPoint(c.x, c.y);
      const covered = !!(top && top !== el && !el.contains(top) && !top.contains(el));
      return { ...c, covered, tag: el.tagName.toLowerCase(), name: trunc(nameOf(el), 60) };
    }

    case 'find': {
      const q = clean(args.query).toLowerCase();
      const toks = q.split(' ').filter(Boolean);
      const limit = args.limit || 10;
      const cands = Array.from(d.querySelectorAll(INTERACTIVE + ',h1,h2,h3,h4,h5,h6,img,[role]'))
        .filter((el) => !SKIP_TAGS.has(el.tagName.toLowerCase()) && !isHidden(el) && hasBox(el));
      const scored = [];
      for (const el of cands) {
        const name = nameOf(el).toLowerCase();
        const hay = [name, roleOf(el), el.tagName.toLowerCase(), el.id, typeof el.className === 'string' ? el.className : '',
          el.getAttribute('href'), el.getAttribute('type'), el.getAttribute('data-testid'), el.getAttribute('placeholder')]
          .filter(Boolean).join(' ').toLowerCase();
        let s = 0;
        if (name === q) s += 20;
        if (hay.includes(q)) s += 10;
        for (const t of toks) if (hay.includes(t)) s += 3;
        if (s > 0) { if (inView(el)) s += 1; scored.push({ s, el }); }
      }
      scored.sort((a, b) => b.s - a.s);
      return { url: location.href, matches: scored.slice(0, limit).map(({ s, el }) => ({ score: s, line: describe(el) })) };
    }

    case 'text': {
      const t = d.body ? d.body.innerText : '';
      const offset = args.offset || 0;
      const limit = args.limit || 20000;
      return { url: location.href, title: d.title, total: t.length, offset, text: t.slice(offset, offset + limit) };
    }

    case 'formInput': {
      const results = [];
      for (const f of args.fields || []) {
        const el = elOf(f.ref);
        if (!el) { results.push({ ref: f.ref, error: notFound(f.ref).error }); continue; }
        try {
          el.scrollIntoView({ block: 'center', behavior: 'instant' });
          el.focus();
          const tag = el.tagName.toLowerCase();
          const v = f.value;
          if (tag === 'input' && (el.type === 'checkbox' || el.type === 'radio')) {
            const want = v === true || v === 'true' || v === 1 || v === '1' || v === 'checked' || v === 'on';
            if (el.checked !== want) el.click();
          } else if (tag === 'select') {
            const opts = Array.from(el.options);
            const sv = String(v).toLowerCase();
            const opt = opts.find((o) => o.value === String(v)) || opts.find((o) => clean(o.textContent).toLowerCase() === sv) || opts.find((o) => clean(o.textContent).toLowerCase().includes(sv));
            if (!opt) throw new Error(`No option matching "${v}". Options: ${opts.map((o) => o.textContent.trim()).slice(0, 20).join(' | ')}`);
            setNativeValue(el, opt.value);
            fire(el, 'input'); fire(el, 'change');
          } else if (tag === 'input' || tag === 'textarea') {
            setNativeValue(el, String(v));
            fire(el, 'input', { inputType: 'insertText', data: String(v) }); fire(el, 'change');
          } else if (el.isContentEditable) {
            el.textContent = String(v);
            fire(el, 'input', { inputType: 'insertText', data: String(v) });
          } else {
            throw new Error(`${f.ref} (${tag}) is not a form control`);
          }
          results.push({ ref: f.ref, ok: true, name: trunc(nameOf(el), 40) });
        } catch (e) {
          results.push({ ref: f.ref, error: e.message });
        }
      }
      return { results };
    }

    case 'markUpload': {
      let el = elOf(args.ref);
      if (!el) return notFound(args.ref);
      if (!(el.tagName === 'INPUT' && el.type === 'file')) {
        const inner = el.querySelector('input[type=file]');
        if (inner) el = inner;
        else if (el.id) { const l = d.querySelector(`input[type=file][aria-labelledby~="${el.id}"]`); if (l) el = l; }
      }
      if (!(el.tagName === 'INPUT' && el.type === 'file')) {
        const any = d.querySelector('input[type=file]');
        if (!any) return { error: `${args.ref} is not a file input and no <input type=file> exists on the page.` };
        el = any;
      }
      el.setAttribute('data-ak-upload', '1');
      return { ok: true };
    }

    case 'unmarkUpload':
      d.querySelectorAll('[data-ak-upload]').forEach((e) => e.removeAttribute('data-ak-upload'));
      return { ok: true };

    case 'scrollInfo':
      return { scrollX: Math.round(w.scrollX), scrollY: Math.round(w.scrollY), pageHeight: d.documentElement.scrollHeight, viewportHeight: w.innerHeight };

    default:
      return { error: 'Unknown DOM action: ' + action };
  }
}
