// Unit tests for the injected DOM function and key mapping, run under jsdom.
import { JSDOM } from 'jsdom';
import { agentDom } from '../../extension/dom.js';
import { parseCombo, parseModifiers, macCommand, MOD } from '../../extension/keys.js';
import { hostAllowed } from '../../extension/settings.js';
import { parseRef, prefixRef, prefixLines, buildFrameTree, childFrameId, toMainCoords } from '../../extension/frames.js';
import { GIFEncoder, quantize, applyPalette } from '../../extension/vendor/gifenc.js';

function assert(cond, msg) { if (!cond) { console.error('FAIL:', msg); process.exit(1); } console.log('ok -', msg); }

const dom = new JSDOM(`<!doctype html><html><head><title>T</title></head><body>
  <nav><a href="/home">Home</a><a href="/about" aria-label="About us">x</a></nav>
  <h1>Welcome</h1>
  <p>Intro text <b>bold</b></p>
  <form>
    <label for="email">Email</label><input id="email" type="text">
    <input type="password" placeholder="Password">
    <select id="country"><option value="vn">Vietnam</option><option value="us">United States</option></select>
    <input type="checkbox" id="agree"><label for="agree">I agree</label>
    <div contenteditable="true" id="note"></div>
    <button type="submit">Sign in</button>
  </form>
  <div style="display:none"><button>Hidden</button></div>
  <script>var x=1</script>
</body></html>`, { url: 'https://example.com/login', pretendToBeVisual: true });

global.window = dom.window;
global.document = dom.window.document;
global.getComputedStyle = dom.window.getComputedStyle;
global.HTMLTextAreaElement = dom.window.HTMLTextAreaElement;
global.HTMLSelectElement = dom.window.HTMLSelectElement;
global.HTMLInputElement = dom.window.HTMLInputElement;
global.InputEvent = dom.window.InputEvent || dom.window.Event;
global.Event = dom.window.Event;
global.location = dom.window.location;
// jsdom has no layout: pretend every element is a 100x20 box at (10,10) and innerText = textContent.
dom.window.Element.prototype.getBoundingClientRect = function () { return { left: 10, top: 10, right: 110, bottom: 30, width: 100, height: 20 }; };
dom.window.Element.prototype.scrollIntoView = function () {};
dom.window.document.elementFromPoint = () => null;
Object.defineProperty(dom.window.HTMLElement.prototype, 'innerText', { get() { return this.textContent; }, configurable: true });

