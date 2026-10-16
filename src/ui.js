export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function el(tag, props = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "text") e.textContent = v;
    else if (k === "html") e.innerHTML = v;
    else if (k.startsWith("on"))
      e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "class") e.className = v;
    else e.setAttribute(k, v);
  }
  for (const c of children) e.append(c);
  return e;
}
export function button(text, click, className = "", title = "") {
  return el("button", { text, onClick: click, class: className, title });
}
export function dialog(title, body, actions = []) {
  const d = el("dialog"),
    head = el("div", { class: "dialog-head" }, [
      el("h2", { text: title }),
      button("×", () => d.close(), "", "Close dialog"),
    ]),
    content = el("div", { class: "dialog-body" });
  if (typeof body === "string") content.innerHTML = body;
  else content.append(body);
  d.append(head, content);
  let busy = false;
  const run = async (action) => {
    if (busy) return;
    busy = true;
    d.setAttribute("aria-busy", "true");
    const controls = [...d.querySelectorAll("button")];
    controls.forEach((b) => (b.disabled = true));
    try {
      await action.run(d);
    } catch (error) {
      let message = d.querySelector(".dialog-error");
      if (!message) {
        message = el("p", { class: "error dialog-error", role: "alert" });
        content.append(message);
      }
      message.textContent = error.message;
    } finally {
      busy = false;
      d.removeAttribute("aria-busy");
      controls.forEach((b) => (b.disabled = false));
    }
  };
  d.addEventListener("cancel", (e) => {
    if (busy) e.preventDefault();
  });
  if (actions.length)
    d.append(
      el(
        "div",
        { class: "dialog-foot" },
        actions.map((a) =>
          button(a.label, () => run(a), a.primary ? "primary" : ""),
        ),
      ),
    );
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
export function ask(title, fields, submit, label = "Apply", decorate = null) {
  return new Promise((resolve) => {
    const form = el("form", { class: "stack" });
    for (const f of fields) {
      const input = f.options
        ? el(
            "select",
            { name: f.name },
            f.options.map((v) =>
              el("option", {
                value: Array.isArray(v) ? v[0] : v,
                text: Array.isArray(v) ? v[1] : v,
              }),
            ),
          )
        : el(f.type === "textarea" ? "textarea" : "input", {
            name: f.name,
            type: f.type || "text",
            ...(f.min !== undefined ? { min: f.min } : {}),
            ...(f.max !== undefined ? { max: f.max } : {}),
            ...(f.step ? { step: f.step } : {}),
          });
      input.value = f.value ?? "";
      form.append(el("label", { class: "stack", text: f.label }, [input]));
    }
    const error = el("div", { class: "error" });
    form.append(error);
    const d = dialog(title, form, [
      {
        label: "Cancel",
        run: (d) => {
          d.close();
          resolve(null);
        },
      },
      {
        label,
        primary: true,
        run: async (d) => {
          try {
            if (!form.reportValidity()) return;
            const values = Object.fromEntries(new FormData(form));
            const value = await submit(values);
            d.close();
            resolve(value ?? values);
          } catch (e) {
            error.textContent = e.message;
          }
        },
      },
    ]);
    if (decorate) decorate(form, d);
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      if (form.reportValidity())
        d.querySelector(".dialog-foot .primary")?.click();
    });
    d.addEventListener("close", () => resolve(null));
  });
}
export async function readJSONFile() {
  return new Promise((resolve, reject) => {
    const input = el("input", { type: "file", accept: ".json" });
    input.onchange = async () => {
      try {
        resolve(JSON.parse(await input.files[0].text()));
      } catch (e) {
        reject(e);
      }
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export function propertyPopover(anchor, label, limits, value, apply) {
  document.querySelector(".property-popover")?.remove();
  const [min, max, step] = limits,
    box = el("div", { class: "property-popover", popover: "auto" });
  const range = el("input", {
    type: "range",
    min,
    max,
    step,
    value,
    "aria-label": label,
  });
  const number = el("input", {
    type: "number",
    min,
    max,
    step,
    value,
    "aria-label": label + " value",
  });
  range.oninput = () => (number.value = range.value);
  number.oninput = () => (range.value = number.value);
  const commit = () => {
    if (!number.reportValidity()) return;
    apply(+number.value);
    box.hidePopover();
  };
  box.append(
    el("strong", { text: label }),
    range,
    number,
    button("Apply", commit),
  );
  box.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    }
  });
  box.addEventListener("toggle", (e) => {
    if (e.newState === "closed") box.remove();
  });
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(innerWidth - 248, r.right + 8)) + "px";
  box.style.top = Math.max(8, Math.min(innerHeight - 190, r.top)) + "px";
  box.showPopover();
  number.focus();
  number.select();
}
