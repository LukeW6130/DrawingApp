import {
  uid,
  clone,
  bounds,
  union,
  hit,
  normalizeStroke,
  erasePartial,
  resizeObject,
  pointInPolygon,
  intersects,
} from "./model.js";
export class InputController {
  constructor(app) {
    this.app = app;
    this.renderer = app.renderer;
    this.surface = this.renderer.overlay;
    this.gesture = null;
    this.polygon = [];
    this.held = null;
    this.surface.addEventListener("pointerdown", (e) => this.down(e));
    this.surface.addEventListener("pointermove", (e) => this.move(e));
    this.surface.addEventListener("pointerup", (e) => this.up(e));
    this.surface.addEventListener("pointercancel", () => this.cancel());
    this.surface.addEventListener("lostpointercapture", () => {
      if (this.gesture) this.cancel();
    });
    this.surface.addEventListener("wheel", (e) => this.wheel(e), {
      passive: false,
    });
    this.surface.addEventListener("contextmenu", (e) => e.preventDefault());
    this.surface.addEventListener("dblclick", (e) => {
      if (app.tool === "polygon") this.finishPolygon();
      else if (app.tool === "select") {
        const o = this.pick(this.world(e));
        if (o?.type === "text") app.editText(o);
      }
    });
    window.addEventListener("blur", () => {
      this.cancel();
      this.releaseHold();
    });
  }
  local(e) {
    const r = this.surface.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  world(e) {
    return this.renderer.world(this.local(e));
  }
  editable(o) {
    const l = this.app.doc.layers.find((l) => l.id === o.layer);
    return l?.visible && !l.locked && !o.locked;
  }
  pick(p) {
    const layers = this.app.doc.layers;
    return this.renderer.index
      .query({ x: p.x - 10, y: p.y - 10, w: 20, h: 20 })
      .filter(
        (o) => this.editable(o) && hit(o, p, 6 / this.app.doc.camera.zoom),
      )
      .sort(
        (a, b) =>
          layers.findIndex((l) => l.id === b.layer) -
            layers.findIndex((l) => l.id === a.layer) ||
          this.app.doc.objects.indexOf(b) - this.app.doc.objects.indexOf(a),
      )[0];
  }
  style() {
    const a = this.app;
    return {
      layer: a.doc.activeLayer,
      color: a.color,
      width: a.width,
      opacity: a.opacity * (a.tool === "highlighter" ? 0.35 : 1),
      pressure: a.settings.pressure && a.tool === "pen",
      smoothing: a.smoothing,
    };
  }
  point(e) {
    const p = this.world(e);
    return {
      ...p,
      p:
        e.pointerType === "pen"
          ? Math.pow(
              Math.max(0.05, e.pressure),
              this.app.settings.pressureCurve,
            )
          : 1,
    };
  }
  snap(p) {
    if (!this.app.settings.snap) return p;
    const s = this.app.doc.background.spacing;
    return { ...p, x: Math.round(p.x / s) * s, y: Math.round(p.y / s) * s };
  }
  hold(tool) {
    if (this.held) return;
    this.held = this.app.tool;
    this.app.setTool(tool);
  }
  releaseHold() {
    if (!this.held) return;
    const t = this.held;
    this.held = null;
    this.app.setTool(t);
  }
  down(e) {
    if (e.button > 1 || this.gesture) return;
    if (e.pointerType === "touch" && this.app.settings.touch === "ignore")
      return;
    e.preventDefault();
    this.surface.focus();
    const app = this.app,
      p = this.snap(this.point(e)),
      local = this.local(e),
      tool =
        e.button === 1 ||
        (e.pointerType === "touch" && app.settings.touch === "pan")
          ? "pan"
          : app.tool;
    this.surface.setPointerCapture(e.pointerId);
    if (tool === "pan") {
      this.gesture = {
        tool,
        id: e.pointerId,
        start: local,
        camera: { ...app.doc.camera },
      };
      return;
    }
    if (tool === "eyedropper") {
      const ctx = this.renderer.canvas.getContext("2d"),
        dpr = devicePixelRatio || 1,
        data = ctx.getImageData(local.x * dpr, local.y * dpr, 1, 1).data;
      app.setColor(
        "#" +
          [...data]
            .slice(0, 3)
            .map((n) => n.toString(16).padStart(2, "0"))
            .join(""),
      );
      return;
    }
    if (tool === "select") {
      const selected = app.selected(),
        b = selected.length ? union(selected) : null,
        z = app.doc.camera.zoom;
      let transform = null;
      if (b && Math.hypot(p.x - b.x - b.w / 2, p.y - b.y + 28 / z) < 12 / z)
        transform = "rotate";
      else if (b && Math.hypot(p.x - b.x - b.w, p.y - b.y - b.h) < 14 / z)
        transform = "resize";
      const o = transform ? null : this.pick(p);
      if (transform || o) {
        if (o && !app.selection.has(o.id)) {
          if (!e.shiftKey) app.selection.clear();
          for (const item of app.doc.objects)
            if (
              item.id === o.id ||
              (o.group && item.group === o.group && this.editable(item))
            )
              app.selection.add(item.id);
        }
        app.history.begin();
        this.gesture = {
          tool: transform || "move",
          id: e.pointerId,
          start: p,
          original: clone(app.selected()),
          bounds: union(app.selected()),
        };
        app.updatePanels();
      } else {
        if (!e.shiftKey) app.selection.clear();
        this.gesture = {
          tool: "marquee",
          id: e.pointerId,
          start: p,
          points: [p],
          add: e.shiftKey,
        };
      }
      this.renderer.invalidate();
      return;
    }
    if (tool === "lasso" || tool === "region") {
      if (tool === "lasso" && !e.shiftKey) app.selection.clear();
      this.gesture = { tool, id: e.pointerId, start: p, points: [p] };
      return;
    }
    const layer = app.doc.layers.find((l) => l.id === app.doc.activeLayer);
    if (!layer || layer.locked || !layer.visible) {
      app.toast("Choose a visible, unlocked layer to draw.");
      return;
    }
    if (tool === "text") {
      app.editText(null, p);
      return;
    }
    if (tool === "polygon") {
      this.polygon.push(p);
      if (this.polygon.length > 1)
        this.renderer.live = this.makeShape("polygon", this.polygon);
      this.renderer.invalidate();
      return;
    }
    app.history.begin();
    this.gesture = {
      tool,
      id: e.pointerId,
      start: p,
      points: [p],
      style: this.style(),
    };
    if (["eraser", "partial"].includes(tool)) this.erase(p, tool);
    else if (["pen", "highlighter"].includes(tool))
      this.renderer.live = normalizeStroke([p], this.gesture.style);
    else this.renderer.live = this.makeShape(tool, [p, p]);
    this.renderer.invalidate();
  }
  move(e) {
    const g = this.gesture;
    if (!g || g.id !== e.pointerId) return;
    const a = this.app,
      p = this.snap(this.point(e));
    if (g.tool === "pan") {
      const l = this.local(e);
      a.doc.camera.x = g.camera.x + l.x - g.start.x;
      a.doc.camera.y = g.camera.y + l.y - g.start.y;
      this.renderer.invalidate();
      a.updateZoom();
      return;
    }
    if (["move", "resize", "rotate"].includes(g.tool)) {
      const dx = p.x - g.start.x,
        dy = p.y - g.start.y,
        b = g.bounds;
      for (const original of g.original) {
        const o = a.doc.objects.find((o) => o.id === original.id);
        if (!this.editable(o)) continue;
        Object.assign(o, clone(original));
        if (g.tool === "move") {
          o.x += dx;
          o.y += dy;
        } else if (g.tool === "resize") {
          let sx = Math.max(0.02, (b.w + dx) / b.w),
            sy = Math.max(0.02, (b.h + dy) / b.h);
          if (e.shiftKey) sx = sy = Math.max(sx, sy);
          resizeObject(o, sx, sy, b);
        } else {
          const cx = b.x + b.w / 2,
            cy = b.y + b.h / 2;
          let delta =
            ((Math.atan2(p.y - cy, p.x - cx) -
              Math.atan2(g.start.y - cy, g.start.x - cx)) *
              180) /
            Math.PI;
          if (e.shiftKey) delta = Math.round(delta / 15) * 15;
          const angle = (delta * Math.PI) / 180,
            x = o.x + o.w / 2 - cx,
            y = o.y + o.h / 2 - cy;
          o.x = cx + x * Math.cos(angle) - y * Math.sin(angle) - o.w / 2;
          o.y = cy + x * Math.sin(angle) + y * Math.cos(angle) - o.h / 2;
          o.rotation = (o.rotation || 0) + delta;
        }
      }
      this.renderer.rebuild();
      return;
    }
    if (["marquee", "region", "lasso"].includes(g.tool)) {
      if (g.tool === "lasso") g.points.push(p);
      else
        g.points = [
          g.start,
          { x: p.x, y: g.start.y },
          p,
          { x: g.start.x, y: p.y },
        ];
      this.renderer.marquee = g.points;
      this.renderer.invalidate();
      return;
    }
    if (["eraser", "partial"].includes(g.tool)) {
      this.erase(p, g.tool);
      return;
    }
    if (["pen", "highlighter"].includes(g.tool)) {
      const events = e.getCoalescedEvents?.() || [e];
      for (const event of events.length ? events : [e]) {
        let q = this.point(event),
          last = g.points.at(-1),
          s = a.smoothing * 0.82;
        q = {
          ...q,
          x: last.x * s + q.x * (1 - s),
          y: last.y * s + q.y * (1 - s),
        };
        if (Math.hypot(q.x - last.x, q.y - last.y) > 0.15 / a.doc.camera.zoom)
          g.points.push(q);
      }
      if (e.shiftKey) {
        this.renderer.live = this.makeShape("line", [g.start, p]);
      } else this.renderer.live = normalizeStroke(g.points, g.style);
    } else {
      let end = p;
      if (e.shiftKey) {
        const dx = p.x - g.start.x,
          dy = p.y - g.start.y;
        if (["rect", "ellipse"].includes(g.tool)) {
          const size = Math.max(Math.abs(dx), Math.abs(dy));
          end = {
            ...p,
            x: g.start.x + Math.sign(dx || 1) * size,
            y: g.start.y + Math.sign(dy || 1) * size,
          };
        } else {
          const len = Math.hypot(dx, dy),
            angle =
              (Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * Math.PI) / 4;
          end = {
            ...p,
            x: g.start.x + len * Math.cos(angle),
            y: g.start.y + len * Math.sin(angle),
          };
        }
      }
      this.renderer.live = this.makeShape(g.tool, [g.start, end]);
    }
    this.renderer.invalidate();
  }
  makeShape(type, pts) {
    const x = Math.min(...pts.map((p) => p.x)),
      y = Math.min(...pts.map((p) => p.y)),
      w = Math.max(0.01, Math.max(...pts.map((p) => p.x)) - x),
      h = Math.max(0.01, Math.max(...pts.map((p) => p.y)) - y);
    return {
      id: uid(),
      ...this.style(),
      type,
      x,
      y,
      w,
      h,
      rotation: 0,
      ...(["line", "arrow", "polygon"].includes(type)
        ? { points: pts.map((p) => ({ x: p.x - x, y: p.y - y })) }
        : {}),
    };
  }
  erase(p, tool) {
    const a = this.app,
      r = Math.max(8, a.width * 2) / Math.sqrt(a.doc.camera.zoom),
      near = new Set(
        this.renderer.index
          .query({ x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 })
          .filter(
            (o) => this.editable(o) && o.type === "stroke" && hit(o, p, r),
          )
          .map((o) => o.id),
      );
    if (!near.size) return;
    a.doc.objects = a.doc.objects.flatMap((o) =>
      !near.has(o.id) ? [o] : tool === "partial" ? erasePartial(o, p, r) : [],
    );
    this.renderer.rebuild();
  }
  up(e) {
    const g = this.gesture;
    if (!g || e.pointerId !== g.id) return;
    const a = this.app;
    if (["marquee", "lasso"].includes(g.tool)) {
      const region = union(g.points.map((p) => ({ ...p, w: 0, h: 0 })));
      for (const o of a.doc.objects)
        if (
          this.editable(o) &&
          (g.tool === "lasso"
            ? pointInPolygon({ x: o.x + o.w / 2, y: o.y + o.h / 2 }, g.points)
            : intersects(bounds(o), region))
        )
          a.selection.add(o.id);
      a.updatePanels();
    } else if (g.tool === "region") {
      const xs = g.points.map((p) => p.x),
        ys = g.points.map((p) => p.y);
      this.renderer.region = {
        x: Math.min(...xs),
        y: Math.min(...ys),
        w: Math.max(...xs) - Math.min(...xs),
        h: Math.max(...ys) - Math.min(...ys),
      };
      a.toast("Export region set. Open Export to use it.");
    } else if (
      !["pan", "move", "resize", "rotate", "eraser", "partial"].includes(
        g.tool,
      ) &&
      this.renderer.live
    ) {
      let object = this.renderer.live;
      if (
        a.settings.recognition &&
        object.type === "stroke" &&
        g.points.length > 4
      ) {
        const first = g.points[0],
          last = g.points.at(-1),
          distance = Math.hypot(last.x - first.x, last.y - first.y),
          length = g.points
            .slice(1)
            .reduce(
              (n, p, i) =>
                n + Math.hypot(p.x - g.points[i].x, p.y - g.points[i].y),
              0,
            );
        if (distance / length > 0.96)
          object = this.makeShape("line", [first, last]);
        else if (
          distance < Math.max(object.w, object.h) * 0.15 &&
          g.points.length > 15
        ) {
          const edge =
            g.points.filter(
              (p) =>
                Math.min(
                  Math.abs(p.x - object.x),
                  Math.abs(p.x - object.x - object.w),
                  Math.abs(p.y - object.y),
                  Math.abs(p.y - object.y - object.h),
                ) <
                Math.min(object.w, object.h) * 0.1,
            ).length / g.points.length;
          object = { ...object, type: edge > 0.85 ? "rect" : "ellipse" };
          delete object.points;
        }
      }
      a.doc.objects.push(object);
    }
    this.gesture = null;
    this.renderer.live = null;
    this.renderer.marquee = null;
    if (a.history.commit()) a.changed();
    else this.renderer.invalidate();
    this.surface.releasePointerCapture(e.pointerId);
  }
  finishPolygon() {
    if (this.polygon.length >= 3) {
      this.app.change(() =>
        this.app.doc.objects.push(this.makeShape("polygon", this.polygon)),
      );
    }
    this.polygon = [];
    this.renderer.live = null;
    this.renderer.invalidate();
  }
  cancel() {
    if (this.gesture && this.app.history.pending) {
      this.app.history.restore(this.app.history.pending);
      this.app.history.pending = null;
    }
    this.gesture = null;
    this.polygon = [];
    this.renderer.live = null;
    this.renderer.marquee = null;
    this.renderer.rebuild();
  }
  wheel(e) {
    e.preventDefault();
    const a = this.app,
      c = a.doc.camera;
    if (e.ctrlKey || a.settings.wheel === "zoom")
      a.zoomAt(Math.exp(-e.deltaY * 0.002), this.local(e));
    else {
      c.x -= e.shiftKey ? e.deltaY : e.deltaX;
      c.y -= e.shiftKey ? e.deltaX : e.deltaY;
      this.renderer.invalidate();
      a.updateZoom();
    }
  }
}
