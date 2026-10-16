export function normalizeKey(event) {
  let key = event.key === " " ? "Space" : event.key;
  if (key.length === 1) key = key.toUpperCase();
  if (["Control", "Shift", "Alt", "Meta"].includes(key)) return "";
  return [
    ...(event.ctrlKey ? ["Ctrl"] : []),
    ...(event.altKey ? ["Alt"] : []),
    ...(event.shiftKey ? ["Shift"] : []),
    ...(event.metaKey ? ["Meta"] : []),
    key,
  ].join("+");
}
export function typingTarget(target) {
  return !!target?.closest?.('input,textarea,select,[contenteditable="true"]');
}
export function reserved(binding) {
  return /Meta\+|^Alt\+(Tab|F4|Escape)$|^Ctrl\+Alt\+Delete$|^Ctrl\+Shift\+Escape$/i.test(
    binding,
  );
}
export class CommandRegistry {
  constructor(settings, changed = () => {}) {
    this.settings = settings;
    this.changed = changed;
    this.commands = new Map();
  }
  add(id, label, category, run, defaults = [], extra = {}) {
    this.commands.set(id, { id, label, category, run, defaults, ...extra });
  }
  bindings(id) {
    return this.settings.bindings[id] ?? this.commands.get(id)?.defaults ?? [];
  }
  conflicts(binding, except) {
    return [...this.commands.values()].filter(
      (c) => c.id !== except && this.bindings(c.id).includes(binding),
    );
  }
  assign(id, binding, replace = false) {
    if (reserved(binding))
      throw Error(
        "This combination is reserved by Windows and cannot be assigned.",
      );
    const conflicts = this.conflicts(binding, id);
    if (conflicts.length && !replace) return conflicts;
    for (const c of conflicts)
      this.settings.bindings[c.id] = this.bindings(c.id).filter(
        (b) => b !== binding,
      );
    this.settings.bindings[id] = [...new Set([...this.bindings(id), binding])];
    this.changed();
    return [];
  }
  remove(id, binding) {
    this.settings.bindings[id] = this.bindings(id).filter((b) => b !== binding);
    this.changed();
  }
  reset(id) {
    if (id) {
      for (const key of this.commands.get(id)?.defaults || [])
        for (const c of this.conflicts(key, id))
          this.settings.bindings[c.id] = this.bindings(c.id).filter(
            (v) => v !== key,
          );
      delete this.settings.bindings[id];
    } else this.settings.bindings = {};
    this.changed();
  }
  find(binding) {
    return [...this.commands.values()].find((c) =>
      this.bindings(c.id).includes(binding),
    );
  }
  available(id) {
    const c = this.commands.get(id);
    return !!c && (!c.available || c.available());
  }
  run(id) {
    if (this.available(id)) return this.commands.get(id).run();
  }
  tooltip(id) {
    const c = this.commands.get(id);
    return c
      ? `${c.label}${this.bindings(id).length ? " · " + this.bindings(id).join(", ") : ""}`
      : id;
  }
  importProfile(profile) {
    if (
      profile?.type !== "nocturne-shortcuts" ||
      !profile.bindings ||
      typeof profile.bindings !== "object"
    )
      throw Error("Invalid shortcut profile");
    const used = new Map(),
      bindings = {};
    for (const c of this.commands.values()) {
      const values = profile.bindings[c.id] ?? c.defaults;
      if (
        !Array.isArray(values) ||
        values.some((v) => typeof v !== "string" || reserved(v))
      )
        throw Error("Invalid or Windows-reserved shortcut");
      for (const v of values) {
        if (used.has(v)) throw Error(`Shortcut conflict: ${v}`);
        used.set(v, c.id);
      }
      bindings[c.id] = values;
    }
    this.settings.bindings = bindings;
    this.changed();
  }
  exportProfile() {
    return {
      type: "nocturne-shortcuts",
      version: 1,
      bindings: Object.fromEntries(
        [...this.commands.keys()].map((id) => [id, this.bindings(id)]),
      ),
    };
  }
}
