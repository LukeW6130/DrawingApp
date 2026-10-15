import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { mkdir, writeFile } from "node:fs/promises";
import { newDocument, normalizeStroke, uid } from "../src/model.js";
await mkdir("examples", { recursive: true });
const pdf = await PDFDocument.create(),
  font = await pdf.embedFont(StandardFonts.Helvetica);
for (const [i, size] of [
  [612, 792],
  [420, 595],
].entries()) {
  const page = pdf.addPage(size);
  page.drawText(`NOCTURNE / TEST WORKSHEET ${i + 1}`, {
    x: 36,
    y: size[1] - 50,
    size: 15,
    font,
    color: rgb(0.15, 0.18, 0.24),
  });
  page.drawText(
    i === 0 ? "Differentiate: f(x) = x^3 + 2x" : "Integrate: f(x) = 3x^2",
    { x: 36, y: size[1] - 95, size: 14, font },
  );
  page.drawText(`Original page size: ${size[0]} x ${size[1]} points`, {
    x: 36,
    y: size[1] - 125,
    size: 10,
    font,
    color: rgb(0.4, 0.4, 0.4),
  });
  page.drawText("This text should remain selectable after annotated export.", {
    x: 36,
    y: size[1] - 150,
    size: 9,
    font,
  });
  for (let y = size[1] - 190; y > 50; y -= 30)
    page.drawLine({
      start: { x: 36, y },
      end: { x: size[0] - 36, y },
      thickness: 0.5,
      color: rgb(0.82, 0.85, 0.9),
    });
}
const data = await pdf.save();
await writeFile("examples/two-page-worksheet.pdf", data);
const d = newDocument("Calculus — workspace example"),
  layer = d.activeLayer;
const text = (value, x, y, fontSize, color) =>
  d.objects.push({
    id: uid(),
    type: "text",
    text: value,
    x,
    y,
    w: value.length * fontSize * 0.51,
    h: fontSize * 1.3,
    fontSize,
    color,
    opacity: 1,
    rotation: 0,
    layer,
  });
text("CALCULUS / 01", 100, 90, 14, "#a99af5");
text("The idea of a derivative", 100, 128, 32, "#f4f5f7");
text(
  "A local rate of change. A slope at a single point.",
  100,
  180,
  18,
  "#8c96aa",
);
text("f(x) = x²", 110, 280, 27, "#63a8ff");
text("f′(x) = lim  [f(x + h) − f(x)] / h", 110, 335, 24, "#f4f5f7");
text("h → 0", 240, 369, 15, "#8c96aa");
text("= lim  [2xh + h²] / h  =  2x", 110, 420, 24, "#6bdaa3");
const stroke = (pts, color, width = 2) =>
  d.objects.push(
    normalizeStroke(
      pts.map(([x, y]) => ({ x, y, p: 1 })),
      { layer, color, width, opacity: 1, pressure: false },
    ),
  );
stroke(
  [
    [700, 520],
    [700, 240],
  ],
  "#8c96aa",
  1.5,
);
stroke(
  [
    [650, 490],
    [1000, 490],
  ],
  "#8c96aa",
  1.5,
);
stroke(
  Array.from({ length: 81 }, (_, i) => {
    const x = i * 3;
    return [700 + x, 490 - (x * x) / 220];
  }),
  "#63a8ff",
  3,
);
stroke(
  [
    [740, 465],
    [950, 270],
  ],
  "#ffd56a",
  2,
);
text("tangent slope = 2x", 735, 550, 17, "#ffd56a");
text("Write. Explore. Keep the working.", 100, 585, 16, "#8c96aa");
d.camera = { x: 0, y: 0, zoom: 1 };
d.bookmarks.push({ name: "Derivative notes", camera: { ...d.camera } });
await writeFile("examples/Calculus.nocturne", JSON.stringify(d));
console.log("Created the editable sample project and two-page PDF fixture.");
