export const uid = () => globalThis.crypto.randomUUID();
export const clone = (x) => structuredClone(x);
export const COLORS = ["#f4f5f7", "#63a8ff", "#ff686b", "#6bdaa3", "#ffd56a"];
export function newDocument(name = "Untitled") {
  const layer = {
    id: uid(),
    name: "Notes",
    visible: true,
    locked: false,
    opacity: 1,
  };
  return {
    format: "nocturne",
    version: 1,
    id: uid(),
    name,
    objects: [],
    assets: {},
    layers: [layer],
    activeLayer: layer.id,
    background: {
      color: "#000000",
      pattern: "solid",
      spacing: 32,
      thickness: 1,
      colorGrid: "#526173",
      opacity: 0.3,
      guides: false,
    },
    camera: { x: 0, y: 0, zoom: 1 },
    bookmarks: [],
  };
}
export function defaultSettings() {
  return {
    theme: {
      background: "#101218",
      panel: "#191d25",
      text: "#eceff6",
      accent: "#ad9bff",
      selection: "#a793ff",
      icons: "#c9cedb",
      muted: "#a7afbf",
      border: "#404550",
      hover: "#292f3a",
      focus: "#ad9bff",
    },
    uiScale: 1,
    shortcutLabels: false,
    largeControls: false,
    toolbarSide: "left",
    toolbarSize: 44,
    touch: "pan",
    wheel: "pan",
    pressure: true,
    pressureCurve: 1,
    snap: false,
    recognition: false,
    darkPdf: false,
    bindings: {},
    hiddenTools: [
      "highlighter",
      "partial",
      "lasso",
      "line",
      "arrow",
      "rect",
      "ellipse",
      "polygon",
      "eyedropper",
      "region",
    ],
    toolOrder: [],
    recentColors: [],
    swatches: COLORS.slice(),
    presets: COLORS.map((color, i) => ({
      id: `pen${i + 1}`,
      name: ["Chalk", "Sky", "Coral", "Mint", "Gold"][i],
      tool: "pen",
      color,
      width: 3,
      opacity: 1,
      smoothing: 0.35,
    })),
  };
}
export function validateDocument(d) {
  if (!d || d.format !== "nocturne" || d.version !== 1)
    throw Error("This is not a supported Nocturne project.");
  if (
    !Array.isArray(d.objects) ||
    !Array.isArray(d.layers) ||
    !d.layers.length ||
    !d.assets ||
    !d.camera
  )
    throw Error("The document is incomplete.");
  if (d.objects.length > 1000000)
    throw Error("Document object limit exceeded.");
  const ids = new Set();
  for (const l of d.layers) {
    if (!l.id || ids.has(l.id)) throw Error("Invalid layer IDs");
    ids.add(l.id);
  }
  for (const o of d.objects) {
    if (
      !ids.has(o.layer) ||
      ![
        "stroke",
        "line",
        "arrow",
        "rect",
        "ellipse",
        "polygon",
        "text",
        "image",
        "pdf",
      ].includes(o.type)
    )
      throw Error("Invalid object or layer");
    if (![o.x, o.y, o.w, o.h, o.rotation ?? 0].every(Number.isFinite))
      throw Error("Invalid object geometry");
    if (o.w < 0 || o.h < 0) throw Error("Invalid object size");
    if (["image", "pdf"].includes(o.type) && !d.assets[o.asset])
      throw Error("Missing imported asset");
    if (
      o.points &&
      (!Array.isArray(o.points) ||
        o.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
    )
      throw Error("Invalid stroke points");
  }
  if (
    !Number.isFinite(d.camera.x) ||
    !Number.isFinite(d.camera.y) ||
    !Number.isFinite(d.camera.zoom) ||
    d.camera.zoom <= 0
  )
    throw Error("Invalid camera");
  d.background = { ...newDocument().background, ...d.background };
  d.bookmarks ??= [];
  return d;
}
export function serialize(d) {
  return JSON.stringify(d);
}
export function deserialize(s) {
  return validateDocument(JSON.parse(s));
}
export function bounds(o) {
  const a = ((o.rotation || 0) * Math.PI) / 180,
    c = Math.abs(Math.cos(a)),
    s = Math.abs(Math.sin(a)),
    w = o.w * c + o.h * s,
    h = o.w * s + o.h * c,
    p = (o.width || 0) / 2 + 2;
  return {
    x: o.x + o.w / 2 - w / 2 - p,
    y: o.y + o.h / 2 - h / 2 - p,
    w: w + 2 * p,
    h: h + 2 * p,
  };
}
export function intersects(a, b) {
  return (
    a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y
  );
}
export function union(objects) {
  if (!objects.length) return { x: 0, y: 0, w: 800, h: 1000 };
  const bs = objects.map(bounds),
    x = Math.min(...bs.map((b) => b.x)),
    y = Math.min(...bs.map((b) => b.y));
  return {
    x,
    y,
    w: Math.max(1, Math.max(...bs.map((b) => b.x + b.w)) - x),
    h: Math.max(1, Math.max(...bs.map((b) => b.y + b.h)) - y),
  };
}
export function localPoint(o, p) {
  const a = (-(o.rotation || 0) * Math.PI) / 180,
    x = p.x - o.x - o.w / 2,
    y = p.y - o.y - o.h / 2;
  return {
    x: x * Math.cos(a) - y * Math.sin(a) + o.w / 2,
    y: x * Math.sin(a) + y * Math.cos(a) + o.h / 2,
  };
}
export function segmentDistance(p, a, b) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function hit(o, p, tolerance = 5) {
  const q = localPoint(o, p);
  if (
    o.type === "stroke" ||
    o.type === "line" ||
    o.type === "arrow" ||
    o.type === "polygon"
  ) {
    const pts = o.points || [
      { x: 0, y: 0 },
      { x: o.w, y: o.h },
    ];
    return pts.some(
      (v, i) =>
        segmentDistance(q, pts[Math.max(0, i - 1)], v) <=
        tolerance + (o.width || 1) / 2,
    );
  }
  return (
    q.x >= -tolerance &&
    q.x <= o.w + tolerance &&
    q.y >= -tolerance &&
    q.y <= o.h + tolerance
  );
}
export function pointInPolygon(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i],
      b = pts[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function normalizeStroke(points, style) {
  const xs = points.map((p) => p.x),
    ys = points.map((p) => p.y),
    x = Math.min(...xs),
    y = Math.min(...ys);
  return {
    id: uid(),
    ...style,
    type: "stroke",
    x,
    y,
    w: Math.max(0.01, Math.max(...xs) - x),
    h: Math.max(0.01, Math.max(...ys) - y),
    rotation: style.rotation || 0,
    points: points.map((p) => ({ ...p, x: p.x - x, y: p.y - y })),
  };
}
export function resizeObject(o, sx, sy, origin) {
  o.x = origin.x + (o.x - origin.x) * sx;
  o.y = origin.y + (o.y - origin.y) * sy;
  o.w *= sx;
  o.h *= sy;
  if (o.points)
    o.points = o.points.map((p) => ({ ...p, x: p.x * sx, y: p.y * sy }));
  if (o.fontSize) o.fontSize *= sy;
}
export function erasePartial(o, p, r) {
  if (!["stroke", "line"].includes(o.type) || !hit(o, p, r)) return [o];
  const q = localPoint(o, p),
    runs = [];
  let run = [];
  const dense = [];
  for (let i = 0; i < o.points.length; i++) {
    const a = o.points[Math.max(0, i - 1)],
      b = o.points[i],
      n = Math.max(
        1,
        Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, r / 3)),
      );
    for (let j = 1; j <= n; j++)
      dense.push({
        x: a.x + ((b.x - a.x) * j) / n,
        y: a.y + ((b.y - a.y) * j) / n,
        p: (a.p ?? 1) + (((b.p ?? 1) - (a.p ?? 1)) * j) / n,
      });
  }
  for (const v of dense) {
    if (Math.hypot(v.x - q.x, v.y - q.y) <= r + (o.width || 1) / 2) {
      if (run.length) runs.push(run);
      run = [];
    } else run.push(v);
  }
  if (run.length) runs.push(run);
  const a = ((o.rotation || 0) * Math.PI) / 180;
  return runs
    .map((pts) =>
      normalizeStroke(
        pts.map((v) => {
          const x = v.x - o.w / 2,
            y = v.y - o.h / 2;
          return {
            x: o.x + o.w / 2 + x * Math.cos(a) - y * Math.sin(a),
            y: o.y + o.h / 2 + x * Math.sin(a) + y * Math.cos(a),
            p: v.p,
          };
        }),
        { ...o, type: "stroke", id: uid(), rotation: 0 },
      ),
    )
    .map((v) => {
      delete v._cache;
      return v;
    });
}
// Coarse spatial bins keep panning proportional to visible objects. Very large objects use a separate list.
export class SpatialIndex {
  constructor(size = 512) {
    this.size = size;
    this.bins = new Map();
    this.large = [];
  }
  rebuild(objects) {
    this.bins.clear();
    this.large = [];
    for (const o of objects) {
      const b = bounds(o),
        x0 = Math.floor(b.x / this.size),
        x1 = Math.floor((b.x + b.w) / this.size),
        y0 = Math.floor(b.y / this.size),
        y1 = Math.floor((b.y + b.h) / this.size);
      if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) {
        this.large.push(o);
        continue;
      }
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = `${x},${y}`;
          if (!this.bins.has(k)) this.bins.set(k, []);
          this.bins.get(k).push(o);
        }
    }
  }
  query(rect) {
    const found = new Set(this.large);
    const x0 = Math.floor(rect.x / this.size),
      x1 = Math.floor((rect.x + rect.w) / this.size),
      y0 = Math.floor(rect.y / this.size),
      y1 = Math.floor((rect.y + rect.h) / this.size);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 10000) {
      for (const values of this.bins.values())
        for (const o of values) found.add(o);
    } else
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++)
          for (const o of this.bins.get(`${x},${y}`) || []) found.add(o);
    return [...found].filter((o) => intersects(bounds(o), rect));
  }
}
export class History {
  constructor(doc) {
    this.doc = doc;
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }
  snapshot() {
    const { assets, ...rest } = this.doc;
    return { state: clone(rest), assets: { ...assets } };
  }
  objectSnapshot(ids) {
    const wanted = new Set(ids);
    return {
      kind: "objects",
      objects: clone(this.doc.objects.filter((o) => wanted.has(o.id))),
    };
  }
  beginObjects(objects) {
    if (!this.pending)
      this.pending = this.objectSnapshot(objects.map((o) => o.id));
  }
  changeObjects(objects, fn) {
    this.beginObjects(objects);
    try {
      fn();
      return this.commit();
    } catch (error) {
      this.restore(this.pending);
      this.pending = null;
      throw error;
    }
  }
  inverse(entry) {
    return entry.kind === "objects"
      ? this.objectSnapshot(entry.objects.map((o) => o.id))
      : this.snapshot();
  }
  restore(s) {
    if (s.kind === "objects") {
      const replacements = new Map(s.objects.map((o) => [o.id, clone(o)]));
      this.doc.objects = this.doc.objects.map(
        (o) => replacements.get(o.id) || o,
      );
      return;
    }
    for (const k of Object.keys(this.doc)) delete this.doc[k];
    Object.assign(this.doc, clone(s.state), { assets: { ...s.assets } });
  }
  begin() {
    if (!this.pending) this.pending = this.snapshot();
  }
  commit() {
    if (!this.pending) return false;
    const before = this.pending;
    this.pending = null;
    if (before.kind === "objects") {
      if (
        JSON.stringify(before.objects) ===
        JSON.stringify(this.inverse(before).objects)
      )
        return false;
      this.undoStack.push(before);
      if (this.undoStack.length > 150) this.undoStack.shift();
      this.redoStack = [];
      return true;
    }
    if (
      JSON.stringify(before.state) === JSON.stringify(this.snapshot().state) &&
      Object.keys(before.assets).join() === Object.keys(this.doc.assets).join()
    )
      return false;
    this.undoStack.push(before);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack = [];
    return true;
  }
  change(fn) {
    this.begin();
    try {
      fn();
      return this.commit();
    } catch (e) {
      this.restore(this.pending);
      this.pending = null;
      throw e;
    }
  }
  undo() {
    if (!this.undoStack.length) return false;
    const entry = this.undoStack.pop();
    this.redoStack.push(this.inverse(entry));
    this.restore(entry);
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    const entry = this.redoStack.pop();
    this.undoStack.push(this.inverse(entry));
    this.restore(entry);
    return true;
  }
}
export function parsePages(value, total) {
  if (!value.trim() || value.trim().toLowerCase() === "all")
    return Array.from({ length: total }, (_, i) => i);
  const result = new Set();
  for (const part of value.split(",")) {
    const m = part.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);
    if (!m) throw Error("Use page numbers such as 1, 3-5 or all.");
    const start = +m[1],
      end = +(m[2] || m[1]);
    if (start < 1 || end > total || end < start)
      throw Error(`Pages must be between 1 and ${total}.`);
    for (let p = start; p <= end; p++) result.add(p - 1);
  }
  return [...result];
}
