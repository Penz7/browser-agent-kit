// Pure helpers for working across iframes. No chrome.* access, so they are unit-tested in server/test/dom.test.mjs.
//
// Refs inside a child frame are exposed to the agent as "f<frameId>_ref_N"; the main frame keeps "ref_N".
// Every frame reports its index path from the top (window.parent.frames order) and the viewport rectangles of its
// own <iframe>/<frame> containers, which is enough to turn frame-local coordinates into main-frame coordinates.

const REF_RE = /^f(\d+)_(ref_\d+)$/;

export function parseRef(ref) {
  const m = REF_RE.exec(String(ref || ''));
  return m ? { frameId: Number(m[1]), ref: m[2] } : { frameId: 0, ref };
}

export function prefixRef(ref, frameId) { return frameId ? `f${frameId}_${ref}` : ref; }

// Rewrite "[ref_12]" markers in snapshot/find lines so the agent gets frame-qualified refs.
export function prefixLines(lines, frameId) {
  if (!frameId) return lines;
  return lines.map((l) => l.replace(/\[ref_(\d+)\]/g, `[f${frameId}_ref_$1]`));
}

// results: [{ frameId, path: number[]|null, containers: [{x,y,w,h,hidden}] }]
// Returns Map frameId -> { frameId, path, url, offset: {x,y}, rect: {x,y,w,h}|null, visible, depth, parentId }.
export function buildFrameTree(results) {
  const byPath = new Map();
  const frames = new Map();
  for (const r of results) {
    if (!r || !Array.isArray(r.path)) continue;
    const info = { frameId: r.frameId, path: r.path, url: r.url || '', containers: r.containers || [], offset: null, rect: null, visible: true, depth: r.path.length, parentId: null };
    byPath.set(JSON.stringify(r.path), info);
    frames.set(r.frameId, info);
  }
  const resolve = (info) => {
    if (info.offset) return info;
    if (info.path.length === 0) { info.offset = { x: 0, y: 0 }; return info; }
    const parent = byPath.get(JSON.stringify(info.path.slice(0, -1)));
    if (!parent) { info.offset = { x: 0, y: 0 }; info.visible = false; return info; }
    resolve(parent);
    info.parentId = parent.frameId;
    const c = parent.containers[info.path[info.path.length - 1]];
    if (!c) { info.offset = { ...parent.offset }; info.visible = false; return info; }
    info.offset = { x: parent.offset.x + c.x, y: parent.offset.y + c.y };
    info.rect = { x: info.offset.x, y: info.offset.y, w: c.w, h: c.h };
    info.visible = parent.visible && !c.hidden && c.w > 0 && c.h > 0;
    return info;
  };
  for (const info of frames.values()) resolve(info);
  return frames;
}

// Frame id of the child at container index `index` inside `parentId`, or null.
export function childFrameId(frames, parentId, index) {
  const parent = frames.get(parentId);
  if (!parent) return null;
  const key = JSON.stringify([...parent.path, index]);
  for (const f of frames.values()) if (JSON.stringify(f.path) === key) return f.frameId;
  return null;
}

export function toMainCoords(frames, frameId, point) {
  const f = frames.get(frameId);
  if (!f || !f.offset) return point;
  return { ...point, x: point.x + f.offset.x, y: point.y + f.offset.y };
}
