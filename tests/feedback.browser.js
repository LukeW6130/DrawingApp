import { ask } from "../src/ui.js";
export async function feedbackChecks(n, check) {
  const delay = () => new Promise((r) => setTimeout(r, 30));
  n.registry.run("preset.pen1");
  n.setWidth(8);
  check(
    !document.querySelector("#toolbar .preset.active"),
    "changing width clears preset indicator",
  );
  n.setColor("#123456");
  check(
    document.querySelector('[aria-label="Quick ink color"]').value ===
      "#123456",
    "color synchronizes quick controls",
  );
  n.setTool("pen");
  const width = document.querySelector('[aria-label="Stroke width"]');
  width.value = "15";
  width.dispatchEvent(new Event("change"));
  check(
    n.width === 15 &&
      document.querySelector("#quick-properties").textContent.includes("15"),
    "inspector width synchronizes quick controls",
  );
  n.cursor.position = { x: 220, y: 200 };
  n.cursor.pressed = true;
  n.cursor.node.hidden = false;
  n.cursor.update();
  check(
    n.cursor.node.style.getPropertyValue("--cursor-color") === "#123456" &&
      n.cursor.node.classList.contains("pressed"),
    "pressed pen cursor uses ink color",
  );
  n.setTool("eraser");
  n.setStyle({ eraserSize: 40 });
  n.cursor.update();
  check(
    n.cursor.node.style.getPropertyValue("--cursor-size") ===
      40 * n.doc.camera.zoom + "px",
    "eraser cursor matches erase diameter",
  );
  n.cursor.hide();
  let closed = ask("Dismiss fixture", [], () => {});
  document.querySelector("dialog[open] .dialog-head button").click();
  check((await closed) === null, "header close resolves ask promise");
  let calls = 0,
    release;
  const gate = new Promise((r) => (release = r));
  const submitted = ask(
    "Submit fixture",
    [{ name: "value", label: "Value", value: "OK" }],
    async () => {
      calls++;
      await gate;
      return "done";
    },
  );
  const form = document.querySelector("dialog[open] form");
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  form.dispatchEvent(new Event("submit", { cancelable: true }));
  check(
    calls === 1,
    "Enter/form submission cannot duplicate asynchronous actions",
  );
  release();
  check((await submitted) === "done", "form submission resolves result");
  await delay();
  n.commandPalette();
  const search = document.querySelector('[aria-label="Search commands"]');
  search.value = "tool";
  search.dispatchEvent(new Event("input"));
  const first = document.querySelector(".palette-list .active");
  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
  );
  check(
    document.querySelector(".palette-list .active") !== first,
    "palette Down changes active result",
  );
  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }),
  );
  check(
    document.querySelector(".palette-list .active") === first,
    "palette Up restores active result",
  );
  search.value = "Stroke eraser";
  search.dispatchEvent(new Event("input"));
  search.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
  );
  await delay();
  check(
    n.tool === "eraser" && !document.querySelector("dialog[open]"),
    "palette Enter runs command and closes",
  );
  const original = window.desktop;
  window.desktop = {
    autosave: async () => {
      throw Error("Simulated disk full");
    },
  };
  n.closeWindowDialog();
  const close = document.querySelector("dialog[open]");
  [...close.querySelectorAll("button")]
    .find((b) => b.textContent === "Close with recovery")
    .click();
  await delay();
  check(
    close.open &&
      !n.allowClose &&
      close.textContent.includes("check free disk space"),
    "failed recovery blocks closing and explains retry",
  );
  close.close();
  window.desktop = original;
  await delay();
  n.registry.run("preset.pen1");
  const asset = Object.values(n.doc.assets).find((a) => a.type === "pdf");
  const importing = n.addPdf({
    name: "Preview fixture.pdf",
    data: asset.data.split(",")[1],
  });
  for (
    let i = 0;
    i < 100 && document.querySelectorAll(".pdf-thumbnails img").length < 2;
    i++
  )
    await delay();
  check(
    document.querySelectorAll(".pdf-thumbnails img").length === 2 &&
      document.querySelector(".pdf-layout").children.length === 2,
    "PDF import shows page thumbnails and placement preview",
  );
  document.querySelector("dialog[open] .dialog-head button").click();
  await importing;
  const originalTab = n.tab;
  n.addTab(structuredClone(n.doc));
  n.activate(n.current);
  n.removeTab(n.current);
  check(
    n.tab === originalTab,
    "closing the active last tab preserves a valid current document",
  );
}
