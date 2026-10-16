import { newDocument, normalizeStroke } from "../src/model.js";
import { PDFDocument } from "pdf-lib";
import { base64 } from "../src/pdf.js";
export async function profile(n) {
  const doc = newDocument("Visible strokes benchmark");
  n.addTab(doc);
  n.activate(n.current);
  for (let i = 0; i < 3000; i++)
    doc.objects.push(
      normalizeStroke(
        Array.from({ length: 40 }, (_, j) => ({
          x: (i % 60) * 15 + j / 4,
          y: Math.floor(i / 60) * 10 + Math.sin(j / 3) * 3,
          p: 0.7,
        })),
        { layer: doc.activeLayer, width: 1, color: "#ffffff", opacity: 1 },
      ),
    );
  n.renderer.rebuild();
  const frames = [];
  for (let i = 0; i < 10; i++) {
    await new Promise(requestAnimationFrame);
    const t = performance.now();
    n.renderer.draw();
    frames.push(performance.now() - t);
  }
  frames.sort((a, b) => a - b);
  const pdf = await PDFDocument.create();
  for (let i = 0; i < 24; i++) pdf.addPage([612, 792]);
  const asset = {
    id: crypto.randomUUID(),
    type: "pdf",
    data: "data:application/pdf;base64," + base64(await pdf.save()),
  };
  doc.assets[asset.id] = asset;
  const pages = await n.pdf.importPages(asset, "all", "vertical");
  pages.forEach((p) => (p.layer = doc.activeLayer));
  doc.objects.push(...pages);
  let max = 0;
  const start = performance.now();
  for (const p of pages) {
    await n.pdf.ensure(p, 2);
    max = Math.max(max, n.pdf.cacheBytes());
  }
  const result = {
    visibleStrokes: 3000,
    visiblePoints: 120000,
    viewport: [n.renderer.width, n.renderer.height],
    dpr: devicePixelRatio,
    frameMedianMs: frames[5],
    frameMaxMs: frames[9],
    pdfPages: 24,
    pdfRenderMs: performance.now() - start,
    pdfCachePeakMiB: max / 2 ** 20,
    pdfCachePages: n.renderer.pdfPages.size,
    heapMiB: performance.memory?.usedJSHeapSize / 2 ** 20,
  };
  n.removeTab(n.current);
  return result;
}
