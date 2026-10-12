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
      if (SKIP_TAGS.has(tag) || el.id === OVERLAY_ID || isHidden(el)) return;
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

  const OVERLAY_ID = '__ak_overlay_host';
  const withOverlayHidden = (fn) => {
    const host = d.getElementById(OVERLAY_ID);
    const prev = host ? host.style.display : null;
    if (host) host.style.display = 'none';
    try { return fn(); } finally { if (host) host.style.display = prev; }
  };
  const modsOf = (m) => {
    const t = String(m || '').toLowerCase();
    return { ctrlKey: /ctrl|control/.test(t), shiftKey: /shift/.test(t), altKey: /alt|option/.test(t), metaKey: /meta|cmd|command|super/.test(t) };
  };
  const keyEvent = (el, type, key, code, keyCode) =>
    el.dispatchEvent(new KeyboardEvent(type, { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true, composed: true }));

  switch (action) {
    case 'click': {
      let el = null;
      let x = args.x;
      let y = args.y;
      if (args.ref) {
        el = elOf(args.ref);
        if (!el) return notFound(args.ref);
        el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
        const c = center(el);
        x = c.x; y = c.y;
      }
      if (typeof x !== 'number' || typeof y !== 'number') return { error: 'click needs a ref or x/y' };
      const top = withOverlayHidden(() => d.elementFromPoint(x, y));
      const target = el ? ((top && el.contains(top)) ? top : el) : top;
      if (!target) return { error: `Nothing is rendered at (${Math.round(x)}, ${Math.round(y)}). Take a screenshot and try again.` };
      const covered = !!(el && top && !el.contains(top) && !top.contains(el));
      const button = args.button === 'right' ? 2 : args.button === 'middle' ? 1 : 0;
      const base = { bubbles: true, cancelable: true, composed: true, view: w, clientX: x, clientY: y, screenX: x, screenY: y, button, ...modsOf(args.modifiers) };
      const PE = w.PointerEvent || MouseEvent;
      const pe = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
      const fireAt = (type, Ctor, extra) => target.dispatchEvent(new Ctor(type, { ...base, ...extra }));
      fireAt('pointerover', PE, pe); fireAt('mouseover', MouseEvent, {});
      fireAt('pointermove', PE, pe); fireAt('mousemove', MouseEvent, {});
      const n = args.clickCount || 1;
      for (let i = 1; i <= n; i++) {
        fireAt('pointerdown', PE, { ...pe, buttons: 1, detail: i });
        const proceed = fireAt('mousedown', MouseEvent, { buttons: 1, detail: i });
        if (i === 1 && proceed) {
          const f = target.closest('input,textarea,select,button,a[href],[tabindex],[contenteditable]') || target;
          try { f.focus({ preventScroll: true }); } catch { /* not focusable */ }
        }
        fireAt('pointerup', PE, { ...pe, detail: i }); fireAt('mouseup', MouseEvent, { detail: i });
        if (button === 2) fireAt('contextmenu', MouseEvent, { detail: i });
        else if (button === 0) { fireAt('click', MouseEvent, { detail: i }); if (i === 2) fireAt('dblclick', MouseEvent, { detail: 2 }); }
        else fireAt('auxclick', MouseEvent, { detail: i });
      }
      const tag = target.tagName.toLowerCase();
      const hint = tag === 'select' || target.closest('select') ? 'Native <select> menus cannot open from synthetic clicks; use form_input to choose an option.' : undefined;
      return { x, y, covered, tag, name: trunc(nameOf(el || target), 60), hint };
    }

    case 'typeText': {
      const ae = d.activeElement;
      const tag = ae ? ae.tagName : '';
      const editable = !!ae && (ae.isContentEditable || tag === 'TEXTAREA' ||
        (tag === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'range', 'color', 'image'].includes((ae.type || 'text').toLowerCase())));
      if (!editable) return { fallback: true };
      const text = String(args.text);
      for (const part of text.split(/(\r\n|\r|\n)/)) {
        if (!part) continue;
        if (/^(\r\n|\r|\n)$/.test(part)) {
          if (tag === 'TEXTAREA') { if (!d.execCommand('insertText', false, '\n')) { setNativeValue(ae, ae.value + '\n'); fire(ae, 'input'); } }
          else if (ae.isContentEditable) { if (!d.execCommand('insertParagraph')) d.execCommand('insertText', false, '\n'); }
          else {
            const proceed = keyEvent(ae, 'keydown', 'Enter', 'Enter', 13);
            keyEvent(ae, 'keypress', 'Enter', 'Enter', 13);
            keyEvent(ae, 'keyup', 'Enter', 'Enter', 13);
            if (proceed && ae.form) { if (ae.form.requestSubmit) ae.form.requestSubmit(); else ae.form.submit(); }
          }
          continue;
        }
        let ok = false;
        try { ok = d.execCommand('insertText', false, part); } catch { ok = false; }
        if (!ok) {
          if (ae.isContentEditable) { ae.textContent += part; fire(ae, 'input', { inputType: 'insertText', data: part }); }
          else { setNativeValue(ae, (ae.value || '') + part); fire(ae, 'input', { inputType: 'insertText', data: part }); }
        }
      }
      return { typed: text.length, into: trunc(nameOf(ae), 40) || tag.toLowerCase() };
    }

    case 'scroll': {
      let x = args.x;
      let y = args.y;
      if (args.ref) {
        const el = elOf(args.ref);
        if (!el) return notFound(args.ref);
        el.scrollIntoView({ block: 'center', behavior: 'instant' });
        const c = center(el); x = c.x; y = c.y;
      }
      if (typeof x !== 'number' || typeof y !== 'number') { x = w.innerWidth / 2; y = w.innerHeight / 2; }
      const dx = args.dx || 0;
      const dy = args.dy || 0;
      let scroller = null;
      for (let n = withOverlayHidden(() => d.elementFromPoint(x, y)); n && n !== d.body && n !== d.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        const canY = /(auto|scroll|overlay)/.test(cs.overflowY) && n.scrollHeight > n.clientHeight + 1;
        const canX = /(auto|scroll|overlay)/.test(cs.overflowX) && n.scrollWidth > n.clientWidth + 1;
        if ((dy && canY) || (dx && canX)) { scroller = n; break; }
      }
      if (scroller) scroller.scrollBy({ left: dx, top: dy, behavior: 'instant' }); else w.scrollBy({ left: dx, top: dy, behavior: 'instant' });
      return { scrollX: Math.round(w.scrollX), scrollY: Math.round(w.scrollY), pageHeight: d.documentElement.scrollHeight, viewportHeight: w.innerHeight, viewportWidth: w.innerWidth, scroller: scroller ? scroller.tagName.toLowerCase() : 'window' };
    }

    case 'overlay': {
      let host = d.getElementById(OVERLAY_ID);
      if (args.state === 'hide') { if (host) host.remove(); return { ok: true }; }
      if (!host) {
        host = d.createElement('div');
        host.id = OVERLAY_ID;
        host.setAttribute('aria-hidden', 'true');
        host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
        const sh = host.attachShadow({ mode: 'open' });
        sh.innerHTML = '<style>' +
          '.frame{position:fixed;inset:0;border:3px solid #7c5cff;box-shadow:inset 0 0 28px rgba(124,92,255,.45);pointer-events:none;animation:akp 1.8s ease-in-out infinite}' +
          '@keyframes akp{0%,100%{opacity:.5}50%{opacity:1}}' +
          '.bar{position:fixed;top:0;left:50%;transform:translateX(-50%);background:#1d1933;color:#fff;font:12px/1.4 system-ui,sans-serif;padding:5px 12px;border-radius:0 0 10px 10px;display:flex;gap:10px;align-items:center;pointer-events:auto;box-shadow:0 2px 10px rgba(0,0,0,.35);max-width:70vw}' +
          '.bar b{color:#c9b8ff;white-space:nowrap}.msg{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          'button{all:initial;cursor:pointer;background:#ff5370;color:#fff;font:600 12px system-ui,sans-serif;padding:3px 10px;border-radius:6px}' +
          '.ring{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border:3px solid #ffd166;border-radius:50%;pointer-events:none;animation:akr .7s ease-out forwards}' +
          '@keyframes akr{from{transform:scale(.4);opacity:1}to{transform:scale(1.7);opacity:0}}' +
          '</style><div class="frame"></div><div class="bar"><b></b><span class="msg"></span><button>Dừng</button></div>';
        sh.querySelector('button').onclick = () => {
          try { chrome.runtime.sendMessage({ type: 'agent-stop' }); } catch { /* no runtime */ }
          sh.querySelector('.msg').textContent = 'Đã dừng. Mở popup extension để tiếp tục.';
        };
        (d.body || d.documentElement).appendChild(host);
      }
      host.shadowRoot.querySelector('b').textContent = args.agent || 'AI agent';
      if (args.text != null) host.shadowRoot.querySelector('.msg').textContent = args.text;
      if (typeof args.x === 'number' && typeof args.y === 'number') {
        const ring = d.createElement('div');
        ring.className = 'ring';
        ring.style.left = args.x + 'px';
        ring.style.top = args.y + 'px';
        host.shadowRoot.appendChild(ring);
        setTimeout(() => ring.remove(), 800);
      }
      return { ok: true };
    }

    case 'snapshot':
      return snapshot(args.mode || 'full', args.maxLines || 600);

    case 'resolve': {
      const el = elOf(args.ref);
      if (!el) return notFound(args.ref);
      el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      const c = center(el);
      const top = withOverlayHidden(() => d.elementFromPoint(c.x, c.y));
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
      return { scrollX: Math.round(w.scrollX), scrollY: Math.round(w.scrollY), pageHeight: d.documentElement.scrollHeight, viewportHeight: w.innerHeight, viewportWidth: w.innerWidth };

    default:
      return { error: 'Unknown DOM action: ' + action };
  }
}
