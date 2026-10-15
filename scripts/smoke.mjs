import { _electron as electron } from "playwright";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
const cwd = process.cwd(),
  data = path.join(cwd, "test-results", "electron-profile");
await fs.mkdir(data, { recursive: true });
const errors = [];
const app = await electron.launch({
  args: [".", `--user-data-dir=${data}`],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
});
const page = await app.firstWindow();
page.on("pageerror", (e) => errors.push(e.message));
await page.waitForFunction(() => window.nocturne?.renderer);
const dialogs = page.locator("dialog");
if (await dialogs.count())
  await page
    .getByRole("button", { name: "Discard recovery", exact: true })
    .click();
await page.waitForTimeout(200);
const ink = page.locator("#ink"),
  box = await ink.boundingBox();
await page.mouse.move(box.x + 140, box.y + 140);
await page.mouse.down();
await page.mouse.move(box.x + 300, box.y + 190, { steps: 30 });
await page.mouse.up();
assert.equal(await page.evaluate(() => nocturne.doc.objects.length), 1);
await page.keyboard.press("2");
await page.mouse.move(box.x + 150, box.y + 230);
await page.mouse.down();
await page.mouse.move(box.x + 370, box.y + 250, { steps: 25 });
await page.mouse.up();
assert.equal(
  await page.evaluate(() => nocturne.doc.objects[1].color),
  "#63a8ff",
);
await page.keyboard.press("Control+z");
assert.equal(await page.evaluate(() => nocturne.doc.objects.length), 1);
await page.keyboard.press("Control+y");
assert.equal(await page.evaluate(() => nocturne.doc.objects.length), 2);
await page.keyboard.press("t");
await page.mouse.click(box.x + 140, box.y + 310);
await page.locator("#text-editor").fill("BEVT 123 — ∫ x² dx");
await page.keyboard.press("Control+Enter");
assert.equal(
  await page.evaluate(() => nocturne.doc.objects.at(-1).type),
  "text",
);
assert.equal(await page.evaluate(() => nocturne.tool), "text");
await page.evaluate(() => {
  nocturne.registry.assign("tool.pen", "F6");
  nocturne.settings.theme.accent = "#aabbcc";
  nocturne.persist();
});
await page.waitForTimeout(400);
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
for (const size of [
  [612, 792],
  [420, 595],
]) {
  const p = pdf.addPage(size);
  p.drawText("Original searchable PDF text", {
    x: 40,
    y: size[1] - 60,
    size: 18,
    font,
    color: rgb(0.1, 0.1, 0.1),
  });
}
const pdf64 = Buffer.from(await pdf.save()).toString("base64");
await page.evaluate(async (pdf64) => {
  const n = nocturne,
    asset = {
      id: "fixture-pdf",
      name: "two-pages.pdf",
      type: "pdf",
      data: "data:application/pdf;base64," + pdf64,
    };
  const objects = await n.pdf.importPages(asset, "all", "vertical", 2, 32, {
    x: 600,
    y: 50,
  });
  n.change(() => {
    n.doc.assets[asset.id] = asset;
    objects.forEach((o) => (o.layer = n.doc.activeLayer));
    n.doc.objects.push(...objects);
  });
  await n.pdf.ensure(objects[0], 1);
  await n.pdf.ensure(objects[1], 1);
}, pdf64);
await page.evaluate(async () => {
  const c = document.createElement("canvas");
  c.width = 240;
  c.height = 120;
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#2454a5";
  ctx.fillRect(0, 0, 240, 120);
  ctx.fillStyle = "white";
  ctx.font = "20px sans-serif";
  ctx.fillText("Screenshot fixture", 20, 60);
  await nocturne.addImage(c.toDataURL(), "Screenshot");
  const o = nocturne.selected()[0];
  nocturne.change(() => {
    o.w = 360;
    o.h = 180;
    o.locked = true;
  });
});
assert.equal(
  await page.evaluate(() => nocturne.doc.objects.at(-1).locked),
  true,
);
// Actual Windows clipboard image bridge.
await app.evaluate(({ clipboard, nativeImage }) => {
  clipboard.writeImage(
    nativeImage.createFromDataURL(
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    ),
  );
});
const beforePaste = await page.evaluate(() => nocturne.doc.objects.length);
await page.keyboard.press("Control+v");
await page.waitForTimeout(400);
assert.equal(
  await page.evaluate(() => nocturne.doc.objects.length),
  beforePaste + 1,
);
await page.evaluate(() => {
  const n = nocturne;
  n.change(() => {
    n.doc.background.color = "#101016";
    n.doc.background.pattern = "grid";
  });
  n.fit();
});
const exported = await page.evaluate(async () => {
  const n = nocturne;
  const pdfs = n.doc.objects.filter((o) => o.type === "pdf");
  n.change(() => {
    for (const p of pdfs)
      n.doc.objects.push({
        id: crypto.randomUUID(),
        type: "line",
        layer: n.doc.activeLayer,
        x: p.x + 40,
        y: p.y + 90,
        w: 100,
        h: 20,
        rotation: 0,
        color: "#ff0000",
        width: 3,
        opacity: 1,
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 20 },
        ],
      });
  });
  const bytes = await n.exportBytes({
    format: "pages",
    background: true,
    scale: 2,
  });
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const asset = {
    id: "exported-test",
    data: "data:application/pdf;base64," + btoa(binary),
  };
  const pdf = await n.pdf.load(asset);
  const texts = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    texts.push((await p.getTextContent()).items.map((x) => x.str).join(" "));
  }
  return { bytes: Array.from(bytes), texts };
});
const outputPdf = await PDFDocument.load(Uint8Array.from(exported.bytes));
assert.equal(outputPdf.getPageCount(), 2);
assert.deepEqual(
  outputPdf.getPages().map((p) => [p.getWidth(), p.getHeight()]),
  [
    [612, 792],
    [420, 595],
  ],
);
assert.ok(
  exported.texts.every((t) => t.includes("Original searchable PDF text")),
);
await fs.writeFile(
  path.join(cwd, "test-results", "annotated.pdf"),
  Uint8Array.from(exported.bytes),
);
const saveFile = path.join(cwd, "test-results", "native-save.nocturne");
await app.evaluate(({ dialog }, file) => {
  dialog.showSaveDialog = async () => ({ canceled: false, filePath: file });
}, saveFile);
await page.evaluate(() => nocturne.save(true));
assert.equal(
  JSON.parse(await fs.readFile(saveFile, "utf8")).objects.length,
  await page.evaluate(() => nocturne.doc.objects.length),
);
const project = await page.evaluate(() => JSON.stringify(nocturne.doc));
await fs.writeFile(
  path.join(cwd, "test-results", "roundtrip.nocturne"),
  project,
);
await page.evaluate(async () => {
  nocturne.tab.dirty = true;
  await nocturne.autosave();
});
await page.screenshot({
  path: path.join(cwd, "test-results", "app-smoke.png"),
});
assert.deepEqual(errors, []);
await app.evaluate(({ app }) => app.exit(0));
const restart = await electron.launch({
  args: [".", `--user-data-dir=${data}`],
  env: { ...process.env, ELECTRON_DISABLE_SECURITY_WARNINGS: "true" },
});
const p2 = await restart.firstWindow();
await p2.waitForFunction(() => window.nocturne?.renderer);
await p2.getByRole("button", { name: "Recover notes", exact: true }).click();
assert.equal(
  await p2.evaluate(() => nocturne.doc.objects.length),
  JSON.parse(project).objects.length,
);
assert.equal(
  await p2.evaluate(() => nocturne.settings.theme.accent),
  "#aabbcc",
);
assert.ok(
  await p2.evaluate(() =>
    nocturne.registry.bindings("tool.pen").includes("F6"),
  ),
);
await p2.keyboard.press("F6");
assert.equal(await p2.evaluate(() => nocturne.tool), "pen");
await p2.evaluate(() => {
  nocturne.allowClose = true;
});
await restart.close();
console.log(
  "PASS: pen, presets, undo/redo, text typing, PDF rendering, image resize/lock, native clipboard paste, recovery and persistent shortcuts/theme.",
);
