import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import {
  newDocument,
  defaultSettings,
  History,
  normalizeStroke,
  erasePartial,
  serialize,
  deserialize,
  SpatialIndex,
  resizeObject,
  parsePages,
  hit,
} from "../src/model.js";
import {
  CommandRegistry,
  normalizeKey,
  reserved,
  typingTarget,
} from "../src/commands.js";
const { atomicWrite } = createRequire(import.meta.url)(
  "../electron/storage.cjs",
);
function stroke(doc) {
  return normalizeStroke(
    [
      { x: 10, y: 30, p: 0.2 },
      { x: 110, y: 30, p: 0.9 },
    ],
    {
      layer: doc.activeLayer,
      color: "#ffffff",
      width: 4,
      pressure: true,
      opacity: 0.8,
    },
  );
}
test("portable project round trip preserves pressure, layers, source PDF and image data", () => {
  const d = newDocument("Calculus");
  d.assets.pdf = {
    id: "pdf",
    type: "pdf",
    data: "data:application/pdf;base64,JVBERg==",
  };
  d.assets.image = {
    id: "image",
    type: "image",
    data: "data:image/png;base64,AA==",
  };
  d.objects.push(
    stroke(d),
    {
      id: "p",
      type: "pdf",
      asset: "pdf",
      page: 3,
      layer: d.activeLayer,
      x: 0,
      y: 0,
      w: 612,
      h: 792,
      rotation: 0,
    },
    {
      id: "im",
      type: "image",
      asset: "image",
      layer: d.activeLayer,
      x: 20,
      y: 40,
      w: 100,
      h: 50,
      rotation: 45,
      crop: { x: 0.1, y: 0, w: 0.8, h: 1 },
    },
  );
  d.bookmarks.push({ name: "Limits", camera: { x: 10, y: 20, zoom: 2 } });
  assert.deepEqual(deserialize(serialize(d)), d);
});
test("reject malformed projects and missing assets", () => {
  assert.throws(() => deserialize("{}"));
  const d = newDocument();
  d.objects.push({
    id: "a",
    type: "image",
    asset: "missing",
    layer: d.activeLayer,
    x: 0,
    y: 0,
    w: 10,
    h: 10,
  });
  assert.throws(() => deserialize(serialize(d)), /Missing/);
});
test("undo redo draw move erase import and layer change", () => {
  const d = newDocument(),
    h = new History(d);
  h.change(() => d.objects.push(stroke(d)));
  h.change(() => (d.objects[0].x += 40));
  h.change(() => {
    d.assets.a = { data: "original" };
    d.layers[0].name = "Reference";
  });
  assert.equal(d.objects[0].x, 50);
  h.undo();
  assert.equal(d.assets.a, undefined);
  h.undo();
  assert.equal(d.objects[0].x, 10);
  h.undo();
  assert.equal(d.objects.length, 0);
  h.redo();
  h.redo();
  h.redo();
  assert.equal(d.assets.a.data, "original");
  h.change(() => (d.objects = []));
  h.undo();
  assert.equal(d.objects.length, 1);
});
test("new edits clear redo; no-op edits do not create history", () => {
  const d = newDocument(),
    h = new History(d);
  assert.equal(
    h.change(() => {}),
    false,
  );
  h.change(() => (d.name = "A"));
  h.undo();
  h.change(() => (d.name = "B"));
  assert.equal(h.redo(), false);
});
test("partial erase splits long segments without changing world placement", () => {
  const d = newDocument(),
    s = stroke(d),
    pieces = erasePartial(s, { x: 60, y: 30 }, 8);
  assert.equal(pieces.length, 2);
  assert.ok(pieces[0].x >= 10 && pieces[0].x < 20);
  assert.ok(pieces[1].x > 65);
  assert.equal(
    pieces.every((p) => p.layer === d.activeLayer && p.pressure),
    true,
  );
  assert.equal(
    pieces.some((o) => hit(o, { x: 60, y: 30 }, 1)),
    false,
  );
});
test("resize updates editable stroke points", () => {
  const d = newDocument(),
    s = stroke(d);
  resizeObject(s, 2, 3, { x: 0, y: 0 });
  assert.equal(s.x, 20);
  assert.equal(s.y, 90);
  assert.equal(s.points[1].x, 200);
});
test("background edit never changes ink colors", () => {
  const d = newDocument();
  d.objects.push(stroke(d));
  const h = new History(d);
  h.change(() => (d.background.color = "#ffffff"));
  assert.equal(d.objects[0].color, "#ffffff");
  h.undo();
  assert.equal(d.objects[0].color, "#ffffff");
});
test("spatial index culls a large document and handles negative coordinates", () => {
  const index = new SpatialIndex();
  const objects = Array.from({ length: 20000 }, (_, i) => ({
    id: String(i),
    x: i * 100 - 1000000,
    y: 0,
    w: 20,
    h: 20,
  }));
  index.rebuild(objects);
  const found = index.query({ x: -500, y: -10, w: 1000, h: 100 });
  assert.ok(found.length >= 10 && found.length < 20);
});
test("page range validation and selection", () => {
  assert.deepEqual(parsePages("1, 3-5,3", 5), [0, 2, 3, 4]);
  assert.equal(parsePages("all", 3).length, 3);
  for (const bad of ["0", "6", "4-2", "hi"])
    assert.throws(() => parsePages(bad, 5));
});
test("binding conflicts require explicit reassignment; multiple keys and reset", () => {
  const settings = defaultSettings(),
    r = new CommandRegistry(settings);
  r.add("pen", "Pen", "Tool", () => {}, ["B"]);
  r.add("erase", "Erase", "Tool", () => {}, ["E"]);
  assert.equal(r.assign("erase", "B").length, 1);
  assert.deepEqual(r.bindings("pen"), ["B"]);
  r.assign("erase", "B", true);
  assert.deepEqual(r.bindings("pen"), []);
  assert.deepEqual(r.bindings("erase"), ["E", "B"]);
  r.remove("erase", "B");
  assert.deepEqual(r.bindings("erase"), ["E"]);
  r.reset();
  assert.deepEqual(r.bindings("pen"), ["B"]);
});
test("binding profile round trip, validation, and reserved shortcuts", () => {
  const r = new CommandRegistry(defaultSettings());
  r.add("save", "Save", "File", () => {}, ["Ctrl+S"]);
  r.assign("save", "F2");
  const p = r.exportProfile();
  r.reset();
  r.importProfile(p);
  assert.deepEqual(r.bindings("save"), ["Ctrl+S", "F2"]);
  assert.throws(() => r.assign("save", "Alt+F4"));
  assert.equal(reserved("Meta+R"), true);
  assert.equal(
    normalizeKey({ key: "z", ctrlKey: true, shiftKey: true }),
    "Ctrl+Shift+Z",
  );
  assert.equal(normalizeKey({ key: " " }), "Space");
  assert.equal(typingTarget({ closest: () => ({}) }), true);
});
test("atomic saves replace complete content and leave no temp files", async () => {
  await mkdir(path.join(process.cwd(), "test-results"), { recursive: true });
  const dir = await mkdtemp(
    path.join(process.cwd(), "test-results", "nocturne-test-"),
  );
  try {
    const file = path.join(dir, "project.nocturne");
    await atomicWrite(file, serialize(newDocument()));
    const doc = newDocument("Updated");
    doc.objects.push(stroke(doc));
    await atomicWrite(file, serialize(doc));
    assert.deepEqual(deserialize(await readFile(file, "utf8")), doc);
    assert.deepEqual(await readdir(dir), ["project.nocturne"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

import { handles, handleAt, resizeFromHandle } from "../src/transforms.js";
test("all eight resize handles keep the opposite anchor fixed", () => {
  const b = { x: 100, y: 50, w: 200, h: 100 };
  for (const h of handles(b)) {
    assert.equal(handleAt(b, { x: h.px, y: h.py }, 2).cursor, h.cursor);
    const { sx, sy, origin } = resizeFromHandle(b, h, h.x * 40, h.y * 20);
    const o = { ...b };
    resizeObject(o, sx, sy, origin);
    assert.equal(o.x + ((1 - h.x) * o.w) / 2, origin.x);
    assert.equal(o.y + ((1 - h.y) * o.h) / 2, origin.y);
    assert.equal(o.w, h.x ? 240 : 200);
    assert.equal(o.h, h.y ? 120 : 100);
  }
});
test("proportional resizing shrinks and grows without flipping", () => {
  const b = { x: 0, y: 0, w: 200, h: 100 },
    h = handles(b)[3];
  const small = resizeFromHandle(b, h, -40, -10, true);
  assert.equal(small.sx, 0.8);
  assert.equal(small.sy, 0.8);
  assert.equal(resizeFromHandle(b, h, -1000, -1000).sx, 0.02);
  assert.equal(handleAt(b, { x: 208, y: 100 }, 1).x, 1);
  assert.equal(handleAt(b, { x: 208, y: 100 }, 2), undefined);
});

import { InputController } from "../src/input.js";
import { union } from "../src/model.js";
test("image and PDF pointer gestures resize from every handle, move, and undo", () => {
  for (const type of ["image", "pdf"])
    for (let i = 0; i < 8; i++) {
      const doc = newDocument(),
        noop = () => {};
      doc.camera = { x: 0, y: 0, zoom: 1 };
      doc.objects = [
        {
          id: "media",
          type,
          layer: doc.activeLayer,
          x: 100,
          y: 100,
          w: 200,
          h: 100,
        },
      ];
      const index = new SpatialIndex();
      index.rebuild(doc.objects);
      const surface = {
        style: {},
        focus: noop,
        setPointerCapture: noop,
        releasePointerCapture: noop,
        getBoundingClientRect: () => ({ left: 0, top: 0 }),
      };
      const renderer = {
        overlay: surface,
        index,
        world: (p) => p,
        invalidate: noop,
        rebuild: () => index.rebuild(doc.objects),
      };
      const app = {
        doc,
        renderer,
        settings: { snap: false },
        tool: "select",
        selection: new Set(["media"]),
        history: new History(doc),
        updatePanels: noop,
        changed: noop,
      };
      const input = Object.create(InputController.prototype);
      Object.assign(input, { app, renderer, surface, gesture: null });
      app.selected = () =>
        doc.objects.filter((o) => app.selection.has(o.id) && input.editable(o));
      const event = (x, y) => ({
        clientX: x,
        clientY: y,
        pointerId: 1,
        pointerType: "mouse",
        button: 0,
        preventDefault: noop,
      });
      const h = handles(union(doc.objects))[i];
      input.down(event(h.px, h.py));
      assert.equal(input.gesture.tool, "resize");
      input.move(event(h.px + h.x * 30, h.py + h.y * 20));
      input.up(event(0, 0));
      assert.ok(doc.objects[0].w > 200 || doc.objects[0].h > 100);
      app.history.undo();
      assert.equal(doc.objects[0].w, 200);
      app.history.redo();
      assert.ok(doc.objects[0].w > 200 || doc.objects[0].h > 100);
      app.history.undo();
      renderer.rebuild();
      input.down(event(200, 150));
      input.move(event(225, 175));
      input.up(event(225, 175));
      assert.equal(doc.objects[0].x, 125);
      assert.equal(doc.objects[0].y, 125);
      app.history.undo();
      assert.equal(doc.objects[0].x, 100);
    }
});

import {
  initializeRevision,
  edited,
  saveRevision,
  RecoveryWriter,
} from "../src/persistence.js";
import { updateStyle, matchesPreset } from "../src/tool-state.js";
const { projectFilename } = createRequire(import.meta.url)(
  "../electron/filename.cjs",
);
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
test("save captures a revision and name; later edits remain dirty", async () => {
  const tab = initializeRevision({
    doc: newDocument("Calculus"),
    dirty: true,
    path: null,
  });
  const gate = deferred();
  let written;
  const save = saveRevision(tab, (data, name) => {
    written = { data, name };
    return gate.promise;
  });
  tab.doc.name = "Calculus II";
  edited(tab);
  gate.resolve("calculus.nocturne");
  await save;
  assert.equal(JSON.parse(written.data).name, "Calculus");
  assert.equal(written.name, "Calculus");
  assert.equal(tab.savedRevision, 1);
  assert.equal(tab.revision, 2);
  assert.equal(tab.dirty, true);
  await saveRevision(tab, async () => "calculus.nocturne");
  assert.equal(tab.dirty, false);
});
test("failed and cancelled saves preserve dirty state", async () => {
  const tab = initializeRevision({ doc: newDocument(), dirty: true });
  await assert.rejects(
    saveRevision(tab, async () => {
      throw Error("Disk full");
    }),
    /Disk full/,
  );
  assert.equal(tab.dirty, true);
  assert.equal(tab.saving, null);
  assert.equal(await saveRevision(tab, async () => null), false);
  assert.equal(tab.dirty, true);
});
test("recovery snapshots are immutable, queued, and propagate failures", async () => {
  const tab = initializeRevision({ doc: newDocument("Before"), dirty: true }),
    writer = new RecoveryWriter(),
    gate = deferred();
  let snapshot;
  const pending = writer.write([tab], async (docs) => {
    snapshot = docs;
    await gate.promise;
  });
  tab.doc.name = "After";
  edited(tab);
  writer.changed();
  await Promise.resolve();
  assert.equal(snapshot[0].doc.name, "Before");
  gate.resolve();
  await pending;
  assert.equal(writer.dirty, true);
  await assert.rejects(
    writer.write([tab], async () => {
      throw Error("Disk full");
    }),
    /Disk full/,
  );
  assert.equal(writer.dirty, true);
  await writer.write([tab], async () => {});
  assert.equal(writer.dirty, false);
  assert.equal(tab.recoveryRevision, 2);
});
test("Windows filenames use document name and sanitize reserved characters", () => {
  assert.equal(projectFilename("Calculus notes"), "Calculus notes.nocturne");
  assert.equal(
    projectFilename("Week 1: extrema?"),
    "Week 1- extrema-.nocturne",
  );
  assert.equal(projectFilename("CON"), "_CON.nocturne");
  assert.equal(projectFilename("..."), "Untitled.nocturne");
});
test("preset matching requires all properties and shared limits apply", () => {
  const preset = defaultSettings().presets[0],
    state = { ...preset };
  assert.equal(matchesPreset(state, preset), true);
  for (const patch of [
    { width: 4 },
    { opacity: 0.5 },
    { smoothing: 0.7 },
    { color: "#000000" },
    { tool: "highlighter" },
  ]) {
    Object.assign(state, preset);
    updateStyle(state, patch);
    assert.equal(matchesPreset(state, preset), false);
  }
  updateStyle(state, { width: 900, eraserSize: 1 });
  assert.equal(state.width, 200);
  assert.equal(state.eraserSize, 2);
});
test("partial eraser splits recognized lines with finite pressure", () => {
  const doc = newDocument(),
    line = {
      ...stroke(doc),
      type: "line",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    };
  const pieces = erasePartial(line, { x: 60, y: 30 }, 8);
  assert.equal(pieces.length, 2);
  assert.ok(pieces.every((o) => o.points.every((p) => Number.isFinite(p.p))));
});
test("fast swept eraser removes freehand and straight ink between samples", () => {
  const doc = newDocument();
  doc.objects = [
    stroke(doc),
    { ...stroke(doc), id: "line", type: "line", y: 80 },
  ];
  const index = new SpatialIndex();
  index.rebuild(doc.objects);
  const app = { doc, eraserSize: 12 };
  const input = Object.create(InputController.prototype);
  Object.assign(input, {
    app,
    gesture: { eraseLast: { x: 60, y: 0 } },
    renderer: { index, rebuild: () => index.rebuild(doc.objects) },
  });
  input.erase({ x: 60, y: 120 }, "eraser");
  assert.equal(doc.objects.length, 0);
});

test("targeted object history interleaves with full-document history and preserves individual styles", () => {
  const doc = newDocument();
  doc.objects = [
    stroke(doc),
    { ...stroke(doc), id: "second", color: "#00ff00" },
  ];
  const history = new History(doc);
  const original = doc.objects.map((o) => o.color);
  history.changeObjects(doc.objects, () =>
    doc.objects.forEach((o) => (o.color = "#ff0000")),
  );
  history.change(() => (doc.layers[0].name = "Renamed"));
  history.undo();
  history.undo();
  assert.deepEqual(
    doc.objects.map((o) => o.color),
    original,
  );
  history.redo();
  history.redo();
  assert.equal(doc.layers[0].name, "Renamed");
  assert.ok(doc.objects.every((o) => o.color === "#ff0000"));
  history.beginObjects(doc.objects);
  doc.objects[0].x = 900;
  history.restore(history.pending);
  history.pending = null;
  assert.equal(doc.objects[0].x, 10);
});