const snap = agentDom('snapshot', { mode: 'full' });
const text = snap.lines.join('\n');
assert(snap.title === 'T' && snap.url === 'https://example.com/login', 'snapshot reports url and title');
assert(text.includes('link "Home"'), 'links get a ref and name');
assert(text.includes('link "About us"'), 'aria-label wins over inner text');
assert(text.includes('h1 "Welcome"'), 'headings are listed in full mode');
assert(text.includes('textbox "Email"'), 'input is named by its <label for>');
assert(text.includes('textbox "Password" type=password'), 'password placeholder used as name, no value shown');
assert(text.includes('combobox "Country"') || text.includes('combobox "country"') || /combobox "/.test(text), 'select appears as combobox');
assert(text.includes('checkbox "I agree" unchecked'), 'checkbox reports checked state');
assert(text.includes('button "Sign in"'), 'submit button listed');
assert(!text.includes('Hidden'), 'display:none subtree is skipped');
assert(!text.includes('var x'), 'script content is skipped');

const inter = agentDom('snapshot', { mode: 'interactive' });
assert(inter.lines.every((l) => l.trim().startsWith('[ref_')), 'interactive mode lists only ref lines');

const found = agentDom('find', { query: 'sign in button' });
assert(found.matches.length && found.matches[0].line.includes('button "Sign in"'), 'find ranks the sign-in button first');

const signRef = found.matches[0].line.match(/\[(ref_\d+)\]/)[1];
const res = agentDom('resolve', { ref: signRef });
assert(res.x === 60 && res.y === 20 && res.tag === 'button', 'resolve returns element center');
assert(agentDom('resolve', { ref: 'ref_999' }).error.includes('not found'), 'resolve on unknown ref gives a helpful error');

const refOf = (needle) => text.split('\n').find((l) => l.includes(needle)).match(/\[(ref_\d+)\]/)[1];
let inputEvents = 0;
document.getElementById('email').addEventListener('input', () => inputEvents++);
const fi = agentDom('formInput', { fields: [
  { ref: refOf('textbox "Email"'), value: 'a@b.c' },
  { ref: refOf('combobox'), value: 'United States' },
  { ref: refOf('checkbox'), value: true },
  { ref: signRef, value: 'nope' }
] });
assert(document.getElementById('email').value === 'a@b.c' && inputEvents === 1, 'formInput sets text value and fires input event');
assert(document.getElementById('country').value === 'us', 'formInput selects option by label');
assert(document.getElementById('agree').checked === true, 'formInput checks checkbox');
assert(fi.results[3].error && fi.results[3].error.includes('not a form control'), 'formInput reports non-form targets');

const pt = agentDom('text', { offset: 0, limit: 7 });
assert(pt.text.length === 7 && pt.total > 7, 'text supports offset/limit');

// fast-path click: synthetic events + focus + activation
global.PointerEvent = dom.window.PointerEvent || dom.window.MouseEvent;
global.MouseEvent = dom.window.MouseEvent;
global.KeyboardEvent = dom.window.KeyboardEvent;
const seen = [];
const btn = document.querySelector('button[type=submit]');
for (const t of ['mousedown', 'mouseup', 'click']) btn.addEventListener(t, (e) => seen.push(t + ':' + e.clientX));
dom.window.document.elementFromPoint = (x, y) => (x === 60 && y === 20 ? btn : null);
let ck = agentDom('click', { ref: signRef, button: 'left', clickCount: 1 });
assert(!ck.error && seen.join(',') === 'mousedown:60,mouseup:60,click:60', 'fast click fires mousedown/mouseup/click at element center');
assert(ck.name === 'Sign in' && ck.covered === false, 'fast click reports target name');
let agreeClicks = 0;
document.getElementById('agree').checked = false;
document.getElementById('agree').addEventListener('click', () => agreeClicks++);
dom.window.document.elementFromPoint = () => document.getElementById('agree');
agentDom('click', { ref: refOf('checkbox'), clickCount: 1 });
assert(agreeClicks === 1 && document.getElementById('agree').checked === true, 'synthetic click toggles a checkbox (activation behavior)');
dom.window.document.elementFromPoint = () => null;
ck = agentDom('click', { x: 5, y: 5 });
assert(ck.error && /Nothing is rendered/.test(ck.error), 'click on empty point gives a helpful error');

// fast-path typing (jsdom has no execCommand -> exercises the fallback branch)
const email = document.getElementById('email');
email.value = '';
email.focus();
let inputs = 0;
email.addEventListener('input', () => inputs++);
let tr = agentDom('typeText', { text: 'hi' });
assert(!tr.fallback && email.value === 'hi' && inputs === 1 && tr.into === 'Email', 'typeText appends into focused input and fires input');
let submitted = 0;
email.form.requestSubmit = () => submitted++;
agentDom('typeText', { text: '\n' });
assert(submitted === 1, 'Enter in a text input submits its form');
btn.focus();
tr = agentDom('typeText', { text: 'x' });
assert(tr.fallback === true, 'typeText reports fallback when nothing editable is focused');

// scroll
let scrolled = null;
dom.window.scrollBy = (o) => { scrolled = scrolled ? { left: scrolled.left + o.left, top: scrolled.top + o.top } : { ...o }; };
dom.window.document.elementFromPoint = () => null;
const sc = await agentDom('scroll', { dx: 0, dy: 300 });
assert(scrolled && scrolled.top === 300 && scrolled.left === 0 && sc.scroller === 'window', 'animated scroll adds up to the requested distance on window.scrollBy');

// frames: pure helpers
assert(parseRef('f12_ref_3').frameId === 12 && parseRef('f12_ref_3').ref === 'ref_3' && parseRef('ref_3').frameId === 0, 'parseRef splits frame-qualified refs');
assert(prefixRef('ref_3', 12) === 'f12_ref_3' && prefixRef('ref_3', 0) === 'ref_3', 'prefixRef qualifies refs only for child frames');
assert(prefixLines(['[ref_1] button "Go"'], 7)[0] === '[f7_ref_1] button "Go"', 'prefixLines rewrites ref markers');
const tree = buildFrameTree([
  { frameId: 0, path: [], containers: [{ x: 100, y: 200, w: 300, h: 150, hidden: false }, { x: 0, y: 0, w: 0, h: 0, hidden: true }] },
  { frameId: 5, path: [0], containers: [{ x: 10, y: 20, w: 50, h: 50, hidden: false }] },
  { frameId: 9, path: [0, 0], containers: [] },
  { frameId: 6, path: [1], containers: [] }
]);
assert(tree.get(5).offset.x === 100 && tree.get(5).offset.y === 200 && tree.get(5).visible, 'child frame offset comes from its container');
assert(tree.get(9).offset.x === 110 && tree.get(9).offset.y === 220 && tree.get(9).depth === 2 && tree.get(9).parentId === 5, 'nested frame offsets accumulate');
assert(tree.get(6).visible === false, 'hidden container marks its frame invisible');
assert(childFrameId(tree, 0, 0) === 5 && childFrameId(tree, 5, 0) === 9 && childFrameId(tree, 0, 3) === null, 'childFrameId maps container index to frame id');
assert(toMainCoords(tree, 9, { x: 1, y: 2 }).x === 111 && toMainCoords(tree, 0, { x: 1, y: 2 }).x === 1, 'toMainCoords adds the frame offset');

// frames: in-page info (jsdom is a top-level window)
const finfo = agentDom('frameInfo', {});
assert(Array.isArray(finfo.path) && finfo.path.length === 0 && Array.isArray(finfo.containers) && finfo.viewport.width > 0, 'frameInfo reports an empty path for the top frame');

// uploadLike
document.body.insertAdjacentHTML('beforeend', '<div id="up"><button id="upbtn">Upload photo</button><input type="file" id="fileinp"></div><button id="plain">Plain</button>');
const upText = agentDom('snapshot', { mode: 'interactive', maxLines: 100 }).lines.join('\n');
const upRef = /\[(ref_\d+)\] button "Upload photo"/.exec(upText)[1];
const plainRef = /\[(ref_\d+)\] button "Plain"/.exec(upText)[1];
assert(agentDom('uploadLike', { ref: upRef }).upload === true, 'uploadLike recognises an upload button next to a file input');
assert(agentDom('uploadLike', { ref: plainRef }).upload === false, 'uploadLike ignores ordinary buttons');
document.getElementById('up').remove(); document.getElementById('plain').remove();

// vendored gif encoder: the exact calls background.js makes
{
  const w = 4, h = 3, px = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < px.length; i += 4) { px[i] = i % 255; px[i + 1] = 100; px[i + 2] = 200; px[i + 3] = 255; }
  const gif = GIFEncoder();
  for (let i = 0; i < 2; i++) {
    const palette = quantize(px, 256, { format: 'rgb444' });
    gif.writeFrame(applyPalette(px, palette, 'rgb444'), w, h, { palette, delay: 300, first: i === 0, repeat: 0 });
  }
  gif.finish();
  const bytes = gif.bytes();
  assert(String.fromCharCode(...bytes.subarray(0, 6)) === 'GIF89a' && bytes[bytes.length - 1] === 0x3b, 'gifenc produces a GIF89a stream from RGBA frames');
}

