import { icon } from "./icons.js";
export class ToolCursor {
  constructor(app) {
    this.app = app;
    this.node = document.createElement("div");
    this.node.className = "tool-cursor";
    this.node.setAttribute("aria-hidden", "true");
    this.node.hidden = true;
    app.input.surface.parentElement.append(this.node);
    const surface = app.input.surface;
    for (const name of [
      "pointerenter",
      "pointermove",
      "pointerdown",
      "pointerup",
    ])
      surface.addEventListener(name, (e) => {
        if (e.pointerType === "touch" && app.settings.touch !== "draw") {
          this.hide();
          return;
        }
        this.position = app.input.local(e);
        this.pressed = !!e.buttons;
        this.node.hidden = false;
        this.update();
      });
    for (const name of ["pointerleave", "pointercancel", "lostpointercapture"])
      surface.addEventListener(name, () => this.hide());
    window.addEventListener("blur", () => this.hide());
  }
  hide() {
    this.node.hidden = true;
  }
  update() {
    if (!this.position) return;
    const a = this.app,
      tool = a.input.gesture?.tool === "pan" ? "pan" : a.tool;
    const eraser = ["eraser", "partial"].includes(tool);
    const ink = [
      "pen",
      "highlighter",
      "line",
      "arrow",
      "rect",
      "ellipse",
      "polygon",
      "text",
    ].includes(tool);
    const diameter = eraser
      ? a.eraserSize * a.doc.camera.zoom
      : Math.max(7, Math.min(100, a.width * a.doc.camera.zoom));
    this.node.style.left = this.position.x + "px";
    this.node.style.top = this.position.y + "px";
    this.node.style.setProperty("--cursor-color", ink ? a.color : "#ffffff");
    this.node.style.setProperty("--cursor-size", diameter + "px");
    this.node.classList.toggle("pressed", this.pressed);
    this.node.classList.toggle("eraser", eraser);
    this.node.innerHTML = `<span class="cursor-ring"></span><span class="cursor-tool">${icon(tool)}</span>`;
  }
}
