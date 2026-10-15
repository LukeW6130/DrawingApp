import { el, button, dialog, ask, readJSONFile } from "./ui.js";
import { normalizeKey, reserved } from "./commands.js";
import { uid, clone, defaultSettings } from "./model.js";
const bytes = (v) => new TextEncoder().encode(JSON.stringify(v, null, 2));
export function settingsDialog(app, initial = "appearance") {
  const body = el("div"),
    tabs = el("div", { class: "settings-tabs" }),
    content = el("div");
  body.append(tabs, content);
  const d = dialog("Make it your own", body, [
    { label: "Done", primary: true, run: (d) => d.close() },
  ]);
  const show = (tab) => {
    content.replaceChildren();
    tabs.replaceChildren();
    for (const [id, name] of [
      ["appearance", "Appearance"],
      ["input", "Input & navigation"],
      ["presets", "Pen presets"],
      ["shortcuts", "Shortcuts"],
    ])
      tabs.append(button(name, () => show(id), tab === id ? "active" : ""));
    ({ appearance, input, presets, shortcuts })[tab]();
  };
  function field(parent, label, type, value, change, opts = {}) {
    const input =
      type === "select"
        ? el(
            "select",
            {},
            opts.options.map((v) =>
              el("option", {
                value: Array.isArray(v) ? v[0] : v,
                text: Array.isArray(v) ? v[1] : v,
              }),
            ),
          )
        : el("input", { type, ...opts });
    if (type === "checkbox") input.checked = value;
    else input.value = value;
    input.onchange = () =>
      app.safe(() => {
        const value =
          type === "checkbox"
            ? input.checked
            : ["number", "range"].includes(type)
              ? +input.value
              : input.value;
        if (
          type === "number" &&
          (!Number.isFinite(value) ||
            (opts.min !== undefined && value < opts.min) ||
            (opts.max !== undefined && value > opts.max))
        ) {
          app.toast("Value is outside the allowed range.");
          return;
        }
        change(value);
      });
    parent.append(
      el("label", { text: label, class: type === "checkbox" ? "check" : "" }, [
        input,
      ]),
    );
    return input;
  }
  function colorField(parent, label, value, change) {
    const wrap = el("div", { class: "row" }),
      picker = el("input", { type: "color", value, "aria-label": label }),
      hex = el("input", {
        type: "text",
        value,
        "aria-label": label + " HEX",
        style: "width:110px",
      });
    picker.onchange = () => {
      hex.value = picker.value;
      change(picker.value);
    };
    hex.onchange = () => {
      if (!/^#[\da-f]{6}$/i.test(hex.value)) {
        app.toast("Use a six-digit HEX color such as #123456.");
        return;
      }
      picker.value = hex.value;
      change(hex.value);
    };
    const rgb = button("RGB", () =>
      ask(
        label + " — RGB",
        [
          ...["R", "G", "B"].map((c, i) => ({
            name: c,
            label: c,
            type: "number",
            min: 0,
            max: 255,
            value: parseInt(picker.value.slice(1 + i * 2, 3 + i * 2), 16),
          })),
        ],
        (v) => {
          const values = Object.values(v).map(Number);
          if (values.some((n) => !Number.isInteger(n) || n < 0 || n > 255))
            throw Error("RGB channels must be integers from 0 to 255.");
          const color =
            "#" + values.map((n) => n.toString(16).padStart(2, "0")).join("");
          picker.value = hex.value = color;
          change(color);
        },
      ),
    );
    wrap.append(picker, hex, rgb);
    parent.append(el("label", { text: label }, [wrap]));
  }
  function appearance() {
    const grid = el("div", { class: "settings-grid" });
    content.append(grid);
    const bg = app.doc.background;
    const setBg = (key, value) => app.change(() => (bg[key] = value));
    colorField(grid, "Canvas background", bg.color, (v) => setBg("color", v));
    field(
      grid,
      "Paper pattern",
      "select",
      bg.pattern,
      (v) => setBg("pattern", v),
      {
        options: [
          ["solid", "Solid"],
          ["lined", "Ruled lines"],
          ["grid", "Square grid"],
          ["dots", "Dot grid"],
        ],
      },
    );
    field(
      grid,
      "Grid / line spacing",
      "number",
      bg.spacing,
      (v) => setBg("spacing", v),
      { min: 4, max: 500 },
    );
    field(
      grid,
      "Grid / line thickness",
      "number",
      bg.thickness,
      (v) => setBg("thickness", v),
      { min: 0.2, max: 8, step: 0.2 },
    );
    colorField(grid, "Grid / line color", bg.colorGrid, (v) =>
      setBg("colorGrid", v),
    );
    field(
      grid,
      "Grid opacity",
      "range",
      bg.opacity,
      (v) => setBg("opacity", v),
      { min: 0, max: 1, step: 0.01 },
    );
    field(
      grid,
      "A4 page guides (794 × 1123 canvas units)",
      "checkbox",
      bg.guides,
      (v) => setBg("guides", v),
    );
    field(
      grid,
      "Interface scale",
      "number",
      app.settings.uiScale,
      (v) => {
        app.settings.uiScale = v;
        app.persist();
      },
      { min: 0.75, max: 2, step: 0.05 },
    );
    for (const [key, label] of Object.entries({
      background: "Interface background",
      panel: "Panels",
      text: "Interface text",
      icons: "Icons",
      accent: "Accent color",
      selection: "Selection indicator",
    }))
      colorField(grid, label, app.settings.theme[key], (v) => {
        app.settings.theme[key] = v;
        app.persist();
      });
    field(
      grid,
      "Toolbar placement",
      "select",
      app.settings.toolbarSide,
      (v) => {
        app.settings.toolbarSide = v;
        app.persist();
      },
      { options: ["left", "right"] },
    );
    field(
      grid,
      "Toolbar width",
      "number",
      app.settings.toolbarSize,
      (v) => {
        app.settings.toolbarSize = v;
        app.persist();
      },
      { min: 36, max: 90 },
    );
    content.append(
      el("div", { class: "divider" }),
      el("h3", { text: "Toolbar order & visibility" }),
    );
    for (const [id, label] of app.orderedTools()) {
      const row = el("div", { class: "toolbar-edit" }),
        check = el("input", { type: "checkbox" });
      check.checked = !app.settings.hiddenTools.includes(id);
      check.onchange = () => {
        app.settings.hiddenTools = check.checked
          ? app.settings.hiddenTools.filter((x) => x !== id)
          : [...app.settings.hiddenTools, id];
        app.persist();
        app.buildToolbar();
      };
      row.append(
        el("label", { class: "row" }, [check, el("span", { text: label })]),
        button("↑", () => moveTool(id, -1)),
        button("↓", () => moveTool(id, 1)),
      );
      content.append(row);
    }
    content.append(
      el("div", { class: "profile-row" }, [
        button("Export appearance", () =>
          app.safe(() =>
            app.download(
              bytes({
                type: "nocturne-appearance",
                version: 1,
                theme: app.settings.theme,
                background: app.doc.background,
                uiScale: app.settings.uiScale,
                toolbarSide: app.settings.toolbarSide,
                toolbarSize: app.settings.toolbarSize,
                hiddenTools: app.settings.hiddenTools,
                toolOrder: app.settings.toolOrder,
                swatches: app.settings.swatches,
              }),
              "Nocturne-appearance.json",
            ),
          ),
        ),
        button("Import appearance", () =>
          app.safe(async () => {
            const p = await readJSONFile();
            if (!p) return;
            if (p.type !== "nocturne-appearance")
              throw Error("Invalid appearance profile");
            for (const value of Object.values(p.theme || {}))
              if (!/^#[\da-f]{6}$/i.test(value))
                throw Error("Invalid theme color");
            if (
              !p.background ||
              !/^#[\da-f]{6}$/i.test(p.background.color) ||
              !/^#[\da-f]{6}$/i.test(p.background.colorGrid) ||
              !["solid", "lined", "grid", "dots"].includes(
                p.background.pattern,
              ) ||
              !(p.background.spacing >= 4 && p.background.spacing <= 500) ||
              !(p.background.thickness >= 0.2 && p.background.thickness <= 8) ||
              !(p.background.opacity >= 0 && p.background.opacity <= 1)
            )
              throw Error("Invalid background profile");
            app.change(() => (app.doc.background = clone(p.background)));
            Object.assign(app.settings, {
              theme: { ...defaultSettings().theme, ...p.theme },
              uiScale: Math.max(0.75, Math.min(2, +p.uiScale || 1)),
              toolbarSide: p.toolbarSide === "right" ? "right" : "left",
              toolbarSize: Math.max(36, Math.min(90, +p.toolbarSize || 52)),
              hiddenTools: Array.isArray(p.hiddenTools) ? p.hiddenTools : [],
              toolOrder: Array.isArray(p.toolOrder) ? p.toolOrder : [],
              swatches: Array.isArray(p.swatches)
                ? p.swatches.filter((c) => /^#[\da-f]{6}$/i.test(c))
                : app.settings.swatches,
            });
            app.persist();
            app.buildToolbar();
            app.updatePanels();
            show("appearance");
          }),
        ),
      ]),
    );
  }
  function moveTool(id, delta) {
    const order = app.orderedTools().map((t) => t[0]),
      i = order.indexOf(id),
      j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    app.settings.toolOrder = order;
    app.persist();
    app.buildToolbar();
    show("appearance");
  }
  function input() {
    const grid = el("div", { class: "settings-grid" });
    content.append(grid);
    const set = (key, v) => {
      app.settings[key] = v;
      app.persist();
    };
    field(
      grid,
      "Pen pressure sensitivity",
      "checkbox",
      app.settings.pressure,
      (v) => set("pressure", v),
    );
    field(
      grid,
      "Pressure curve (lower = firmer)",
      "number",
      app.settings.pressureCurve,
      (v) => set("pressureCurve", v),
      { min: 0.2, max: 3, step: 0.1 },
    );
    field(
      grid,
      "Touch behavior",
      "select",
      app.settings.touch,
      (v) => set("touch", v),
      {
        options: [
          ["pan", "Pan only"],
          ["draw", "Draw with current tool"],
          ["ignore", "Ignore touch"],
        ],
      },
    );
    field(
      grid,
      "Mouse wheel",
      "select",
      app.settings.wheel,
      (v) => set("wheel", v),
      {
        options: [
          ["pan", "Pan; Ctrl+wheel zooms"],
          ["zoom", "Zoom at cursor"],
        ],
      },
    );
    field(
      grid,
      "Snap shape endpoints to grid",
      "checkbox",
      app.settings.snap,
      (v) => set("snap", v),
    );
    field(
      grid,
      "Recognize lines & closed shapes",
      "checkbox",
      app.settings.recognition,
      (v) => set("recognition", v),
    );
    field(
      grid,
      "Dark viewing mode for PDFs",
      "checkbox",
      app.settings.darkPdf,
      (v) => set("darkPdf", v),
    );
    content.append(
      el("p", {
        class: "notice",
        text: "Pressure requires a tablet driver that exposes Windows pen input. Touch supports one-finger pan or drawing; pinch is not implemented. Recognition converts near-straight strokes and closed rectangle/ellipse gestures after pen-up. Hold Shift to explicitly constrain a stroke. PDF dark mode affects viewing and flattened exports, never the original PDF.",
      }),
    );
  }
  function presets() {
    content.append(
      el("p", {
        class: "notice",
        text: "Each preset remembers its tool, color, width, opacity and smoothing. Shortcut bindings follow preset IDs even when reordered. Width is in canvas units. Opacity and smoothing range from 0 to 1.",
      }),
    );
    app.settings.presets.forEach((p, index) => {
      const row = el("div", { class: "preset-row" });
      const update = () => {
        app.registerPresets();
        app.persist();
        app.buildToolbar();
      };
      const name = el("input", {
        type: "text",
        value: p.name,
        "aria-label": "Preset name",
      });
      name.onchange = () => {
        p.name = name.value;
        update();
      };
      const tool = el(
        "select",
        { "aria-label": "Preset tool" },
        [
          "pen",
          "highlighter",
          "eraser",
          "partial",
          "line",
          "arrow",
          "rect",
          "ellipse",
        ].map((t) => el("option", { value: t, text: t })),
      );
      tool.value = p.tool;
      tool.onchange = () => {
        p.tool = tool.value;
        update();
      };
      const color = el("input", {
        type: "color",
        value: p.color,
        "aria-label": "Preset color",
      });
      color.onchange = () => {
        p.color = color.value;
        update();
      };
      row.append(name, tool, color);
      for (const [key, min, max, step] of [
        ["width", 0.2, 200, 0.2],
        ["opacity", 0.05, 1, 0.05],
        ["smoothing", 0, 0.95, 0.05],
      ]) {
        const input = el("input", {
          type: "number",
          min,
          max,
          step,
          value: p[key],
          title: key,
          "aria-label": `Preset ${key}`,
        });
        input.onchange = () => {
          p[key] = Math.min(max, Math.max(min, +input.value || min));
          update();
        };
        row.append(input);
      }
      row.append(
        button("↑", () => {
          if (index > 0)
            [app.settings.presets[index - 1], app.settings.presets[index]] = [
              p,
              app.settings.presets[index - 1],
            ];
          update();
          show("presets");
        }),
        button("↓", () => {
          if (index < app.settings.presets.length - 1)
            [app.settings.presets[index + 1], app.settings.presets[index]] = [
              p,
              app.settings.presets[index + 1],
            ];
          update();
          show("presets");
        }),
        button("Copy", () => {
          app.settings.presets.push({
            ...p,
            id: uid(),
            name: p.name + " copy",
          });
          update();
          show("presets");
        }),
        button(
          "Delete",
          () => {
            app.settings.presets.splice(index, 1);
            update();
            show("presets");
          },
          "danger",
        ),
      );
      content.append(row);
    });
    content.append(
      button("+ New preset", () => {
        app.settings.presets.push({
          id: uid(),
          name: "New pen",
          tool: "pen",
          color: app.color,
          width: app.width,
          opacity: app.opacity,
          smoothing: app.smoothing,
        });
        app.registerPresets();
        app.persist();
        app.buildToolbar();
        show("presets");
      }),
    );
    content.append(el("h3", { text: "Custom color swatches" }));
    const row = el("div", { class: "row" });
    for (const c of app.settings.swatches)
      row.append(
        button(
          "×",
          () => {
            app.settings.swatches = app.settings.swatches.filter(
              (v) => v !== c,
            );
            app.persist();
            app.updatePanels();
            show("presets");
          },
          "",
          `Remove ${c}`,
        ),
      );
    row.childNodes.forEach(
      (b, i) => (b.style.background = app.settings.swatches[i]),
    );
    const color = el("input", {
      type: "color",
      value: app.color,
      "aria-label": "New swatch",
    });
    row.append(
      color,
      button("Add swatch", () => {
        if (!app.settings.swatches.includes(color.value))
          app.settings.swatches.push(color.value);
        app.persist();
        app.updatePanels();
        show("presets");
      }),
    );
    content.append(row);
  }
  function shortcuts() {
    const search = el("input", {
        class: "binding-search",
        placeholder: "Search actions, tools, or shortcuts…",
        "aria-label": "Search shortcuts",
      }),
      list = el("div");
    content.append(
      search,
      el("p", {
        class: "notice",
        text: "Add multiple bindings per action. Assigning an occupied shortcut offers an explicit reassignment. Shortcuts never fire in text fields. Windows reserves Win+keys, Alt+Tab, Alt+F4, Ctrl+Alt+Delete and Ctrl+Shift+Escape. Hold actions return to the previous tool on key release.",
      }),
      list,
    );
    const render = () => {
      list.replaceChildren();
      for (const c of app.registry.commands.values()) {
        const keys = app.registry.bindings(c.id);
        if (
          !(c.label + " " + c.category + " " + keys.join(" "))
            .toLowerCase()
            .includes(search.value.toLowerCase())
        )
          continue;
        const row = el("div", { class: "binding-row" });
        row.append(
          el("div", { class: "command-name" }, [
            el("span", { text: c.label }),
            el("small", { text: c.category }),
          ]),
        );
        for (const key of keys)
          row.append(
            el("span", { class: "binding-chip" }, [
              el("kbd", { text: key }),
              button(
                "×",
                () => {
                  app.registry.remove(c.id, key);
                  render();
                },
                "",
                `Remove ${key}`,
              ),
            ]),
          );
        row.append(
          button("Add", () => capture(c, render)),
          button("Reset", () => {
            app.registry.reset(c.id);
            render();
          }),
        );
        list.append(row);
      }
    };
    search.oninput = render;
    render();
    content.append(
      el("div", { class: "profile-row" }, [
        button("Export shortcuts", () =>
          app.safe(() =>
            app.download(
              bytes(app.registry.exportProfile()),
              "Nocturne-shortcuts.json",
            ),
          ),
        ),
        button("Import shortcuts", () =>
          app.safe(async () => {
            const profile = await readJSONFile();
            if (profile) {
              app.registry.importProfile(profile);
              render();
            }
          }),
        ),
        button("Reset all defaults", () => {
          dialog(
            "Reset all shortcuts?",
            "<p>Your customized key bindings will be replaced with defaults.</p>",
            [
              { label: "Cancel", run: (d) => d.close() },
              {
                label: "Reset",
                run: (d) => {
                  app.registry.reset();
                  render();
                  d.close();
                },
              },
            ],
          );
        }),
      ]),
    );
  }
  function capture(command, refresh) {
    const body = el("div", { class: "stack" }),
      prompt = el("p", {
        text: "Press a key combination. Modifier keys can be combined with a letter, number, or function key.",
      }),
      status = el("div", { class: "notice" }),
      conflict = el("div", { class: "error" });
    let binding = "";
    body.append(prompt, status, conflict);
    const apply = button(
      "Assign",
      () => {
        if (!binding) return;
        const conflicts = app.registry.conflicts(binding, command.id);
        if (conflicts.length) {
          dialog(
            "Reassign shortcut?",
            `This binding is currently used by ${conflicts.map((c) => c.label).join(", ")}. Reassign it to ${command.label}?`,
            [
              { label: "Cancel", run: (d) => d.close() },
              {
                label: "Reassign",
                run: (d) => {
                  app.registry.assign(command.id, binding, true);
                  d.close();
                  captureDialog.close();
                  refresh();
                },
              },
            ],
          );
        } else {
          app.registry.assign(command.id, binding);
          captureDialog.close();
          refresh();
        }
      },
      "primary",
    );
    body.append(apply);
    const captureDialog = dialog(`Shortcut for ${command.label}`, body);
    captureDialog.tabIndex = 0;
    captureDialog.focus();
    captureDialog.addEventListener("keydown", (e) => {
      e.preventDefault();
      e.stopPropagation();
      binding = normalizeKey(e);
      status.textContent = binding || "Press a non-modifier key…";
      const unavailable = reserved(binding);
      apply.disabled = !binding || unavailable;
      conflict.textContent = unavailable
        ? "Reserved by Windows. Choose another combination."
        : app.registry
            .conflicts(binding, command.id)
            .map((c) => "Conflicts with " + c.label)
            .join("\n");
    });
  }
  content.addEventListener("change", () => app.quickProperties());
  show(initial);
  return d;
}
