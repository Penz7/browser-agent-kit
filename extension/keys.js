// Maps xdotool-style key names ("ctrl+shift+t", "Return", "cmd+a") to CDP Input.dispatchKeyEvent params.
export const MOD = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

const ALIASES = {
  control: 'ctrl', cmd: 'meta', command: 'meta', super: 'meta', win: 'meta', option: 'alt',
  return: 'enter', esc: 'escape', del: 'delete', pgup: 'pageup', pgdn: 'pagedown',
  up: 'arrowup', down: 'arrowdown', left: 'arrowleft', right: 'arrowright', spacebar: 'space',
  bksp: 'backspace', ins: 'insert'
};

const SPECIAL = {
  enter: { key: 'Enter', code: 'Enter', vk: 13, text: '\r' },
  tab: { key: 'Tab', code: 'Tab', vk: 9 },
  escape: { key: 'Escape', code: 'Escape', vk: 27 },
  backspace: { key: 'Backspace', code: 'Backspace', vk: 8 },
  delete: { key: 'Delete', code: 'Delete', vk: 46 },
  insert: { key: 'Insert', code: 'Insert', vk: 45 },
  space: { key: ' ', code: 'Space', vk: 32, text: ' ' },
  arrowup: { key: 'ArrowUp', code: 'ArrowUp', vk: 38 },
  arrowdown: { key: 'ArrowDown', code: 'ArrowDown', vk: 40 },
  arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', vk: 37 },
  arrowright: { key: 'ArrowRight', code: 'ArrowRight', vk: 39 },
  home: { key: 'Home', code: 'Home', vk: 36 },
  end: { key: 'End', code: 'End', vk: 35 },
  pageup: { key: 'PageUp', code: 'PageUp', vk: 33 },
  pagedown: { key: 'PageDown', code: 'PageDown', vk: 34 },
  capslock: { key: 'CapsLock', code: 'CapsLock', vk: 20 }
};
for (let i = 1; i <= 12; i++) SPECIAL['f' + i] = { key: 'F' + i, code: 'F' + i, vk: 111 + i };

const PUNCT = {
  '-': { code: 'Minus', vk: 189 }, '=': { code: 'Equal', vk: 187 },
  '[': { code: 'BracketLeft', vk: 219 }, ']': { code: 'BracketRight', vk: 221 },
  '\\': { code: 'Backslash', vk: 220 }, ';': { code: 'Semicolon', vk: 186 },
  "'": { code: 'Quote', vk: 222 }, ',': { code: 'Comma', vk: 188 },
  '.': { code: 'Period', vk: 190 }, '/': { code: 'Slash', vk: 191 }, '`': { code: 'Backquote', vk: 192 }
};
const SHIFTED = {
  '!': '1', '@': '2', '#': '3', '$': '4', '%': '5', '^': '6', '&': '7', '*': '8', '(': '9', ')': '0',
  '_': '-', '+': '=', '{': '[', '}': ']', '|': '\\', ':': ';', '"': "'", '<': ',', '>': '.', '?': '/', '~': '`'
};

export function describeKey(name) {
  let n = name.length === 1 ? name : name.toLowerCase();
  n = ALIASES[n] || n;
  if (SPECIAL[n]) return { ...SPECIAL[n], shift: false };
  if (n.length === 1) {
    let shift = false;
    let base = n;
    if (SHIFTED[n]) { shift = true; base = SHIFTED[n]; }
    else if (/[A-Z]/.test(n)) { base = n.toLowerCase(); } // "A" in a combo means the a key
    if (/[a-z]/.test(base)) return { key: base, code: 'Key' + base.toUpperCase(), vk: base.toUpperCase().charCodeAt(0), text: base, shift };
    if (/[0-9]/.test(base)) return { key: n, code: 'Digit' + base, vk: base.charCodeAt(0), text: n, shift };
    if (PUNCT[base]) return { key: n, ...PUNCT[base], text: n, shift };
  }
  throw new Error(`Unknown key: "${name}". Use names like Enter, Tab, Escape, ArrowDown, ctrl+a, cmd+shift+t.`);
}

export function parseModifiers(str) {
  let mods = 0;
  for (const part of String(str || '').split('+')) {
    const p = part.trim().toLowerCase();
    if (!p) continue;
    const m = ALIASES[p] || p;
    if (MOD[m] === undefined) throw new Error(`Unknown modifier: ${part}`);
    mods |= MOD[m];
  }
  return mods;
}

export function parseCombo(combo) {
  const parts = String(combo).split('+').map((s) => s.trim()).filter(Boolean);
  if (combo.endsWith('+') ) parts.push('='); // "ctrl++" means ctrl and plus
  let modifiers = 0;
  let main = null;
  for (const p of parts) {
    const l = ALIASES[p.toLowerCase()] || p.toLowerCase();
    if (MOD[l] !== undefined) modifiers |= MOD[l];
    else main = p;
  }
  if (!main) throw new Error(`No key in combo: ${combo}`);
  const key = describeKey(main);
  if (key.shift) modifiers |= MOD.shift;
  if ((modifiers & MOD.shift) && /^[a-z]$/.test(key.key)) {
    key.key = key.key.toUpperCase();
    key.text = key.key;
  }
  return { modifiers, key };
}

// macOS needs editing commands for cmd shortcuts dispatched through CDP.
export function macCommand(modifiers, key) {
  if (!(modifiers & MOD.meta)) return undefined;
  const k = key.key.toLowerCase();
  if (k === 'z' && (modifiers & MOD.shift)) return ['redo'];
  const map = { a: 'selectAll', c: 'copy', v: 'paste', x: 'cut', z: 'undo' };
  return map[k] ? [map[k]] : undefined;
}
