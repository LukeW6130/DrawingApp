import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { PDFDocument, rgb, StandardFonts, degrees } from "pdf-lib";
import { parsePages, uid, union } from "./model.js";
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export const bytesFromData = (data) =>
  Uint8Array.from(atob(data.split(",").at(-1)), (c) => c.charCodeAt(0));
export function base64(bytes) {
  let result = "";
  for (let i = 0; i < bytes.length; i += 32768)
    result += String.fromCharCode(...bytes.subarray(i, i + 32768));
  return btoa(result);
}
export class PdfManager {
  constructor(renderer) {
    this.renderer = renderer;
    this.docs = new Map();
    this.pending = new Map();
    this.queue = Promise.resolve();
    renderer.onPdfNeeded = (o, z) => this.ensure(o, z).catch(() => {});
  }
  async load(asset) {
    if (!this.docs.has(asset.id))
      this.docs.set(
        asset.id,
        pdfjs.getDocument({
          data: bytesFromData(asset.data),
          isEvalSupported: false,
        }).promise,
      );
    return this.docs.get(asset.id);
  }
  async importPages(
    asset,
    pages,
    layout,
    columns = 2,
    gap = 32,
    origin = { x: 0, y: 0 },
  ) {
    const pdf = await this.load(asset),
      indices = parsePages(pages, pdf.numPages),
      objects = [];
    let x = origin.x,
      y = origin.y,
      rowH = 0;
    for (let i = 0; i < indices.length; i++) {
      const page = await pdf.getPage(indices[i] + 1),
        v = page.getViewport({ scale: 1 });
      objects.push({
        id: uid(),
        type: "pdf",
        asset: asset.id,
        page: indices[i],
        x,
        y,
        w: v.width,
        h: v.height,
        rotation: 0,
        opacity: 1,
        locked: true,
      });
      if (layout === "horizontal") x += v.width + gap;
      else if (layout === "grid") {
        rowH = Math.max(rowH, v.height);
        if ((i + 1) % columns === 0) {
          x = origin.x;
          y += rowH + gap;
          rowH = 0;
        } else x += v.width + gap;
      } else y += v.height + gap;
    }
    return objects;
  }
  async ensure(o, zoom, force = false) {
    const asset = this.renderer.doc().assets[o.asset];
    if (!asset) return;
    const key = `${o.asset}:${o.page}`,
      scale = Math.max(
        1,
        Math.min(4, Math.ceil(zoom * (devicePixelRatio || 1) * 2) / 2),
      ),
      current = this.renderer.pdfPages.get(key);
    if (current && current.scale >= scale) return;
    if (this.pending.has(key)) return this.pending.get(key);
    const task = this.queue.then(async () => {
      const pdf = await this.load(asset),
        page = await pdf.getPage(o.page + 1),
        natural = page.getViewport({ scale: 1 }),
        limit = Math.sqrt(16000000 / (natural.width * natural.height)),
        actual = Math.min(scale, limit),
        v = page.getViewport({ scale: actual }),
        canvas = document.createElement("canvas");
      canvas.width = Math.ceil(v.width);
      canvas.height = Math.ceil(v.height);
      await page.render({ canvasContext: canvas.getContext("2d"), viewport: v })
        .promise;
      this.renderer.pdfPages.set(key, { canvas, scale });
      while (!this.pinCache && this.renderer.pdfPages.size > 24) {
        const oldest = this.renderer.pdfPages.keys().next().value;
        if (oldest === key) break;
        this.renderer.pdfPages.delete(oldest);
      }
      this.renderer.invalidate();
    });
    this.queue = task.catch(() => {});
    this.pending.set(key, task);
    try {
      await task;
    } finally {
      this.pending.delete(key);
    }
  }
}
export function exportCanvas(
  renderer,
  rect,
  { scale = 2, background = true, only = null, skipPdf = false } = {},
) {
  const w = Math.ceil(rect.w * scale),
    h = Math.ceil(rect.h * scale);
  if (w * h > 64000000 || w > 16384 || h > 16384)
    throw Error(
      "Export is too large. Reduce resolution or choose a smaller region (maximum 64 megapixels / 16384 px per edge).",
    );
  const c = document.createElement("canvas");
  c.width = Math.max(1, w);
  c.height = Math.max(1, h);
  const ctx = c.getContext("2d");
  ctx.scale(scale, scale);
  ctx.translate(-rect.x, -rect.y);
  renderer.drawScene(ctx, rect, { background, only, skipPdf, zoom: scale });
  return c;
}
const color = (value) => {
  const v = value.replace("#", "");
  return rgb(
    parseInt(v.slice(0, 2), 16) / 255,
    parseInt(v.slice(2, 4), 16) / 255,
    parseInt(v.slice(4, 6), 16) / 255,
  );
};
// Imported PDF content remains vector/text. Editable annotations are vector strokes/text where possible.
export async function annotatedPdf(
  doc,
  renderer,
  { rect, only = null, background = true, mode = "pages", scale = 2 } = {},
) {
  const out = await PDFDocument.create(),
    sources = new Map(),
    font = await out.embedFont(StandardFonts.Helvetica);
  const pages = doc.objects.filter(
    (o) =>
      o.type === "pdf" &&
      doc.layers.find((l) => l.id === o.layer)?.visible &&
      (!only || only.has(o.id)),
  );
  const regions =
    mode === "pages" && pages.length
      ? pages.map((o) => ({
          rect: { x: o.x, y: o.y, w: o.w, h: o.h },
          source: o,
        }))
      : [{ rect: rect || union(doc.objects), source: null }];
  for (const item of regions) {
    const r = item.rect;
    let page,
      sx = 1,
      sy = 1;
    if (item.source) {
      const o = item.source;
      if (o.rotation)
        throw Error(
          "Annotated-page export requires PDF pages at 0° rotation. Reset page rotation or choose flattened region PDF.",
        );
      if (!sources.has(o.asset))
        sources.set(
          o.asset,
          await PDFDocument.load(bytesFromData(doc.assets[o.asset].data)),
        );
      const [copied] = await out.copyPages(sources.get(o.asset), [o.page]);
      page = out.addPage(copied);
      sx = page.getWidth() / o.w;
      sy = page.getHeight() / o.h;
      if (page.getRotation().angle !== 0)
        throw Error(
          "This PDF has rotated page metadata. Use flattened region PDF for correct appearance.",
        );
    } else {
      page = out.addPage([r.w, r.h]);
      if (background)
        page.drawRectangle({
          x: 0,
          y: 0,
          width: r.w,
          height: r.h,
          color: color(doc.background.color),
        });
    }
    if (mode === "flatten") {
      const canvas = exportCanvas(renderer, r, { scale, background, only }),
        image = await out.embedPng(canvas.toDataURL());
      page.drawImage(image, {
        x: 0,
        y: 0,
        width: page.getWidth(),
        height: page.getHeight(),
      });
      continue;
    }
    const toPage = (o, p) => {
      const a = ((o.rotation || 0) * Math.PI) / 180,
        x = p.x - o.w / 2,
        y = p.y - o.h / 2;
      return {
        x: (o.x + o.w / 2 + x * Math.cos(a) - y * Math.sin(a) - r.x) * sx,
        y:
          page.getHeight() -
          (o.y + o.h / 2 + x * Math.sin(a) + y * Math.cos(a) - r.y) * sy,
      };
    };
    for (const layer of doc.layers) {
      if (!layer.visible) continue;
      for (const o of doc.objects) {
        if (
          o.layer !== layer.id ||
          o.type === "pdf" ||
          (only && !only.has(o.id)) ||
          o.x + o.w < r.x ||
          o.y + o.h < r.y ||
          o.x > r.x + r.w ||
          o.y > r.y + r.h
        )
          continue;
        const opacity = (o.opacity ?? 1) * layer.opacity,
          c = color(o.color || "#ffffff");
        let pts = o.points;
        if (o.type === "rect")
          pts = [
            { x: 0, y: 0 },
            { x: o.w, y: 0 },
            { x: o.w, y: o.h },
            { x: 0, y: o.h },
            { x: 0, y: 0 },
          ];
        if (o.type === "ellipse")
          pts = Array.from({ length: 65 }, (_, i) => ({
            x: o.w / 2 + (o.w / 2) * Math.cos((i * Math.PI) / 32),
            y: o.h / 2 + (o.h / 2) * Math.sin((i * Math.PI) / 32),
          }));
        if (pts) {
          if (o.type === "polygon") pts = [...pts, pts[0]];
          if (pts.length === 1) {
            const p = toPage(o, pts[0]);
            page.drawCircle({
              ...p,
              size: ((o.width || 2) * sx) / 2,
              color: c,
              opacity,
            });
          }
          for (let i = 1; i < pts.length; i++)
            page.drawLine({
              start: toPage(o, pts[i - 1]),
              end: toPage(o, pts[i]),
              thickness:
                (o.width || 2) *
                sx *
                (o.pressure
                  ? Math.max(
                      0.12,
                      ((pts[i].p ?? 0.5) + (pts[i - 1].p ?? 0.5)) / 2,
                    )
                  : 1),
              color: c,
              opacity,
            });
          if (o.type === "arrow") {
            const a = pts.at(-2),
              b = pts.at(-1),
              angle = Math.atan2(b.y - a.y, b.x - a.x),
              len = Math.max(12, o.width * 4);
            for (const angle2 of [angle - 0.45, angle + 0.45])
              page.drawLine({
                start: toPage(o, b),
                end: toPage(o, {
                  x: b.x - len * Math.cos(angle2),
                  y: b.y - len * Math.sin(angle2),
                }),
                thickness: o.width * sx,
                color: c,
                opacity,
              });
          }
        } else if (o.type === "text" && /^[\x20-\x7E\n\r]*$/.test(o.text)) {
          String(o.text)
            .split("\n")
            .forEach((line, i) =>
              page.drawText(line, {
                ...toPage(o, { x: 0, y: (i * 1.3 + 0.85) * o.fontSize }),
                size: o.fontSize * sy,
                font,
                color: c,
                opacity,
                rotate: degrees(-(o.rotation || 0)),
              }),
            );
        } else if (o.type === "image" || o.type === "text") {
          const b = union([o]),
            canvas = document.createElement("canvas");
          canvas.width = Math.ceil(b.w * 2);
          canvas.height = Math.ceil(b.h * 2);
          if (canvas.width * canvas.height > 64000000)
            throw Error("An image is too large for PDF export.");
          const ctx = canvas.getContext("2d");
          ctx.scale(2, 2);
          ctx.translate(-b.x, -b.y);
          ctx.globalAlpha = layer.opacity;
          renderer.drawObject(ctx, o);
          const im = await out.embedPng(canvas.toDataURL());
          page.drawImage(im, {
            x: (b.x - r.x) * sx,
            y: page.getHeight() - (b.y - r.y + b.h) * sy,
            width: b.w * sx,
            height: b.h * sy,
          });
        }
      }
    }
  }
  return out.save();
}