// probe (wait_for)
assert(agentDom('probe', { text: 'sign IN' }).found === true, 'probe finds visible text case-insensitively');
assert(agentDom('probe', { text: 'no such text zzz' }).found === false, 'probe reports missing text');
assert(agentDom('probe', { selector: 'button' }).found === true, 'probe finds a visible element by selector');
assert(agentDom('probe', { selector: '#nope' }).found === false, 'probe reports a missing selector');
assert(/Bad selector/.test(agentDom('probe', { selector: '[[' }).error || ''), 'probe reports an invalid selector');

// overlay
global.chrome = { runtime: { sendMessage() {} } };
agentDom('overlay', { state: 'show', text: 'Đọc trang', agent: 'Codex', x: 10, y: 10 });
const host = document.getElementById('__ak_overlay_host');
assert(host && host.shadowRoot.querySelector('.msg').textContent === 'Đọc trang', 'overlay shows status text in a shadow root');
const cur = host.shadowRoot.querySelector('.cur');
assert(cur && cur.style.display === 'block' && cur.style.left === '10px', 'overlay shows the virtual cursor at the action point');
agentDom('overlay', { state: 'show', x: 50, y: 60, ring: false });
assert(cur.style.left === '50px' && cur.style.top === '60px', 'cursor moves to the next point');
agentDom('overlay', { state: 'suspend' });
assert(host.style.display === 'none', 'suspend hides the overlay for screenshots');
agentDom('overlay', { state: 'resume' });
assert(host.style.display === '' && cur.style.left === '50px', 'resume restores the overlay with the cursor where it was');
agentDom('overlay', { state: 'hide' });
assert(!agentDom('snapshot', { mode: 'full' }).lines.join('\n').includes('ak_overlay'), 'overlay host is excluded from read_page');
agentDom('overlay', { state: 'hide' });
assert(!document.getElementById('__ak_overlay_host'), 'overlay hide removes the host');

