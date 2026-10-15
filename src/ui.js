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
  if (actions.length)
    d.append(
      el(
        "div",
        { class: "dialog-foot" },
        actions.map((a) =>
          button(a.label, () => a.run(d), a.primary ? "primary" : ""),
        ),
      ),
    );
  document.body.append(d);
  d.addEventListener("close", () => d.remove());
  d.showModal();
  return d;
}
export function ask(title, fields, submit, label = "Apply") {
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
    form.addEventListener("submit", (e) => e.preventDefault());
    d.addEventListener("cancel", () => resolve(null));
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
