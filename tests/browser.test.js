import { profile } from "./profile.browser.js";
import { feedbackChecks } from "./feedback.browser.js";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import {
  newDocument,
  normalizeStroke,
  serialize,
  deserialize,
  clone,
} from "../src/model.js";
import { base64, bytesFromData, exportCanvas } from "../src/pdf.js";
const log = document.querySelector("#verification");
const results = [];
function check(condition, message) {
  if (!condition) throw Error(message);
  results.push("PASS " + message);
  log.textContent = results.join("\n");
}
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
try {
  for (let i = 0; i < 100 && !window.nocturne; i++) await delay(100);
  const n = window.nocturne;
  if (!n) throw Error("App did not initialize");
  document.querySelectorAll("dialog").forEach((d) => d.close());
  n.addTab(newDocument("Verification — calculus"));
  n.activate(n.current);
  // Tests use the same public controllers as the UI. Native input delivery is checked separately.
  const style = {
    layer: n.doc.activeLayer,
    color: "#f4f5f7",
    width: 3,
    opacity: 1,
    pressure: true,
  };
  n.change(() =>
    n.doc.objects.push(
      normalizeStroke(
        [
          { x: 80, y: 80, p: 0.2 },
          { x: 200, y: 110, p: 0.8 },
        ],
        style,
      ),
    ),
  );
  n.registry.run("preset.pen2");
  check(n.color === "#63a8ff", "preset chooses blue ink");
  n.change(() =>
    n.doc.objects.push(
      normalizeStroke(
        [
          { x: 80, y: 160, p: 0.7 },
          { x: 260, y: 180, p: 0.4 },
        ],
        { ...style, color: n.color },
      ),
    ),
  );
  n.registry.run("edit.undo");
  check(n.doc.objects.length === 1, "undo drawing");
  n.registry.run("edit.redo");
  check(n.doc.objects.length === 2, "redo drawing");
  n.doc.background.color = "#151515";
  n.doc.background.pattern = "grid";
  check(
    n.doc.objects[0].color === "#f4f5f7" &&
      n.doc.objects[1].color === "#63a8ff",
    "background changes preserve stroke colors",
  );
  n.registry.assign("tool.pen", "F6");
  n.persist();
  await delay(400);
  check(
    JSON.parse(localStorage.getItem("nocturne.settings")).bindings[
      "tool.pen"
    ].includes("F6"),
    "shortcut profile persists to storage",
  );
  const target = document.querySelector("#ink");
  target.focus();
  target.dispatchEvent(
    new KeyboardEvent("keydown", { key: "t", code: "KeyT", bubbles: true }),
  );
  check(n.tool === "text", "keyboard command dispatch");
  n.editText(null, { x: 90, y: 230 });
  const text = document.querySelector("#text-editor");
  text.value = "BEVT 123 — ∫ x² dx";
  text.dispatchEvent(
    new KeyboardEvent("keydown", { key: "b", code: "KeyB", bubbles: true }),
  );
  check(n.tool === "text", "typing does not trigger pen shortcut");
  text.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      ctrlKey: true,
      bubbles: true,
    }),
  );
  check(
    n.doc.objects.at(-1).text === "BEVT 123 — ∫ x² dx",
    "editable Unicode text commits",
  );
  const c = document.createElement("canvas");
  c.width = 200;
  c.height = 100;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2454a5";
  ctx.fillRect(0, 0, 200, 100);
  await n.addImage(c.toDataURL(), "Screenshot fixture");
  const image = n.selected()[0];
  n.change(() => {
    image.w = 300;
    image.h = 150;
    image.locked = true;
  });
  check(image.locked && image.w === 300, "image resize and lock");
  check(!n.input.editable(image), "locked image is protected from editing");
  n.history.undo();
  check(
    !n.doc.objects.find((o) => o.id === image.id).locked,
    "undo object change",
  );
  n.history.redo();
  check(
    n.doc.objects.find((o) => o.id === image.id).locked,
    "redo object change",
  );
  const pdf = await PDFDocument.create(),
    font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const size of [
    [612, 792],
    [420, 595],
  ]) {
    const page = pdf.addPage(size);
    page.drawText("Original searchable PDF text", {
      x: 40,
      y: size[1] - 60,
      font,
      size: 18,
      color: rgb(0.1, 0.1, 0.1),
    });
  }
  const asset = {
    id: crypto.randomUUID(),
    name: "two-pages.pdf",
    type: "pdf",
    data: "data:application/pdf;base64," + base64(await pdf.save()),
  };
  const objects = await n.pdf.importPages(asset, "all", "vertical", 2, 32, {
    x: 700,
    y: 40,
  });
  n.change(() => {
    n.doc.assets[asset.id] = asset;
    objects.forEach((o) => (o.layer = n.doc.activeLayer));
    n.doc.objects.push(...objects);
  });
  n.history.undo();
  check(!n.doc.assets[asset.id], "undo PDF import removes source asset");
  n.history.redo();
  check(
    n.doc.objects.filter((o) => o.type === "pdf").length === 2,
    "redo PDF import restores both pages",
  );
  for (const o of objects) await n.pdf.ensure(o, 1);
  check(n.renderer.pdfPages.size >= 2, "PDF.js renders multiple pages");
  n.change(() => {
    for (const p of n.doc.objects.filter((o) => o.type === "pdf"))
      n.doc.objects.push(
        normalizeStroke(
          [
            { x: p.x + 40, y: p.y + 90, p: 1 },
            { x: p.x + 150, y: p.y + 110, p: 1 },
          ],
          { ...style, color: "#ff0000" },
        ),
      );
  });
  const exported = await n.exportBytes({
    format: "pages",
    background: true,
    scale: 2,
  });
  const result = await PDFDocument.load(exported);
  check(
    JSON.stringify(
      result.getPages().map((p) => [p.getWidth(), p.getHeight()]),
    ) === "[[612,792],[420,595]]",
    "annotated export preserves both original page sizes",
  );
  const exportedAsset = {
    id: crypto.randomUUID(),
    type: "pdf",
    data: "data:application/pdf;base64," + base64(exported),
  };
  const parsed = await n.pdf.load(exportedAsset);
  let textRetained = true;
  for (let i = 1; i <= 2; i++) {
    const p = await parsed.getPage(i);
    textRetained &&= (await p.getTextContent()).items.some((item) =>
      item.str.includes("Original searchable PDF text"),
    );
  }
  check(textRetained, "annotated PDF retains searchable original text");
  const roundtrip = deserialize(serialize(n.doc));
  check(
    roundtrip.objects.length === n.doc.objects.length &&
      roundtrip.assets[asset.id].data === asset.data,
    "editable project and embedded PDF round trip",
  );
  await n.autosave();
  const recovery = JSON.parse(localStorage.getItem("nocturne.recovery"));
  check(
    recovery.some(
      (t) =>
        t.doc.id === n.doc.id && t.doc.objects.length === n.doc.objects.length,
    ),
    "autosave recovery contains all objects and assets",
  );
  const original = n.doc.objects.slice();
  const many = Array.from({ length: 20000 }, (_, i) => ({
    id: "perf" + i,
    type: "rect",
    layer: n.doc.activeLayer,
    x: i * 1000,
    y: 2000,
    w: 50,
    h: 50,
    color: "#fff",
    width: 1,
    rotation: 0,
    opacity: 1,
  }));
  n.doc.objects.push(...many);
  const start = performance.now();
  n.renderer.rebuild();
  n.renderer.draw();
  const elapsed = performance.now() - start;
  check(
    n.renderer.drawCount < 100,
    "large-document rendering culls offscreen objects",
  );
  results.push(
    "INFO 20,000-object index + visible frame: " + elapsed.toFixed(1) + " ms",
  );
  n.doc.objects = original;
  n.renderer.rebuild();
  const png = exportCanvas(
    n.renderer,
    { x: 0, y: 0, w: 400, h: 400 },
    { scale: 1, background: false },
  );
  check(
    png.getContext("2d").getImageData(399, 399, 1, 1).data[3] === 0,
    "transparent PNG omits background",
  );
  n.fit();
  await feedbackChecks(n, check);
  if (new URLSearchParams(location.search).has("profile"))
    results.push("PROFILE " + JSON.stringify(await profile(n)));
  document.querySelector("#verification").textContent =
    results.join("\n") +
    "\n\nALL " +
    results.filter((r) => r.startsWith("PASS")).length +
    " INTEGRATION CHECKS PASSED";
  window.integrationResults = { passed: true, results };
} catch (e) {
  log.textContent = results.join("\n") + "\nFAIL " + e.stack;
  window.integrationResults = { passed: false, error: e.message, results };
}