// keys
let k = parseCombo('ctrl+shift+t');
assert(k.modifiers === (MOD.ctrl | MOD.shift) && k.key.code === 'KeyT', 'parseCombo handles ctrl+shift+t');
k = parseCombo('Return');
assert(k.key.key === 'Enter' && k.key.text === '\r', 'Return maps to Enter');
k = parseCombo('cmd+a');
assert(k.modifiers === MOD.meta && macCommand(k.modifiers, k.key)[0] === 'selectAll', 'cmd+a yields selectAll command for macOS');
k = parseCombo('?');
assert(k.modifiers === MOD.shift && k.key.code === 'Slash' && k.key.text === '?', 'shifted punctuation implies shift');
k = parseCombo('shift+a');
assert(k.key.text === 'A', 'shift+a types uppercase A');
assert(parseModifiers('ctrl+shift') === (MOD.ctrl | MOD.shift), 'parseModifiers');
let threw = false; try { parseCombo('banana'); } catch { threw = true; }
assert(threw, 'unknown key names throw');

// allowlist
const allowAll = { allowAll: true, allowedSites: [] };
assert(hostAllowed('https://x.com/', allowAll) && hostAllowed('about:blank', allowAll), 'allowAll permits http(s) and about:blank');
assert(!hostAllowed('file:///etc/passwd', allowAll) && !hostAllowed('javascript:alert(1)', allowAll) && !hostAllowed('chrome://settings', allowAll), 'file:, javascript:, chrome: are never allowed, even with allowAll');
const listed = { allowAll: false, allowedSites: ['example.com', '*.google.com'] };
assert(hostAllowed('https://sub.example.com/a', listed) && hostAllowed('https://mail.google.com/', listed) && !hostAllowed('https://example.com.evil.com/', listed), 'allowlist matches subdomains but not suffix tricks');
assert(!hostAllowed('file:///etc/passwd', { allowAll: false, allowedSites: ['*'] }), 'wildcard list still blocks file:');

console.log('\nAll DOM/key tests passed.');
