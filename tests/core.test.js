import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, readdir } from "node:fs/promises";
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
