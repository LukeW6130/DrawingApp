import { SpatialIndex, bounds, union } from "./model.js";
export class Renderer {
  constructor(canvas, overlay, getDoc, getSettings) {
    this.canvas = canvas;
    this.overlay = overlay;
    this.doc = getDoc;
    this.settings = getSettings;
    this.index = new SpatialIndex();
    this.images = new Map();
    this.pdfPages = new Map();
    this.selection = new Set();
    this.live = null;
    this.marquee = null;
    this.region = null;
    this.onPdfNeeded = null;
    this.scheduled = false;
    this.drawCount = 0;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect(),
      dpr = devicePixelRatio || 1;
    for (const c of [this.canvas, this.overlay]) {
      c.width = Math.floor(r.width * dpr);
      c.height = Math.floor(r.height * dpr);
      c.style.width = r.width + "px";
      c.style.height = r.height + "px";
    }
    this.width = r.width;
    this.height = r.height;
    this.invalidate();
  }
  rebuild() {
    this.index.rebuild(this.doc().objects);
    this.order = new Map(this.doc().objects.map((o, i) => [o.id, i]));
    this.invalidate();
  }
  invalidate() {
    if (this.scheduled) return;
    this.scheduled = true;
    requestAnimationFrame(() => {
      this.scheduled = false;
      this.draw();
    });
  }
  world(p) {
    const c = this.doc().camera;
    return { x: (p.x - c.x) / c.zoom, y: (p.y - c.y) / c.zoom };
  }
  screen(p) {
    const c = this.doc().camera;
    return { x: p.x * c.zoom + c.x, y: p.y * c.zoom + c.y };
  }
  viewport() {
    const c = this.doc().camera;
    return {
      x: -c.x / c.zoom,
      y: -c.y / c.zoom,
      w: this.width / c.zoom,
      h: this.height / c.zoom,
    };
  }
  image(asset) {
    if (!this.images.has(asset)) {
      const im = new Image();
      im.onload = () => this.invalidate();
      im.src = asset;
      this.images.set(asset, im);
    }
    return this.images.get(asset);
  }
  drawBackground(ctx, rect, zoom = 1) {
    const bg = this.doc().background;
    ctx.fillStyle = bg.color;
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    let s = Math.max(4, bg.spacing);
    while (s * zoom < 10) s *= 2;
    if (bg.pattern !== "solid") {
      ctx.save();
      ctx.strokeStyle = ctx.fillStyle = bg.colorGrid;
      ctx.globalAlpha = bg.opacity;
      ctx.lineWidth = Math.max(0.3, bg.thickness);
      ctx.beginPath();
      const x0 = Math.floor(rect.x / s) * s,
        y0 = Math.floor(rect.y / s) * s;
      for (let y = y0; y < rect.y + rect.h; y += s) {
        if (bg.pattern === "dots") {
          for (let x = x0; x < rect.x + rect.w; x += s) {
            ctx.moveTo(x + bg.thickness, y);
            ctx.arc(x, y, Math.max(0.6, bg.thickness), 0, Math.PI * 2);
          }
        } else {
          ctx.moveTo(rect.x, y);
          ctx.lineTo(rect.x + rect.w, y);
        }
      }
      if (bg.pattern === "grid")
        for (let x = x0; x < rect.x + rect.w; x += s) {
          ctx.moveTo(x, rect.y);
          ctx.lineTo(x, rect.y + rect.h);
        }
      if (bg.pattern === "dots") ctx.fill();
      else ctx.stroke();
      ctx.restore();
    }
    if (bg.guides) {
      ctx.save();
      ctx.strokeStyle = "#7b8498";
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1 / zoom;
      ctx.setLineDash([6 / zoom, 6 / zoom]);
      const pageW = 794,
        pageH = 1123;
      for (
        let y = Math.floor(rect.y / pageH) * pageH;
        y < rect.y + rect.h;
        y += pageH
      )
        for (
          let x = Math.floor(rect.x / pageW) * pageW;
          x < rect.x + rect.w;
          x += pageW
        )
          ctx.strokeRect(x, y, pageW, pageH);
      ctx.restore();
    }
  }
  drawObject(ctx, o, { zoom = 1, skipPdf = false } = {}) {
    ctx.save();
    ctx.translate(o.x + o.w / 2, o.y + o.h / 2);
    ctx.rotate(((o.rotation || 0) * Math.PI) / 180);
    ctx.translate(-o.w / 2, -o.h / 2);
    ctx.globalAlpha *= o.opacity ?? 1;
    ctx.strokeStyle = ctx.fillStyle = o.color || "#fff";
    ctx.lineWidth = o.width || 2;
    ctx.lineCap = ctx.lineJoin = "round";
    if (o.type === "stroke") {
      const pts = o.points;
      if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(
          pts[0].x,
          pts[0].y,
          ((o.width || 2) * (o.pressure ? Math.max(0.12, pts[0].p) : 1)) / 2,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      } else if (o.pressure) {
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1],
            b = pts[i];
          ctx.lineWidth =
            (o.width || 2) * Math.max(0.12, ((a.p ?? 0.5) + (b.p ?? 0.5)) / 2);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      } else {
        ctx.beginPath();
        pts.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.stroke();
      }
    } else if (["line", "arrow", "polygon"].includes(o.type)) {
      const pts = o.points || [
        { x: 0, y: 0 },
        { x: o.w, y: o.h },
      ];
      ctx.beginPath();
      pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      if (o.type === "polygon") ctx.closePath();
      ctx.stroke();
      if (o.type === "arrow") {
        const a = pts.at(-2),
          b = pts.at(-1),
          angle = Math.atan2(b.y - a.y, b.x - a.x),
          len = Math.max(12, o.width * 4);
        ctx.beginPath();
        ctx.moveTo(
          b.x - len * Math.cos(angle - 0.45),
          b.y - len * Math.sin(angle - 0.45),
        );
        ctx.lineTo(b.x, b.y);
        ctx.lineTo(
          b.x - len * Math.cos(angle + 0.45),
          b.y - len * Math.sin(angle + 0.45),
        );
        ctx.stroke();
      }
    } else if (o.type === "rect") ctx.strokeRect(0, 0, o.w, o.h);
    else if (o.type === "ellipse") {
      ctx.beginPath();
      ctx.ellipse(
        o.w / 2,
        o.h / 2,
        Math.max(0.01, o.w / 2),
        Math.max(0.01, o.h / 2),
        0,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
    } else if (o.type === "text") {
      ctx.font = `${o.fontSize || 24}px "Segoe UI", sans-serif`;
      ctx.textBaseline = "top";
      String(o.text)
        .split("\n")
        .forEach((line, i) =>
          ctx.fillText(line, 0, i * (o.fontSize || 24) * 1.3),
        );
    } else if (o.type === "image") {
      const asset = this.doc().assets[o.asset];
      if (asset) {
        const im = this.image(asset.data);
        if (im.complete && im.naturalWidth) {
          const c = o.crop || { x: 0, y: 0, w: 1, h: 1 };
          ctx.drawImage(
            im,
            c.x * im.naturalWidth,
            c.y * im.naturalHeight,
            c.w * im.naturalWidth,
            c.h * im.naturalHeight,
            0,
            0,
            o.w,
            o.h,
          );
        }
      }
    } else if (o.type === "pdf" && !skipPdf) {
      const key = `${o.asset}:${o.page}`,
        entry = this.pdfPages.get(key);
      if (entry) {
        if (this.settings().darkPdf)
          ctx.filter = "invert(0.9) hue-rotate(180deg)";
        ctx.drawImage(entry.canvas, 0, 0, o.w, o.h);
        ctx.filter = "none";
      } else {
        ctx.fillStyle = "#f8f8f8";
        ctx.fillRect(0, 0, o.w, o.h);
        ctx.fillStyle = "#333";
        ctx.font = "18px sans-serif";
        ctx.fillText("Rendering PDF page…", 24, 40);
      }
      this.onPdfNeeded?.(o, zoom);
    }
    ctx.restore();
  }
  drawScene(
    ctx,
    rect,
    {
      background = true,
      only = null,
      skipPdf = false,
      zoom = 1,
      objects = null,
    } = {},
  ) {
    if (background) this.drawBackground(ctx, rect, zoom);
    const visible =
      objects ||
      this.index
        .query(rect)
        .sort(
          (a, b) => (this.order?.get(a.id) || 0) - (this.order?.get(b.id) || 0),
        );
    let count = 0;
    for (const layer of this.doc().layers) {
      if (!layer.visible) continue;
      ctx.save();
      ctx.globalAlpha = layer.opacity;
      for (const o of visible) {
        if (o.layer !== layer.id || (only && !only.has(o.id))) continue;
        this.drawObject(ctx, o, { zoom, skipPdf });
        count++;
      }
      ctx.restore();
    }
    return count;
  }
  draw() {
    if (!this.width) return;
    const dpr = devicePixelRatio || 1,
      c = this.doc().camera,
      ctx = this.canvas.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.translate(c.x, c.y);
    ctx.scale(c.zoom, c.zoom);
    this.drawCount = this.drawScene(ctx, this.viewport(), { zoom: c.zoom });
    const top = this.overlay.getContext("2d");
    top.setTransform(dpr, 0, 0, dpr, 0, 0);
    top.clearRect(0, 0, this.width, this.height);
    top.translate(c.x, c.y);
    top.scale(c.zoom, c.zoom);
    if (this.live) this.drawObject(top, this.live, { zoom: c.zoom });
    const selected = this.doc().objects.filter((o) => this.selection.has(o.id));
    top.strokeStyle = top.fillStyle = this.settings().theme.selection;
    top.lineWidth = 1.4 / c.zoom;
    if (selected.length) {
      const b = union(selected);
      top.strokeRect(b.x, b.y, b.w, b.h);
      const h = 7 / c.zoom;
      for (const p of [
        { x: b.x, y: b.y },
        { x: b.x + b.w, y: b.y },
        { x: b.x, y: b.y + b.h },
        { x: b.x + b.w, y: b.y + b.h },
      ])
        top.fillRect(p.x - h / 2, p.y - h / 2, h, h);
      top.beginPath();
      top.moveTo(b.x + b.w / 2, b.y);
      top.lineTo(b.x + b.w / 2, b.y - 24 / c.zoom);
      top.stroke();
      top.beginPath();
      top.arc(b.x + b.w / 2, b.y - 28 / c.zoom, 4 / c.zoom, 0, Math.PI * 2);
      top.fill();
    }
    if (this.marquee) {
      top.setLineDash([5 / c.zoom, 5 / c.zoom]);
      top.beginPath();
      this.marquee.forEach((p, i) =>
        i ? top.lineTo(p.x, p.y) : top.moveTo(p.x, p.y),
      );
      top.closePath();
      top.stroke();
    }
    if (this.region) {
      top.setLineDash([8 / c.zoom, 4 / c.zoom]);
      top.strokeRect(
        this.region.x,
        this.region.y,
        this.region.w,
        this.region.h,
      );
    }
  }
}
