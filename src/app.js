import {
  LIMITS,
  updateStyle,
  matchesPreset,
  mixedValue,
} from "./tool-state.js";
import { icon } from "./icons.js";
import { ToolCursor } from "./cursor.js";
import {
  initializeRevision,
  edited,
  saveRevision,
  RecoveryWriter,
} from "./persistence.js";
import "./style.css";
import {
  newDocument,
  defaultSettings,
  uid,
  clone,
  History,
  serialize,
  deserialize,
  union,
  resizeObject,
  COLORS,
} from "./model.js";
import { CommandRegistry, normalizeKey, typingTarget } from "./commands.js";
import { Renderer } from "./render.js";
import { InputController } from "./input.js";
import {
  PdfManager,
  base64,
  bytesFromData,
  annotatedPdf,
  exportCanvas,
} from "./pdf.js";
import {
  el,
  button,
  dialog,
  ask,
  esc,
  readJSONFile,
  propertyPopover,
} from "./ui.js";
import { settingsDialog } from "./settings.js";
const TOOLS = [
  ["pen", "Pen", "⌁"],
  ["highlighter", "Highlighter", "▰"],
  ["eraser", "Stroke eraser", "◇"],
  ["partial", "Partial eraser", "◈"],
  ["select", "Select", "↖"],
  ["lasso", "Lasso", "◌"],
  ["text", "Text", "T"],
  ["line", "Line", "╱"],
  ["arrow", "Arrow", "↗"],
  ["rect", "Rectangle", "□"],
  ["ellipse", "Ellipse", "○"],
  ["polygon", "Polygon", "⬡"],
  ["pan", "Pan", "✥"],
  ["eyedropper", "Eyedropper", "⌖"],
  ["region", "Export region", "⊡"],
];
class App {
  constructor() {
    this.settings = defaultSettings();
    this.tabs = [];
    this.current = 0;
    this.tool = "pen";
    this.color = COLORS[0];
    this.width = 3;
    this.opacity = 1;
    this.smoothing = 0.35;
    this.eraserSize = 24;
    this.fontSize = 24;
    this.selection = new Set();
    this.clipboardObjects = null;
    this.inspectorVisible = false;
    this.toolbarVisible = true;
    this.recovery = new RecoveryWriter();
    this.persistTimer = null;
    this.TOOLS = TOOLS;
  }
  get tab() {
    return this.tabs[this.current];
  }
  get doc() {
    return this.tab.doc;
  }
  get history() {
    return this.tab.history;
  }
  async init() {
    try {
      const saved = window.desktop
        ? await desktop.settingsRead()
        : JSON.parse(localStorage.getItem("nocturne.settings") || "null");
      if (saved)
        this.settings = {
          ...this.settings,
          ...saved,
          theme: { ...this.settings.theme, ...saved.theme },
        };
    } catch {}
    this.addTab(newDocument());
    this.mount();
    this.registry = new CommandRegistry(this.settings, () => {
      this.persist();
      this.buildToolbar();
    });
    this.registerCommands();
    this.registerPropertyCommands();
    for (const c of this.registry.commands.values()) {
      if (c.id.startsWith("selection.") && c.id !== "selection.unlockAll")
        c.available = () => this.selected(true).length > 0;
      if (c.id === "edit.undo")
        c.available = () => this.history.undoStack.length > 0;
      if (c.id === "edit.redo")
        c.available = () => this.history.redoStack.length > 0;
    }
    this.renderer = new Renderer(
      document.querySelector("#canvas"),
      document.querySelector("#ink"),
      () => this.doc,
      () => this.settings,
    );
    this.renderer.selection = this.selection;
    this.pdf = new PdfManager(this.renderer);
    this.input = new InputController(this);
    this.cursor = new ToolCursor(this);
    this.bindEvents();
    this.applyTheme();
    this.buildToolbar();
    this.updatePanels();
    this.updateTabs();
    this.renderer.rebuild();
    await this.restoreRecovery();
    setInterval(() => {
      if (this.recovery.dirty) this.safe(() => this.autosave());
    }, 8000);
    window.nocturne = this;
  }
  addTab(doc, path = null, dirty = false) {
    this.tabs.push(
      initializeRevision({ doc, path, dirty, history: new History(doc) }),
    );
    this.recovery.changed();
    this.current = this.tabs.length - 1;
  }
  mount() {
    document.querySelector("#app").innerHTML =
      `<main id="shell"><header id="topbar"><div class="brand"><span class="brand-mark">◒</span><span>NOCTURNE<br><small>SPACE TO THINK</small></span></div><button id="file-menu">File ▾</button><span id="title">Untitled</span><span class="grow"></span><button data-cmd="edit.undo" aria-label="Undo">↶</button><button data-cmd="edit.redo" aria-label="Redo">↷</button><span style="width:10px"></span><button data-cmd="view.zoomOut">−</button><button id="zoom" data-cmd="view.reset">100%</button><button data-cmd="view.zoomIn">+</button><button data-cmd="file.export">Export ↗</button><button data-cmd="view.inspector" aria-label="Toggle inspector">☷</button><button data-cmd="app.settings" aria-label="Settings">⚙</button><button class="header-overflow" data-cmd="app.commands" aria-label="More actions">More</button></header><nav id="tabs"></nav><div id="workarea"><nav id="toolbar" aria-label="Drawing tools"></nav><section id="canvas-wrap" aria-label="Infinite drawing canvas"><canvas id="canvas"></canvas><canvas id="ink" tabindex="0" aria-label="Drawing input surface"></canvas><div id="quick-properties" aria-label="Quick pen properties"></div><div class="welcome" id="welcome"><div class="orbit">◒</div><h1>A little space for big ideas.</h1><p>Write, sketch, and work things out.<br>Choose a pen to begin, or drop a PDF here.</p></div><div class="bottom-hint"><span><kbd>Space</kbd> pan</span><span><kbd>Ctrl</kbd> + scroll to zoom</span><span><kbd>Ctrl K</kbd> commands</span></div></section><aside id="inspector" class="hidden"></aside></div><footer id="statusbar"><span id="status">All work stays on this device</span><span id="coordinates">Infinite canvas · origin 0, 0</span></footer></main><button class="focus-exit" data-cmd="view.focus">Exit focus</button><div id="toast" class="hidden" role="status"></div>`;
  }
  registerCommands() {
    const add = (id, label, category, run, keys = [], extra = {}) =>
      this.registry.add(id, label, category, () => this.safe(run), keys, extra);
    for (const [tool, label] of TOOLS)
      add(
        `tool.${tool}`,
        label,
        "Tools",
        () => this.setTool(tool),
        {
          pen: ["B"],
          eraser: ["E"],
          select: ["V"],
          text: ["T"],
          highlighter: ["H"],
          lasso: ["L"],
          pan: ["P"],
        }[tool] || [],
      );
    add(
      "hold.pan",
      "Hold to pan",
      "Tools",
      () => this.input.hold("pan"),
      ["Space"],
      { hold: true },
    );
    add(
      "hold.eraser",
      "Hold to erase",
      "Tools",
      () => this.input.hold("eraser"),
      [],
      { hold: true },
    );
    this.registerPresets();
    COLORS.forEach((color, i) =>
      add(
        `color.${i}`,
        `Color: ${["white", "blue", "red", "green", "yellow"][i]}`,
        "Colors",
        () => this.setColor(color),
      ),
    );
    add(
      "style.widthDown",
      "Decrease stroke width",
      "Stroke",
      () => this.setWidth(this.width / 1.25),
      ["["],
    );
    add(
      "style.widthUp",
      "Increase stroke width",
      "Stroke",
      () => this.setWidth(this.width * 1.25),
      ["]"],
    );
    add("style.opacityDown", "Decrease opacity", "Stroke", () => {
      this.setStyle({ opacity: Math.max(0.05, this.opacity - 0.1) });
      this.updatePanels();
    });
    add("style.opacityUp", "Increase opacity", "Stroke", () => {
      this.setStyle({ opacity: Math.min(1, this.opacity + 0.1) });
      this.updatePanels();
    });
    add(
      "file.new",
      "New document",
      "File",
      () => {
        this.addTab(newDocument());
        this.activate(this.current);
      },
      ["Ctrl+N"],
    );
    add("file.open", "Open project", "File", () => this.open(), ["Ctrl+O"]);
    add("file.save", "Save project", "File", () => this.save(), ["Ctrl+S"]);
    add("file.saveAs", "Save project as…", "File", () => this.save(true), [
      "Ctrl+Shift+S",
    ]);
    add(
      "file.close",
      "Close document tab",
      "File",
      () => this.closeTab(this.current),
      ["Ctrl+W"],
    );
    add("file.rename", "Rename document", "File", () =>
      ask(
        "Rename document",
        [{ name: "name", label: "Document name", value: this.doc.name }],
        (v) => {
          this.change(() => (this.doc.name = v.name.trim() || "Untitled"));
        },
      ),
    );
    add("file.recent", "Recent documents", "File", () => this.recent());
    add(
      "file.import",
      "Import image or PDF",
      "File",
      () => this.chooseAssets(),
      ["Ctrl+I"],
    );
    add("file.export", "Export PNG or PDF", "File", () => this.exportDialog(), [
      "Ctrl+Shift+E",
    ]);
    add(
      "edit.undo",
      "Undo",
      "Edit",
      () => {
        if (this.history.undo()) this.changed();
      },
      ["Ctrl+Z"],
    );
    add(
      "edit.redo",
      "Redo",
      "Edit",
      () => {
        if (this.history.redo()) this.changed();
      },
      ["Ctrl+Y", "Ctrl+Shift+Z"],
    );
    add("edit.copy", "Copy selection", "Edit", () => this.copy(), ["Ctrl+C"]);
    add("edit.paste", "Paste", "Edit", () => this.paste(), ["Ctrl+V"]);
    add(
      "edit.cut",
      "Cut selection",
      "Edit",
      () => {
        this.copy();
        this.deleteSelection();
      },
      ["Ctrl+X"],
    );
    add(
      "selection.delete",
      "Delete selection",
      "Selection",
      () => this.deleteSelection(),
      ["Delete", "Backspace"],
    );
    add(
      "selection.all",
      "Select all unlocked objects",
      "Selection",
      () => {
        this.selection.clear();
        this.doc.objects
          .filter((o) => this.input.editable(o))
          .forEach((o) => this.selection.add(o.id));
        this.updatePanels();
        this.renderer.invalidate();
      },
      ["Ctrl+A"],
    );
    add(
      "selection.clear",
      "Clear selection / cancel drawing",
      "Selection",
      () => {
        this.input.cancel();
        this.selection.clear();
        this.updatePanels();
        this.renderer.invalidate();
      },
      ["Escape"],
    );
    add(
      "selection.duplicate",
      "Duplicate selection",
      "Selection",
      () => this.duplicate(),
      ["Ctrl+D"],
    );
    add(
      "selection.group",
      "Group selection",
      "Selection",
      () =>
        this.change(() => {
          const id = uid();
          this.selected().forEach((o) => (o.group = id));
        }),
      ["Ctrl+G"],
    );
    add(
      "selection.ungroup",
      "Ungroup selection",
      "Selection",
      () => this.change(() => this.selected().forEach((o) => delete o.group)),
      ["Ctrl+Shift+G"],
    );
    add(
      "selection.lock",
      "Toggle selection lock",
      "Selection",
      () =>
        this.change(() =>
          this.selected(true).forEach((o) => (o.locked = !o.locked)),
        ),
      ["Ctrl+L"],
    );
    add(
      "selection.unlockAll",
      "Unlock objects on active layer",
      "Selection",
      () =>
        this.change(() =>
          this.doc.objects
            .filter((o) => o.layer === this.doc.activeLayer)
            .forEach((o) => (o.locked = false)),
        ),
    );
    add("selection.rotate", "Rotate selection 15°", "Selection", () =>
      this.change(() =>
        this.selected().forEach((o) => (o.rotation = (o.rotation || 0) + 15)),
      ),
    );
    add("selection.crop", "Crop selected image", "Selection", () =>
      this.crop(),
    );
    for (const [name, dx, dy, key] of [
      ["left", -1, 0, "ArrowLeft"],
      ["right", 1, 0, "ArrowRight"],
      ["up", 0, -1, "ArrowUp"],
      ["down", 0, 1, "ArrowDown"],
    ])
      add(
        `selection.${name}`,
        `Move selection ${name}`,
        "Selection",
        () =>
          this.change(() =>
            this.selected().forEach((o) => {
              o.x += dx;
              o.y += dy;
            }),
          ),
        [key],
      );
    add("view.zoomIn", "Zoom in", "Navigation", () => this.zoomAt(1.25), [
      "Ctrl+=",
    ]);
    add("view.zoomOut", "Zoom out", "Navigation", () => this.zoomAt(0.8), [
      "Ctrl+-",
    ]);
    add(
      "view.reset",
      "Reset zoom to 100%",
      "Navigation",
      () => this.zoomAt(1 / this.doc.camera.zoom),
      ["Ctrl+0"],
    );
    add("view.fit", "Fit all content", "Navigation", () => this.fit(), [
      "Ctrl+1",
    ]);
    add("view.origin", "Return to origin", "Navigation", () => {
      this.doc.camera = { x: 50, y: 50, zoom: 1 };
      this.renderer.invalidate();
      this.updateZoom();
    });
    add(
      "view.inspector",
      "Toggle properties panel",
      "View",
      () => {
        this.inspectorVisible = !this.inspectorVisible;
        document
          .querySelector("#inspector")
          .classList.toggle("hidden", !this.inspectorVisible);
      },
      ["Tab"],
    );
    add("view.toolbar", "Toggle toolbar", "View", () => {
      this.toolbarVisible = !this.toolbarVisible;
      document
        .querySelector("#toolbar")
        .classList.toggle("hidden", !this.toolbarVisible);
    });
    add(
      "view.focus",
      "Toggle distraction-free view",
      "View",
      () => document.body.classList.toggle("focus"),
      ["F10"],
    );
    add(
      "view.fullscreen",
      "Toggle fullscreen",
      "View",
      () =>
        window.desktop
          ? desktop.fullscreen()
          : document.fullscreenElement
            ? document.exitFullscreen()
            : document.documentElement.requestFullscreen(),
      ["F11"],
    );
    add("view.bookmark", "Add canvas bookmark", "Navigation", () =>
      ask(
        "New bookmark",
        [{ name: "name", label: "Bookmark name", value: "Lecture section" }],
        (v) =>
          this.change(() =>
            this.doc.bookmarks.push({
              name: v.name,
              camera: { ...this.doc.camera },
            }),
          ),
      ),
    );
    add("view.bookmarks", "Go to bookmark", "Navigation", () =>
      this.bookmarks(),
    );
    add("edit.search", "Search typed notes", "Edit", () => this.search(), [
      "Ctrl+F",
    ]);
    add("layer.add", "Add layer", "Layers", () => this.addLayer(), [
      "Ctrl+Shift+N",
    ]);
    add("layer.rename", "Rename active layer", "Layers", () =>
      this.renameLayer(this.doc.activeLayer),
    );
    add("layer.hide", "Toggle active layer visibility", "Layers", () =>
      this.change(() => {
        const l = this.activeLayer();
        l.visible = !l.visible;
      }),
    );
    add("layer.lock", "Toggle active layer lock", "Layers", () =>
      this.change(() => {
        const l = this.activeLayer();
        l.locked = !l.locked;
      }),
    );
    add("layer.up", "Raise active layer", "Layers", () =>
      this.reorderLayer(this.doc.activeLayer, 1),
    );
    add("layer.down", "Lower active layer", "Layers", () =>
      this.reorderLayer(this.doc.activeLayer, -1),
    );
    add("layer.delete", "Delete active layer", "Layers", () =>
      this.deleteLayer(),
    );
    add(
      "app.settings",
      "Settings & appearance",
      "Application",
      () => settingsDialog(this),
      ["Ctrl+,"],
    );
    add(
      "app.shortcuts",
      "Customize keyboard shortcuts",
      "Application",
      () => settingsDialog(this, "shortcuts"),
      ["Ctrl+Shift+K"],
    );
    add("app.presets", "Manage pen presets", "Application", () =>
      settingsDialog(this, "presets"),
    );
    add(
      "app.commands",
      "Search all commands",
      "Application",
      () => this.commandPalette(),
      ["Ctrl+K"],
    );
    add("app.help", "Drawing guide", "Application", () => this.help(), ["F1"]);
    add(
      "draw.finish",
      "Finish polygon",
      "Tools",
      () => this.input.finishPolygon(),
      ["Enter"],
    );
  }
  registerPresets() {
    for (const id of this.registry.commands.keys())
      if (id.startsWith("preset.")) this.registry.commands.delete(id);
    this.settings.presets.forEach((p, i) =>
      this.registry.add(
        `preset.${p.id}`,
        `Preset: ${p.name}`,
        "Presets",
        () => {
          this.setStyle(p);
        },
        /^pen[1-5]$/.test(p.id) ? [p.id.slice(-1)] : [],
      ),
    );
  }
  registerPropertyCommands() {
    for (const [key, label, min, max, step] of [
      ["width", "Stroke width", 0.2, 200, 0.2],
      ["opacity", "Stroke opacity", 0.05, 1, 0.01],
      ["smoothing", "Stroke smoothing", 0, 0.95, 0.01],
    ])
      this.registry.add(
        `style.${key}`,
        `Set ${label.toLowerCase()}`,
        "Stroke",
        () =>
          ask(
            label,
            [
              {
                name: "value",
                label: `${label} (${min}–${max})`,
                type: "number",
                min,
                max,
                step,
                value: this[key],
              },
            ],
            (v) => {
              const value = +v.value;
              if (!Number.isFinite(value) || value < min || value > max)
                throw Error(`Enter a value between ${min} and ${max}.`);
              this.setStyle({ [key]: value });
            },
          ),
      );
    this.registry.add("style.color", "Choose ink color", "Colors", () =>
      ask(
        "Ink color",
        [{ name: "color", label: "HEX color", value: this.color }],
        (v) => this.setColor(v.color),
      ),
    );
    this.registry.add(
      "view.appearance",
      "Canvas background & appearance",
      "View",
      () => settingsDialog(this, "appearance"),
    );
    this.registry.add(
      "style.smoothingUp",
      "Increase smoothing",
      "Stroke",
      () => {
        this.setStyle({ smoothing: Math.min(0.95, this.smoothing + 0.1) });
        this.updatePanels();
      },
    );
    this.registry.add(
      "style.smoothingDown",
      "Decrease smoothing",
      "Stroke",
      () => {
        this.setStyle({ smoothing: Math.max(0, this.smoothing - 0.1) });
        this.updatePanels();
      },
    );
  }
  changeSelectedStyle(objects, key, value) {
    if (
      this.history.changeObjects(objects, () =>
        objects.forEach((o) => (o[key] = value)),
      )
    )
      this.changed();
  }
  styleControl(panel, key, label, selected = null) {
    const value = selected ? mixedValue(selected, key) : this[key];
    const b = button(
      `${label}: ${value == null ? "Mixed" : Number(value.toFixed(2))}`,
      () =>
        propertyPopover(b, label, LIMITS[key], value ?? this[key], (v) => {
          if (selected) this.changeSelectedStyle(selected, key, v);
          else this.setStyle({ [key]: v });
        }),
      "",
      label,
    );
    panel.append(b);
  }
  selectedStyleControls(panel) {
    const objects = this.selected().filter((o) =>
      [
        "stroke",
        "line",
        "arrow",
        "rect",
        "ellipse",
        "polygon",
        "text",
      ].includes(o.type),
    );
    if (!objects.length) return;
    panel.append(
      el("p", { class: "label", text: `Selected objects (${objects.length})` }),
    );
    const value = mixedValue(objects, "color"),
      color = el("input", {
        type: "color",
        value: value || this.color,
        "aria-label": "Selected-object color",
      });
    if (value === null) panel.append(el("small", { text: "Mixed colors" }));
    color.onchange = () =>
      this.changeSelectedStyle(objects, "color", color.value);
    panel.append(color);
    const strokes = objects.filter((o) => o.type !== "text");
    if (strokes.length) this.styleControl(panel, "width", "Width", strokes);
    this.styleControl(panel, "opacity", "Opacity", objects);
  }
  quickProperties() {
    const panel = document.querySelector("#quick-properties");
    if (!panel) return;
    panel.replaceChildren();
    const tool = this.tool;
    if (tool === "select" || tool === "lasso") {
      this.selectedStyleControls(panel);
      panel.append(
        button("Properties", () => this.registry.run("view.inspector")),
        button("Delete", () => this.deleteSelection()),
      );
      return;
    }
    if (tool === "pan") {
      for (const [id, label] of [
        ["view.zoomIn", "Zoom +"],
        ["view.zoomOut", "Zoom −"],
        ["view.fit", "Fit"],
      ])
        panel.append(
          button(
            label,
            () => this.registry.run(id),
            "",
            this.registry.tooltip(id),
          ),
        );
      return;
    }
    if (["eraser", "partial"].includes(tool)) {
      panel.append(el("small", { text: "Erase" }));
      this.styleControl(panel, "eraserSize", "Size");
      panel.append(
        button(tool === "eraser" ? "Whole stroke" : "Partial", () =>
          this.setTool(tool === "eraser" ? "partial" : "eraser"),
        ),
      );
      const ring = el("div", {
        class: "eraser-preview",
        title: "Eraser diameter in canvas units",
      });
      panel.append(ring);
      return;
    }
    panel.append(
      el("small", { text: tool === "text" ? "New text" : "New ink" }),
    );
    this.styleControl(
      panel,
      tool === "text" ? "fontSize" : "width",
      tool === "text" ? "Font" : "Width",
    );
    this.styleControl(panel, "opacity", "Opacity");
    if (["pen", "highlighter"].includes(tool))
      this.styleControl(panel, "smoothing", "Smooth");
    const c = el("input", {
      type: "color",
      value: this.color,
      "aria-label": "Quick ink color",
    });
    c.onchange = () => this.setColor(c.value);
    panel.append(c);
    const preview = el("div", {
      class: "stroke-preview",
      "aria-label": "Stroke preview",
    });
    preview.innerHTML = `<svg viewBox="0 0 60 24" width="52" height="24"><path d="M5 18Q15 3 30 12T55 7" fill="none" stroke="${this.color}" stroke-width="${Math.min(15, this.width)}" opacity="${this.opacity}" stroke-linecap="round"/></svg>`;
    panel.append(preview);
  }
  bindEvents() {
    document.addEventListener("click", (e) => {
      const c = e.target.closest("[data-cmd]");
      if (c) this.registry.run(c.dataset.cmd);
    });
    document.querySelector("#file-menu").onclick = () => this.fileMenu();
    window.addEventListener("keydown", (e) => {
      if (document.querySelector("dialog[open]") || typingTarget(e.target))
        return;
      const binding = normalizeKey(e),
        command = this.registry.find(binding);
      if (!command) return;
      e.preventDefault();
      if (e.repeat && command.hold) return;
      if (command.hold) this.heldCode = e.code;
      command.run();
    });
    window.addEventListener("keyup", (e) => {
      if (e.code === this.heldCode) {
        this.input.releaseHold();
        this.heldCode = null;
      }
    });
    const wrap = document.querySelector("#canvas-wrap");
    wrap.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    wrap.addEventListener("drop", (e) => {
      e.preventDefault();
      this.safe(() => this.importBrowserFiles([...e.dataTransfer.files]));
    });
    window.addEventListener("beforeunload", (e) => {
      this.safe(() => this.autosave());
      if (this.tabs.some((t) => t.dirty) && !this.allowClose) {
        e.preventDefault();
        e.returnValue = "Unsaved changes have not been saved to a file.";
        if (window.desktop) this.closeWindowDialog();
      }
    });
  }
  async safe(fn) {
    try {
      return await fn();
    } catch (e) {
      console.error(e);
      this.toast(e.message || String(e));
    }
  }
  toast(message) {
    const e = document.querySelector("#toast");
    e.textContent = message;
    e.classList.remove("hidden");
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => e.classList.add("hidden"), 5200);
  }
  persist() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(
      () =>
        this.safe(() =>
          window.desktop
            ? desktop.settingsWrite(this.settings)
            : localStorage.setItem(
                "nocturne.settings",
                JSON.stringify(this.settings),
              ),
        ),
      250,
    );
    this.applyTheme();
  }
  applyTheme() {
    const s = document.documentElement.style;
    for (const [key, value] of Object.entries(this.settings.theme))
      s.setProperty(key === "background" ? "--bg" : `--${key}`, value);
    s.setProperty("--scale", this.settings.uiScale);
    s.setProperty("--tool-size", this.settings.toolbarSize + "px");
    document.body.classList.toggle(
      "large-controls",
      this.settings.largeControls,
    );
    document
      .querySelector("#workarea")
      .classList.toggle("toolbar-right", this.settings.toolbarSide === "right");
    this.renderer?.invalidate();
  }
  setStyle(patch) {
    updateStyle(this, patch);
    this.buildToolbar();
    this.updatePanels();
    this.cursor?.update();
  }
  setTool(tool) {
    this.setStyle({ tool });
  }
  setColor(color) {
    this.setStyle({ color });
    this.settings.recentColors = [
      this.color,
      ...this.settings.recentColors.filter((c) => c !== this.color),
    ].slice(0, 10);
    this.persist();
  }
  setWidth(width) {
    this.setStyle({ width });
  }
  buildToolbar() {
    if (!this.registry) return;
    const bar = document.querySelector("#toolbar");
    bar.replaceChildren();
    const ordered = this.orderedTools();
    for (const [id, label] of ordered) {
      if (["line", "arrow", "rect", "ellipse", "polygon"].includes(id))
        continue;
      if (
        this.settings.hiddenTools.includes(id) &&
        !["pen", "eraser", "select", "text", "pan"].includes(id)
      )
        continue;
      const b = button(
        "",
        () => this.registry.run(`tool.${id}`),
        this.tool === id ? "active" : "",
        this.registry.tooltip(`tool.${id}`),
      );
      b.innerHTML = icon(id);
      b.setAttribute("aria-pressed", this.tool === id);
      if (this.settings.shortcutLabels)
        b.append(
          el("small", {
            text: this.registry.bindings(`tool.${id}`).join(" / "),
          }),
        );
      b.setAttribute("aria-label", label);
      bar.append(b);
    }
    bar.append(el("div", { class: "divider" }));
    for (const p of this.settings.presets) {
      const b = button(
        "",
        () => this.registry.run(`preset.${p.id}`),
        "preset" + (matchesPreset(this, p) ? " active" : ""),
        `${this.registry.tooltip(`preset.${p.id}`)} · ${p.width} px · ${Math.round(p.opacity * 100)}% opacity`,
      );
      b.innerHTML = `<span class="pen-dot" style="--swatch:${esc(p.color)}"></span>`;
      b.setAttribute("aria-label", p.name);
      bar.append(b);
    }
    const presetButtons = [...bar.querySelectorAll(".preset")];
    bar.prepend(...presetButtons, el("div", { class: "divider" }));
    const shapes = button(
      "Shapes",
      () => {
        const body = el("div", { class: "stack" });
        const d = dialog("Shapes", body);
        for (const id of ["line", "arrow", "rect", "ellipse", "polygon"])
          body.append(
            button(this.registry.tooltip(`tool.${id}`), () => {
              d.close();
              this.registry.run(`tool.${id}`);
            }),
          );
      },
      "rail-label",
      "Shapes",
    );
    bar.append(
      shapes,
      button(
        "Import",
        () => this.registry.run("file.import"),
        "rail-label",
        this.registry.tooltip("file.import"),
      ),
      button(
        "More",
        () => this.registry.run("app.commands"),
        "rail-label",
        "More tools and commands",
      ),
    );
    bar.querySelectorAll(".preset").forEach((b, i) => {
      b.innerHTML =
        '<svg viewBox="0 0 32 20" width="28" height="18" aria-hidden="true"><path d="M3 15 Q8 2 13 5 Q15 7 10 14 Q18 4 22 8 Q23 10 20 14 Q25 10 29 12" fill="none" stroke="' +
        this.settings.presets[i].color +
        '" stroke-width="2.4" stroke-linecap="round"/></svg><small>' +
        this.settings.presets[i].width +
        "</small>";
    });
    document
      .querySelectorAll("[data-cmd]")
      .forEach((b) => (b.title = this.registry.tooltip(b.dataset.cmd)));
  }
  orderedTools() {
    return [...TOOLS].sort((a, b) => {
      const order = this.settings.toolOrder;
      return (
        (order.indexOf(a[0]) < 0 ? 999 : order.indexOf(a[0])) -
        (order.indexOf(b[0]) < 0 ? 999 : order.indexOf(b[0]))
      );
    });
  }
  updateTabs() {
    const t = document.querySelector("#tabs");
    t.replaceChildren();
    this.tabs.forEach((tab, i) => {
      const b = button(
        `${tab.dirty ? "• " : ""}${tab.doc.name}`,
        () => this.activate(i),
        i === this.current ? "active" : "",
      );
      b.onauxclick = (e) => {
        if (e.button === 1) this.closeTab(i);
      };
      const wrap = el("div", { class: "tab-item" }, [b]);
      if (this.tabs.length > 1)
        wrap.append(
          button(
            "×",
            () => this.closeTab(this.tabs.indexOf(tab)),
            "tab-close",
            `Close ${tab.doc.name}`,
          ),
        );
      t.append(wrap);
    });
    t.append(
      button("+", () => this.registry.run("file.new"), "", "New document"),
    );
    t.classList.toggle("single-tab", this.tabs.length === 1);
    document.querySelector("#title").textContent =
      this.doc.name + (this.tab.dirty ? " •" : "");
    this.updateStatus();
  }
  activate(i) {
    this.input?.cancel();
    this.current = i;
    this.selection.clear();
    if (this.renderer) {
      this.renderer.region = null;
      this.renderer.rebuild();
    }
    this.updateTabs();
    this.updatePanels();
    this.updateZoom();
  }
  selected(includeLocked = false) {
    return this.doc.objects.filter(
      (o) =>
        this.selection.has(o.id) && (includeLocked || this.input.editable(o)),
    );
  }
  change(fn) {
    if (this.history.change(fn)) this.changed();
  }
  changed() {
    edited(this.tab);
    this.recovery.changed();
    for (const id of this.selection)
      if (!this.doc.objects.some((o) => o.id === id)) this.selection.delete(id);
    this.renderer.rebuild();
    this.updateTabs();
    this.updatePanels();
    document
      .querySelector("#welcome")
      .classList.toggle("hidden", this.doc.objects.length > 0);
    this.updateStatus();
  }
  updateZoom() {
    document.querySelector("#zoom").textContent =
      Math.round(this.doc.camera.zoom * 100) + "%";
    document.querySelector("#coordinates").textContent =
      `${Math.round(-this.doc.camera.x / this.doc.camera.zoom)}, ${Math.round(-this.doc.camera.y / this.doc.camera.zoom)} · Infinite canvas`;
    this.recovery.changed();
  }
  zoomAt(
    factor,
    p = { x: this.renderer.width / 2, y: this.renderer.height / 2 },
  ) {
    const c = this.doc.camera,
      w = this.renderer.world(p);
    c.zoom = Math.min(16, Math.max(0.02, c.zoom * factor));
    c.x = p.x - w.x * c.zoom;
    c.y = p.y - w.y * c.zoom;
    this.renderer.invalidate();
    this.updateZoom();
  }
  fit(objects = this.doc.objects) {
    const b = union(objects),
      pad = 60,
      c = this.doc.camera;
    c.zoom = Math.max(
      0.02,
      Math.min(
        4,
        (this.renderer.width - pad * 2) / b.w,
        (this.renderer.height - pad * 2) / b.h,
      ),
    );
    c.x = (this.renderer.width - b.w * c.zoom) / 2 - b.x * c.zoom;
    c.y = (this.renderer.height - b.h * c.zoom) / 2 - b.y * c.zoom;
    this.renderer.invalidate();
    this.updateZoom();
  }
  activeLayer() {
    return this.doc.layers.find((l) => l.id === this.doc.activeLayer);
  }
  addLayer() {
    this.change(() => {
      const l = {
        id: uid(),
        name: `Layer ${this.doc.layers.length + 1}`,
        visible: true,
        locked: false,
        opacity: 1,
      };
      this.doc.layers.push(l);
      this.doc.activeLayer = l.id;
    });
  }
  renameLayer(id) {
    const l = this.doc.layers.find((l) => l.id === id);
    return ask(
      "Rename layer",
      [{ name: "name", label: "Name", value: l.name }],
      (v) => this.change(() => (l.name = v.name || "Layer")),
    );
  }
  reorderLayer(id, delta) {
    this.change(() => {
      const i = this.doc.layers.findIndex((l) => l.id === id),
        j = i + delta;
      if (j >= 0 && j < this.doc.layers.length)
        [this.doc.layers[i], this.doc.layers[j]] = [
          this.doc.layers[j],
          this.doc.layers[i],
        ];
    });
  }
  deleteLayer() {
    if (this.doc.layers.length === 1) {
      this.toast("Keep at least one layer.");
      return;
    }
    dialog(
      "Delete layer?",
      `<p>Delete ${esc(this.activeLayer().name)} and its objects? You can undo this.</p>`,
      [
        { label: "Cancel", run: (d) => d.close() },
        {
          label: "Delete layer",
          run: (d) => {
            this.change(() => {
              this.doc.objects = this.doc.objects.filter(
                (o) => o.layer !== this.doc.activeLayer,
              );
              this.doc.layers = this.doc.layers.filter(
                (l) => l.id !== this.doc.activeLayer,
              );
              this.doc.activeLayer = this.doc.layers.at(-1).id;
            });
            d.close();
          },
        },
      ],
    );
  }
  updatePanels() {
    if (!this.renderer) return;
    this.quickProperties();
    const panel = document.querySelector("#inspector");
    panel.replaceChildren();
    panel.append(
      el("h3", {
        text: TOOLS.find((t) => t[0] === this.tool)?.[1] || "Properties",
      }),
    );
    if (
      [
        "pen",
        "highlighter",
        "line",
        "arrow",
        "rect",
        "ellipse",
        "polygon",
      ].includes(this.tool)
    ) {
      panel.append(
        el("p", { class: "label", text: "New strokes (drawing style)" }),
      );
      const row = el("div", { class: "row" }),
        color = el("input", { type: "color", "aria-label": "Stroke color" });
      color.value = this.color;

      color.onchange = () => this.setColor(color.value);
      const hex = el("input", {
        type: "text",
        value: this.color,
        "aria-label": "HEX stroke color",
        style: "width:135px",
      });
      hex.onchange = () => this.safe(() => this.setColor(hex.value));
      row.append(color, hex);
      panel.append(
        el("div", { class: "field" }, [
          el("label", { text: "INK COLOR" }),
          row,
        ]),
      );
      const swatches = el("div", { class: "swatches" });
      for (const c of [
        ...new Set([...this.settings.swatches, ...this.settings.recentColors]),
      ])
        swatches.append(
          el("button", {
            class: "swatch",
            style: `--swatch:${c}`,
            title: c,
            "aria-label": `Color ${c}`,
            onClick: () => this.setColor(c),
          }),
        );
      panel.append(swatches, el("div", { class: "divider" }));
      for (const [label, value, min, max, step, handler] of [
        [
          "Stroke width",
          this.width,
          ...LIMITS.width,
          (v) => this.setStyle({ width: v }),
        ],
        [
          "Opacity",
          this.opacity,
          0.05,
          1,
          0.01,
          (v) => this.setStyle({ opacity: v }),
        ],
        [
          "Smoothing",
          this.smoothing,
          0,
          0.95,
          0.01,
          (v) => this.setStyle({ smoothing: v }),
        ],
      ]) {
        const output = el("span", {
            class: "value",
            text:
              label === "Stroke width"
                ? value.toFixed(1) + " px"
                : Math.round(value * 100) + "%",
          }),
          range = el("input", {
            type: "range",
            min,
            max,
            step,
            value,
            "aria-label": label,
          });
        range.onchange = () => handler(+range.value);
        range.oninput = () => {
          output.textContent =
            label === "Stroke width"
              ? (+range.value).toFixed(1) + " px"
              : Math.round(+range.value * 100) + "%";
        };
        panel.append(
          el("div", { class: "field" }, [
            el("label", { class: "row between" }, [
              el("span", { text: label }),
              output,
            ]),
            range,
          ]),
        );
      }
      panel.append(
        button(
          "Save as preset",
          () => this.savePreset(),
          "",
          "Capture current tool, color and stroke settings",
        ),
      );
    } else if (["eraser", "partial"].includes(this.tool)) {
      this.styleControl(panel, "eraserSize", "Eraser size");
      panel.append(
        button("Whole-stroke eraser", () => this.setTool("eraser")),
        button("Partial eraser", () => this.setTool("partial")),
      );
    } else if (this.tool === "text") {
      this.styleControl(panel, "fontSize", "New text size");
      const color = el("input", {
        type: "color",
        value: this.color,
        "aria-label": "New text color",
      });
      color.onchange = () => this.setColor(color.value);
      panel.append(color);
    } else if (this.tool === "pan") {
      panel.append(
        button("Fit content", () => this.fit()),
        button("Reset zoom", () => this.registry.run("view.reset")),
      );
    }
    const selected = this.selected(true);
    this.selectedStyleControls(panel);
    if (selected.length) {
      if (
        selected.some(
          (o) => ["image", "pdf"].includes(o.type) && !this.input.editable(o),
        )
      ) {
        panel.append(
          button("Unlock image / PDF to move", () =>
            this.change(() => {
              for (const o of selected) {
                const layer = this.doc.layers.find((l) => l.id === o.layer);
                if (layer?.locked) {
                  // Keep other objects protected when unlocking this layer.
                  this.doc.objects
                    .filter((item) => item.layer === layer.id)
                    .forEach((item) => (item.locked = true));
                  layer.locked = false;
                }
                o.locked = false;
              }
            }),
          ),
        );
      }
      panel.append(
        el("div", { class: "divider" }),
        el("div", { class: "label", text: `${selected.length} selected` }),
      );
      if (selected.length === 1) {
        const o = selected[0],
          grid = el("div", { class: "property-grid" });
        for (const [key, label] of [
          ["x", "X"],
          ["y", "Y"],
          ["w", "Width"],
          ["h", "Height"],
          ["rotation", "Rotation °"],
        ]) {
          const input = el("input", {
            type: "number",
            step: "1",
            value: Math.round(o[key] || 0),
            "aria-label": `Object ${label}`,
          });
          input.onchange = () =>
            this.safe(() => {
              if (!this.input.editable(o)) {
                this.toast("Unlock the object and layer first.");
                return;
              }
              const value = +input.value;
              if (
                !Number.isFinite(value) ||
                (["w", "h"].includes(key) && value <= 0)
              )
                return;
              this.change(() => {
                if (key === "w" || key === "h")
                  resizeObject(
                    o,
                    key === "w" ? value / o.w : 1,
                    key === "h" ? value / o.h : 1,
                    { x: o.x, y: o.y },
                  );
                else o[key] = value;
              });
            });
          grid.append(el("label", { text: label }, [input]));
        }
        panel.append(grid);
        if (o.type === "text")
          panel.append(button("Edit text", () => this.editText(o)));
        if (o.type === "image")
          panel.append(button("Crop image", () => this.crop()));
      }
      panel.append(
        el("div", { class: "row" }, [
          button("Duplicate", () => this.registry.run("selection.duplicate")),
          button(selected.every((o) => o.locked) ? "Unlock" : "Lock", () =>
            this.registry.run("selection.lock"),
          ),
        ]),
        button("Delete selection", () => this.deleteSelection(), "danger"),
      );
    }
    panel.append(
      el("div", { class: "divider" }),
      el("div", { class: "row between" }, [
        el("span", { class: "label", text: "Layers" }),
        button("+", () => this.addLayer(), "", "Add layer"),
      ]),
    );
    for (const layer of [...this.doc.layers].reverse()) {
      const entry = el("div", {
          class: "layer" + (layer.id === this.doc.activeLayer ? " active" : ""),
        }),
        name = el("button", {
          class: "layer-name",
          text: layer.name,
          title: "Click to activate · double-click to rename",
          onClick: () => {
            this.doc.activeLayer = layer.id;
            this.updatePanels();
          },
        });
      name.ondblclick = () => this.renameLayer(layer.id);
      entry.append(
        el("div", { class: "row" }, [
          button(
            layer.visible ? "◉" : "○",
            () => this.change(() => (layer.visible = !layer.visible)),
            "",
            "Show/hide layer",
          ),
          name,
          button(
            layer.locked ? "▣" : "▢",
            () => this.change(() => (layer.locked = !layer.locked)),
            "",
            "Lock/unlock layer",
          ),
          button("↑", () => this.reorderLayer(layer.id, 1), "", "Raise layer"),
          button("↓", () => this.reorderLayer(layer.id, -1), "", "Lower layer"),
        ]),
      );
      const opacity = el("input", {
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
        value: layer.opacity,
        "aria-label": `Opacity of ${layer.name}`,
      });
      opacity.onchange = () =>
        this.change(() => (layer.opacity = +opacity.value));
      entry.append(opacity);
      panel.append(entry);
    }
    panel.append(
      el("div", { class: "divider" }),
      button("Canvas & appearance", () => settingsDialog(this, "appearance")),
      button("Bookmarks", () => this.bookmarks()),
      button("Keyboard shortcuts", () => settingsDialog(this, "shortcuts")),
    );
    document
      .querySelector("#welcome")
      .classList.toggle("hidden", this.doc.objects.length > 0);
  }
  async savePreset() {
    await ask(
      "Save tool preset",
      [{ name: "name", label: "Preset name", value: "My pen" }],
      (v) => {
        this.settings.presets.push({
          id: uid(),
          name: v.name,
          tool: this.tool,
          color: this.color,
          width: this.width,
          opacity: this.opacity,
          smoothing: this.smoothing,
        });
        this.registerPresets();
        this.persist();
        this.buildToolbar();
      },
    );
  }
  deleteSelection() {
    const ids = new Set(this.selected().map((o) => o.id));
    this.change(
      () => (this.doc.objects = this.doc.objects.filter((o) => !ids.has(o.id))),
    );
  }
  copy() {
    const objects = this.selected(true);
    if (!objects.length) return;
    this.clipboardObjects = {
      objects: clone(objects),
      assets: Object.fromEntries(
        objects
          .filter((o) => o.asset)
          .map((o) => [o.asset, this.doc.assets[o.asset]]),
      ),
    };
    this.toast(
      `${objects.length} objects copied. Use Paste objects in the File menu if the system clipboard has an image.`,
    );
  }
  duplicate() {
    const objects = clone(this.selected()),
      groups = new Map();
    this.change(() => {
      this.selection.clear();
      for (const o of objects) {
        o.id = uid();
        o.x += 24;
        o.y += 24;
        o.locked = false;
        if (o.group) {
          if (!groups.has(o.group)) groups.set(o.group, uid());
          o.group = groups.get(o.group);
        }
        this.doc.objects.push(o);
        this.selection.add(o.id);
      }
    });
  }
  pasteObjects() {
    if (!this.clipboardObjects) return;
    this.change(() => {
      this.selection.clear();
      Object.assign(this.doc.assets, this.clipboardObjects.assets);
      const groups = new Map();
      for (const original of this.clipboardObjects.objects) {
        const o = clone(original);
        o.id = uid();
        o.x += 24;
        o.y += 24;
        o.layer = this.doc.activeLayer;
        o.locked = false;
        if (o.group) {
          if (!groups.has(o.group)) groups.set(o.group, uid());
          o.group = groups.get(o.group);
        }
        this.doc.objects.push(o);
        this.selection.add(o.id);
      }
    });
  }
  async paste() {
    if (window.desktop) {
      const clip = await desktop.clipboard();
      if (clip.files?.length) {
        for (const f of clip.files) await this.importFile(f);
        return;
      }
      if (clip.image) {
        await this.addImage(clip.image, "Clipboard screenshot");
        return;
      }
      if (this.clipboardObjects) {
        this.pasteObjects();
        return;
      }
      if (clip.text) {
        this.editText(null, this.renderer.world({ x: 100, y: 100 }), clip.text);
        return;
      }
    } else {
      try {
        for (const item of await navigator.clipboard.read())
          for (const type of item.types)
            if (type.startsWith("image/")) {
              const b = await item.getType(type);
              await this.importBrowserFiles([
                new File([b], "Clipboard.png", { type }),
              ]);
              return;
            }
      } catch {}
      if (this.clipboardObjects) {
        this.pasteObjects();
        return;
      }
    }
    this.toast(
      "No supported image, PDF file, text, or copied objects on the clipboard.",
    );
  }
  editText(object, p = { x: 0, y: 0 }, initial = "") {
    if (object && !this.input.editable(object)) {
      this.toast("Unlock this text before editing.");
      return;
    }
    document.querySelector("#text-editor")?.remove();
    document.querySelector("#text-actions")?.remove();
    const at = this.renderer.screen(object || p),
      wrap = document.querySelector("#canvas-wrap"),
      text = el("textarea", {
        id: "text-editor",
        "aria-label": "Edit note text",
        style: `left:${Math.max(0, Math.min(at.x, this.renderer.width - 300))}px;top:${Math.max(0, Math.min(at.y, this.renderer.height - 180))}px;color:${object?.color || this.color};font-size:20px;`,
      });
    text.value = object?.text || initial;
    const finish = () => {
      if (text.value.trim())
        this.change(() => {
          const value = text.value,
            lines = value.split("\n"),
            font = object?.fontSize || this.fontSize,
            ctx = this.renderer.canvas.getContext("2d");
          ctx.font = `${font}px "Segoe UI"`;
          const model = {
            text: value,
            w: Math.max(20, ...lines.map((l) => ctx.measureText(l).width)),
            h: lines.length * font * 1.3,
          };
          if (object) Object.assign(object, model);
          else
            this.doc.objects.push({
              id: uid(),
              type: "text",
              layer: this.doc.activeLayer,
              x: p.x,
              y: p.y,
              ...model,
              rotation: 0,
              fontSize: font,
              color: this.color,
              opacity: this.opacity,
            });
        });
      text.remove();
      actions.remove();
    };
    const actions = el(
      "div",
      {
        id: "text-actions",
        class: "row",
        style: `left:${Math.max(0, Math.min(at.x, this.renderer.width - 300))}px;top:${Math.max(0, Math.min(at.y, this.renderer.height - 180)) + 115}px;`,
      },
      [
        button("Done · Ctrl+Enter", finish, "primary"),
        button("Cancel", () => {
          text.remove();
          actions.remove();
        }),
      ],
    );
    text.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        finish();
      }
      if (e.key === "Escape") {
        text.remove();
        actions.remove();
      }
    });
    wrap.append(text, actions);
    text.focus();
  }
  crop() {
    const o = this.selected()[0];
    if (!o || o.type !== "image") {
      this.toast("Select an unlocked image first.");
      return;
    }
    const crop = o.crop || { x: 0, y: 0, w: 1, h: 1 };
    return ask(
      "Crop image — percentages of original",
      [
        ...["x", "y", "w", "h"].map((key, i) => ({
          name: key,
          label: ["Left %", "Top %", "Width %", "Height %"][i],
          type: "number",
          min: 0,
          max: 100,
          value: crop[key] * 100,
        })),
      ],
      (v) => {
        const c = Object.fromEntries(
          Object.entries(v).map(([k, v]) => [k, +v / 100]),
        );
        if (
          c.w <= 0 ||
          c.h <= 0 ||
          c.x < 0 ||
          c.y < 0 ||
          c.x + c.w > 1.00001 ||
          c.y + c.h > 1.00001
        )
          throw Error("Crop must lie inside the original image.");
        this.change(() => (o.crop = c));
      },
    );
  }
  updateStatus() {
    const tab = this.tab;
    const state = tab.saving
      ? "Saving…"
      : tab.dirty
        ? tab.recoveryRevision === tab.revision
          ? "Unsaved changes · Recovery updated"
          : "Unsaved changes"
        : tab.savedRevision > 0 || tab.path
          ? "Saved to file"
          : "Not saved to a file";
    document.querySelector("#status").textContent =
      `${state} · ${tab.doc.objects.length.toLocaleString()} objects`;
  }
  async save(saveAs = false) {
    const tab = this.tab;
    const task = saveRevision(tab, async (data, name, path) => {
      if (window.desktop) return desktop.save(data, path, saveAs, name);
      await this.download(
        new TextEncoder().encode(data),
        `${name.replace(/[<>:"/\\|?*]/g, "-") || "Untitled"}.nocturne`,
      );
      return true;
    });
    this.updateStatus();
    try {
      const saved = await task;
      if (saved) {
        this.recovery.changed();
        await this.safe(() => this.autosave());
        this.toast(
          tab.dirty
            ? "Snapshot saved; newer edits remain unsaved."
            : "Project saved to file.",
        );
      }
      return saved;
    } finally {
      this.updateTabs();
      this.updateStatus();
    }
  }
  async open() {
    if (window.desktop) {
      for (const f of await desktop.open("project")) this.openData(f);
    } else {
      const input = el("input", { type: "file", accept: ".nocturne" });
      input.onchange = () =>
        this.safe(async () => {
          const f = input.files[0];
          this.addTab(deserialize(await f.text()));
          this.activate(this.current);
        });
      input.click();
    }
  }
  openData(f) {
    const doc = deserialize(new TextDecoder().decode(bytesFromData(f.data)));
    const existing = this.tabs.findIndex((t) => t.path === f.path);
    if (existing >= 0) {
      this.activate(existing);
      return;
    }
    this.addTab(doc, f.path);
    this.activate(this.current);
  }
  async recent() {
    const files = window.desktop ? await desktop.recent() : [];
    const body = el("div", { class: "stack" });
    const d = dialog("Recent documents", body);
    if (!files.length) body.append(el("p", { text: "No saved projects yet." }));
    for (const file of files)
      body.append(
        button(file, () =>
          this.safe(async () => {
            this.openData(await desktop.openRecent(file));
            d.close();
          }),
        ),
      );
  }
  async closeTab(i) {
    const tab = this.tabs[i];
    if (tab.dirty) {
      dialog(
        "Save changes?",
        `<p>${esc(tab.doc.name)} has unsaved changes.</p>`,
        [
          { label: "Cancel", run: (d) => d.close() },
          {
            label: "Discard",
            run: (d) => {
              d.close();
              this.removeTab(i);
            },
          },
          {
            label: "Save",
            primary: true,
            run: async (d) => {
              this.activate(i);
              if ((await this.save()) && !tab.dirty) {
                d.close();
                this.removeTab(i);
              }
            },
          },
        ],
      );
      return;
    }
    this.removeTab(i);
  }
  removeTab(i) {
    const active = this.tab;
    this.input.cancel();
    this.tabs.splice(i, 1);
    this.pdf.releaseUnused(this.tabs);
    if (!this.tabs.length) this.addTab(newDocument());
    this.current = this.tabs.includes(active)
      ? this.tabs.indexOf(active)
      : Math.min(i, this.tabs.length - 1);
    this.activate(this.current);
    this.recovery.changed();
    this.safe(() => this.autosave());
  }
  closeWindowDialog() {
    if (document.querySelector("dialog[open]")) return;
    dialog(
      "Close Nocturne?",
      `<p>Recovery is separate from saving a project file. Closing will first write a fresh recovery copy for the next launch.</p>`,
      [
        { label: "Keep working", run: (d) => d.close() },
        {
          label: "Close with recovery",
          run: async (d) => {
            do {
              await this.autosave();
            } while (this.recovery.dirty);
            this.allowClose = true;
            d.close();
            window.close();
          },
        },
      ],
    );
  }
  async autosave() {
    try {
      await this.recovery.write(this.tabs, (docs) =>
        window.desktop
          ? desktop.autosave(docs)
          : localStorage.setItem("nocturne.recovery", JSON.stringify(docs)),
      );
      this.updateStatus();
    } catch (error) {
      throw Error(
        "Recovery could not be written. Keep this window open, check free disk space and folder access, then retry or save a project file. " +
          error.message,
      );
    }
  }
  async restoreRecovery() {
    let items = [];
    try {
      items = window.desktop
        ? await desktop.recover()
        : JSON.parse(localStorage.getItem("nocturne.recovery") || "[]");
    } catch {}
    if (!items.some((t) => t.dirty)) return;
    dialog(
      "Recover your notes",
      `<p>Recovery copies are available for ${items.filter((t) => t.dirty).length} unsaved document(s).</p>`,
      [
        {
          label: "Discard recovery",
          run: async (d) => {
            if (window.desktop) await desktop.markClean();
            else localStorage.removeItem("nocturne.recovery");
            d.close();
          },
        },
        {
          label: "Recover notes",
          primary: true,
          run: (d) => {
            this.safe(() => {
              this.tabs = [];
              for (const t of items)
                this.addTab(
                  deserialize(JSON.stringify(t.doc)),
                  t.path,
                  t.dirty,
                );
              this.activate(
                Math.max(
                  0,
                  this.tabs.findIndex((tab) => tab.dirty),
                ),
              );
              this.toast(
                "Recovered editable notes. Save a project to keep them.",
              );
              d.close();
            });
          },
        },
      ],
    );
  }
  async chooseAssets() {
    if (window.desktop) {
      for (const f of await desktop.open("assets")) await this.importFile(f);
    } else {
      const input = el("input", {
        type: "file",
        accept: "image/*,.pdf",
        multiple: "",
      });
      input.onchange = () =>
        this.safe(() => this.importBrowserFiles([...input.files]));
      input.click();
    }
  }
  async importBrowserFiles(files) {
    for (const file of files) {
      const data = base64(new Uint8Array(await file.arrayBuffer()));
      await this.importFile({ name: file.name, data });
    }
  }
  async importFile(file) {
    if (/\.pdf$/i.test(file.name)) return this.addPdf(file);
    const ext = file.name.split(".").at(-1).toLowerCase(),
      mime = {
        jpg: "jpeg",
        jpeg: "jpeg",
        png: "png",
        webp: "webp",
        gif: "gif",
        bmp: "bmp",
      }[ext];
    if (!mime)
      throw Error("Supported imports: PNG, JPEG, WebP, GIF, BMP, PDF.");
    return this.addImage(`data:image/${mime};base64,${file.data}`, file.name);
  }
  async addImage(data, name) {
    const img = new Image();
    img.src = data;
    await img.decode();
    const p = this.renderer.world({ x: 80, y: 80 }),
      asset = { id: uid(), name, type: "image", data },
      scale = Math.min(1, 900 / img.naturalWidth);
    this.ensureWritableLayer();
    this.change(() => {
      this.doc.assets[asset.id] = asset;
      const o = {
        id: uid(),
        type: "image",
        asset: asset.id,
        layer: this.doc.activeLayer,
        x: p.x,
        y: p.y,
        w: img.naturalWidth * scale,
        h: img.naturalHeight * scale,
        rotation: 0,
        opacity: 1,
      };
      this.doc.objects.push(o);
      this.selection.clear();
      this.selection.add(o.id);
    });
    this.setTool("select");
  }
  ensureWritableLayer() {
    if (this.activeLayer().locked || !this.activeLayer().visible)
      this.addLayer();
  }
  async addPdf(file) {
    this.toast("Reading PDF…");
    const asset = {
        id: uid(),
        name: file.name,
        type: "pdf",
        data: `data:application/pdf;base64,${file.data}`,
      },
      pdf = await this.pdf.load(asset);
    await ask(
      `Import ${file.name} · ${pdf.numPages} pages`,
      [
        { name: "pages", label: "Pages (all, or e.g. 1, 3-5)", value: "all" },
        {
          name: "layout",
          label: "Page arrangement",
          options: ["vertical", "horizontal", "grid"],
          value: "vertical",
        },
        {
          name: "columns",
          label: "Grid columns",
          type: "number",
          min: 1,
          max: 20,
          value: 2,
        },
        {
          name: "gap",
          label: "Space between pages",
          type: "number",
          min: 0,
          max: 500,
          value: 32,
        },
      ],
      async (v) => {
        if (+v.columns < 1 || +v.columns > 20 || +v.gap < 0 || +v.gap > 500)
          throw Error("Invalid page layout.");
        const objects = await this.pdf.importPages(
          asset,
          v.pages,
          v.layout,
          Math.floor(+v.columns),
          +v.gap,
          this.renderer.world({ x: 50, y: 50 }),
        );
        this.change(() => {
          this.doc.assets[asset.id] = asset;
          const l = {
            id: uid(),
            name: file.name,
            visible: true,
            locked: true,
            opacity: 1,
          };
          this.doc.layers.unshift(l);
          objects.forEach((o) => (o.layer = l.id));
          this.doc.objects.unshift(...objects);
        });
        this.ensureWritableLayer();
        this.fit(objects);
        this.toast(
          "Original PDF preserved. Draw annotations on the Notes layer.",
        );
      },
      "Import pages",
      (form, d) => {
        const preview = el("div", { class: "pdf-import-preview" }),
          message = el("p", { class: "muted", role: "status" });
        form.prepend(message, preview);
        let revision = 0;
        const refresh = async () => {
          const own = ++revision;
          message.textContent = "Preparing page thumbnails…";
          try {
            const v = Object.fromEntries(new FormData(form));
            const pages = await this.pdf.importPages(
              asset,
              v.pages,
              v.layout,
              Math.max(1, +v.columns),
              Math.max(0, +v.gap),
              { x: 0, y: 0 },
            );
            if (own !== revision || !d.open) return;
            preview.replaceChildren();
            const box = union(pages),
              scale = Math.min(360 / box.w, 180 / box.h);
            const layout = el("div", {
              class: "pdf-layout",
              style: `height:${Math.max(20, box.h * scale)}px`,
            });
            for (const page of pages)
              layout.append(
                el("span", {
                  text: String(page.page + 1),
                  style: `left:${(page.x - box.x) * scale}px;top:${(page.y - box.y) * scale}px;width:${Math.max(4, page.w * scale)}px;height:${Math.max(4, page.h * scale)}px`,
                }),
              );
            preview.append(layout);
            const thumbs = el("div", { class: "pdf-thumbnails" });
            preview.append(thumbs);
            for (const item of pages.slice(0, 6)) {
              if (own !== revision || !d.open) return;
              const page = await pdf.getPage(item.page + 1),
                v = page.getViewport({
                  scale: Math.min(100 / item.w, 130 / item.h),
                }),
                canvas = document.createElement("canvas");
              canvas.width = Math.ceil(v.width);
              canvas.height = Math.ceil(v.height);
              await page.render({
                canvasContext: canvas.getContext("2d"),
                viewport: v,
              }).promise;
              if (own !== revision || !d.open) return;
              thumbs.append(
                el("figure", {}, [
                  el("img", {
                    src: canvas.toDataURL(),
                    alt: `Page ${item.page + 1}`,
                  }),
                  el("figcaption", { text: `Page ${item.page + 1}` }),
                ]),
              );
              canvas.width = canvas.height = 0;
            }
            message.textContent = `${pages.length} of ${pdf.numPages} pages · ${v.layout} placement · first ${Math.min(6, pages.length)} thumbnails`;
          } catch (error) {
            message.textContent = error.message;
          }
        };
        form.addEventListener("change", refresh);
        d.addEventListener("close", () => revision++);
        refresh();
      },
    );
    this.pdf.releaseUnused(this.tabs);
  }
  async download(bytes, name) {
    if (window.desktop && /\.(png|pdf|json)$/.test(name))
      return desktop.export(base64(bytes), name);
    const a = el("a", {
      href: URL.createObjectURL(new Blob([bytes])),
      download: name,
    });
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return true;
  }
  async exportBytes(options) {
    for (const asset of Object.values(this.doc.assets))
      if (asset.type === "image")
        await this.renderer.image(asset.data).decode();
    if (options.format === "png")
      return bytesFromData(
        exportCanvas(this.renderer, options.rect, options).toDataURL(),
      );
    return annotatedPdf(this.doc, this.renderer, {
      ...options,
      mode: options.format,
    });
  }
  async exportDialog() {
    let busy = false;
    const body = el("div");
    body.innerHTML = `<div class="settings-grid"><label>Format<select name="format"><option value="png">PNG image</option><option value="pages">Annotated PDF pages · preserve original PDF</option><option value="vector">Vector PDF · canvas region</option><option value="flatten">Flattened PDF · canvas region</option></select></label><label>Area<select name="area"><option value="all">All visible content</option><option value="selection">Selected objects</option><option value="region">Chosen export region</option></select></label><label>Resolution<select name="scale"><option value="1">1× · 72 canvas pixels/inch</option><option value="2" selected>2× · 144 pixels/inch</option><option value="4">4× · 288 pixels/inch</option></select></label><label class="check"><input name="background" type="checkbox" checked> Include canvas background</label></div><p class="notice">Annotated PDF keeps original PDF text and vectors and adds vector ink. Original PDF pages stay opaque; dark viewing mode is display-only. Vector canvas export is for notes without PDF backgrounds. Flattened PDF preserves the on-screen appearance as images. Unicode text in vector exports uses an image fallback.</p><p class="notice">Searchable export does not support rotated source or canvas pages. Flattened PDF turns text into pixels. Cancel before Export to change these choices.</p><button id="preview-export">Update preview</button><img class="export-preview" alt="Export preview"><div class="error"></div>`;
    const d = dialog("Export your notes", body, [
      { label: "Cancel", run: (d) => d.close() },
      {
        label: "Export",
        primary: true,
        run: async (d) => {
          if (busy) return;
          busy = true;
          try {
            const opts = getOptions();
            body.querySelector(".error").textContent = "Preparing export…";
            await prepare(opts);
            let bytes, ext;
            if (opts.format === "png") {
              bytes = bytesFromData(
                exportCanvas(this.renderer, opts.rect, opts).toDataURL(),
              );
              ext = "png";
            } else {
              if (
                opts.format === "vector" &&
                this.doc.objects.some((o) => o.type === "pdf")
              )
                throw Error(
                  "Use annotated pages or flattened PDF to include imported PDF backgrounds.",
                );
              bytes = await annotatedPdf(this.doc, this.renderer, {
                ...opts,
                mode: opts.format,
              });
              ext = "pdf";
            }
            if (await this.download(bytes, `${this.doc.name}.${ext}`)) {
              d.close();
              this.toast("Export complete.");
            }
            this.pdf.pinCache = false;
          } catch (e) {
            body.querySelector(".error").textContent = e.message;
          } finally {
            busy = false;
            this.pdf.pinCache = false;
            this.pdf.trimCache();
          }
        },
      },
    ]);
    const getOptions = () => {
      const format = body.querySelector("[name=format]").value,
        area = body.querySelector("[name=area]").value,
        only = area === "selection" ? new Set(this.selection) : null;
      if (only && !only.size)
        throw Error("Select objects before exporting a selection.");
      const visible = this.doc.objects.filter(
        (o) =>
          this.doc.layers.find((l) => l.id === o.layer)?.visible &&
          (!only || only.has(o.id)),
      );
      let rect = area === "region" ? this.renderer.region : union(visible);
      if (!rect || rect.w < 1 || rect.h < 1)
        throw Error("Draw an export region with the Export region tool first.");
      return {
        format,
        rect,
        only,
        scale: +body.querySelector("[name=scale]").value,
        background: body.querySelector("[name=background]").checked,
      };
    };
    const prepare = async (opts) => {
      if (opts.format === "pages")
        for (const o of this.doc.objects.filter((o) => o.type === "pdf")) {
          const source = await this.pdf.load(this.doc.assets[o.asset]),
            page = await source.getPage(o.page + 1);
          if (o.rotation || page.rotate)
            throw Error(
              "Rotated PDF pages cannot preserve searchable content in this export. Choose Flattened PDF or remove rotation.",
            );
        }
      this.pdf.pinCache = true;
      const pages = this.doc.objects.filter(
        (o) => o.type === "pdf" && opts.format !== "pages",
      );
      for (const [i, o] of pages.entries()) {
        if (!d.open) throw Error("Preview cancelled.");
        body.querySelector(".error").textContent =
          `Preparing PDF page ${i + 1} of ${pages.length}…`;
        await this.pdf.ensure(o, opts.scale);
      }
      for (const asset of Object.values(this.doc.assets))
        if (asset.type === "image")
          await this.renderer.image(asset.data).decode();
    };
    body.querySelector("#preview-export").onclick = async () => {
      if (busy) return;
      busy = true;
      const submit = d.querySelector(".dialog-foot .primary");
      submit.disabled = true;
      try {
        const opts = getOptions();
        await prepare(opts);
        const scale = Math.min(1, 1000 / opts.rect.w, 800 / opts.rect.h);
        body.querySelector("img").src = exportCanvas(this.renderer, opts.rect, {
          ...opts,
          scale,
        }).toDataURL();
        this.pdf.pinCache = false;
        body.querySelector(".error").textContent = "";
      } catch (e) {
        body.querySelector(".error").textContent = e.message;
      } finally {
        busy = false;
        submit.disabled = false;
        this.pdf.pinCache = false;
        this.pdf.trimCache();
      }
    };
    body.querySelector("[name=format]").onchange = () =>
      body.querySelector("#preview-export").click();
    body.querySelector("#preview-export").click();
  }
  fileMenu() {
    const body = el("div", { class: "palette-list" }),
      d = dialog("Document", body);
    for (const id of [
      "file.new",
      "file.open",
      "file.save",
      "file.saveAs",
      "file.rename",
      "file.recent",
      "file.import",
      "file.export",
      "file.close",
      "app.help",
    ])
      body.append(
        button(this.registry.tooltip(id), () => {
          d.close();
          this.registry.run(id);
        }),
      );
    body.append(
      button("Paste copied canvas objects", () => {
        d.close();
        this.pasteObjects();
      }),
    );
  }
  commandPalette() {
    const body = el("div"),
      search = el("input", {
        class: "binding-search",
        placeholder: "Find a tool, action, color, or preset…",
        "aria-label": "Search commands",
      }),
      list = el("div", { class: "palette-list" });
    body.append(search, list);
    const d = dialog("Commands", body);
    let active = 0;
    const setActive = () => {
      const buttons = [...list.querySelectorAll("button:not(:disabled)")];
      active = Math.max(0, Math.min(active, buttons.length - 1));
      list
        .querySelectorAll("button")
        .forEach((b) => b.classList.remove("active"));
      buttons[active]?.classList.add("active");
      buttons[active]?.scrollIntoView({ block: "nearest" });
    };
    const render = () => {
      list.replaceChildren();
      active = 0;
      for (const c of this.registry.commands.values())
        if (
          (c.label + " " + c.category)
            .toLowerCase()
            .includes(search.value.toLowerCase())
        ) {
          const b = button("", () => {
            d.close();
            this.registry.run(c.id);
          });
          b.disabled = !this.registry.available(c.id);
          b.append(
            el("span", { text: c.label }),
            el("kbd", { text: this.registry.bindings(c.id).join(", ") }),
          );
          list.append(b);
        }
      setActive();
    };
    search.onkeydown = (e) => {
      if (["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) e.preventDefault();
      if (e.key === "ArrowDown") {
        active++;
        setActive();
      }
      if (e.key === "ArrowUp") {
        active--;
        setActive();
      }
      if (e.key === "Enter") list.querySelector("button.active")?.click();
      if (e.key === "Escape") d.close();
    };
    search.oninput = render;
    render();
    search.focus();
  }
  bookmarks() {
    const body = el("div", { class: "stack" }),
      d = dialog("Canvas bookmarks", body);
    body.append(
      button("+ Bookmark this view", () => {
        d.close();
        this.registry.run("view.bookmark");
      }),
    );
    for (const [i, b] of this.doc.bookmarks.entries())
      body.append(
        el("div", { class: "row" }, [
          button(
            b.name,
            () => {
              this.doc.camera = { ...b.camera };
              this.renderer.invalidate();
              this.updateZoom();
              d.close();
            },
            "grow",
          ),
          button(
            "Delete",
            () => {
              this.change(() => this.doc.bookmarks.splice(i, 1));
              d.close();
              this.bookmarks();
            },
            "danger",
          ),
        ]),
      );
  }
  search() {
    const body = el("div"),
      search = el("input", {
        class: "binding-search",
        placeholder: "Search typed text…",
        "aria-label": "Search notes",
      }),
      results = el("div", { class: "stack" });
    body.append(search, results);
    const d = dialog("Search notes", body);
    search.oninput = () => {
      results.replaceChildren();
      for (const o of this.doc.objects)
        if (
          o.type === "text" &&
          o.text.toLowerCase().includes(search.value.toLowerCase())
        )
          results.append(
            button(o.text.slice(0, 120), () => {
              this.fit([o]);
              this.selection.clear();
              this.selection.add(o.id);
              this.updatePanels();
              d.close();
            }),
          );
    };
    search.focus();
  }
  help() {
    dialog(
      "A space to think",
      `<div class="help-grid"><section><h3>Write & navigate</h3><p>Pen pressure follows your tablet when Windows exposes it. Mouse strokes use full pressure. Hold Shift while drawing for a straight line; hold Shift for square/circle shapes or 45° line angles. Polygon: click vertices, then Enter or double-click.</p><p>Hold Space or the middle mouse button to pan. Ctrl+wheel zooms at the cursor. The Commands panel lists every available action.</p></section><section><h3>Select & transform</h3><p>Click or drag a selection rectangle. Lasso selects object centers. Shift adds to selection. Drag objects to move, the lower-right handle to resize, and the handle above to rotate. Shift constrains resize/rotation. Numeric properties allow precise edits.</p><p>Double-click text to edit. Lock images after placement, then annotate on an unlocked layer. Unlock objects through Commands; layer locks are separate.</p></section><section><h3>PDFs & projects</h3><p>Projects embed original images and PDFs alongside editable objects. Annotated-page PDF export preserves source page content and adds annotations. Flattened export is labeled and resolution-controlled. Dark PDF mode never modifies the source.</p></section><section><h3>Recovery & shortcuts</h3><p>Recovery saves every eight seconds after changes and on close. Keep permanent .nocturne files with Save. Shortcuts ignore text fields. Windows combinations such as Alt+Tab, Win+keys, and Ctrl+Alt+Delete cannot be reassigned.</p></section></div>`,
    );
  }
}
new App().init().catch((e) => {
  console.error(e);
  document.body.textContent = "Could not start Nocturne: " + e.message;
});
