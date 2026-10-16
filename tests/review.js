import { newDocument, normalizeStroke } from "../src/model.js";
while (!window.nocturne) await new Promise((r) => setTimeout(r, 50));
const n = window.nocturne;
document.querySelectorAll("dialog").forEach((d) => d.close());
n.addTab(newDocument("Calculus — Week 4"));
n.activate(n.current);
const params = new URLSearchParams(location.search);
n.settings.uiScale = +(params.get("scale") || 1);
if (params.has("theme"))
  n.settings.theme = {
    ...n.settings.theme,
    background: "#f4f1e9",
    panel: "#ffffff",
    text: "#202833",
    icons: "#26374a",
    accent: "#3656ad",
    selection: "#3656ad",
    muted: "#546173",
    border: "#56617460",
    hover: "#3656ad18",
    focus: "#3656ad",
  };
n.applyTheme();
n.registry.run("preset.pen2");
n.change(() => {
  n.doc.objects.push(
    {
      id: crypto.randomUUID(),
      type: "text",
      layer: n.doc.activeLayer,
      x: 150,
      y: 120,
      w: 440,
      h: 70,
      text: "Extrema and saddle points",
      fontSize: 24,
      color: "#f4f5f7",
      opacity: 1,
      rotation: 0,
    },
    normalizeStroke(
      Array.from({ length: 150 }, (_, i) => ({
        x: 150 + i * 2,
        y: 260 + Math.sin(i / 15) * 45,
        p: 0.8,
      })),
      { layer: n.doc.activeLayer, width: 3, color: "#63a8ff", opacity: 1 },
    ),
  );
});
n.cursor.position = { x: 350, y: 290 };
n.cursor.pressed = true;
n.cursor.node.hidden = false;
n.cursor.update();
if (params.has("inspector")) n.registry.run("view.inspector");
