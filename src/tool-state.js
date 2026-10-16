export const LIMITS = {
  width: [0.2, 200, 0.2],
  opacity: [0.05, 1, 0.01],
  smoothing: [0, 0.95, 0.01],
  eraserSize: [2, 300, 1],
  fontSize: [6, 200, 1],
};
export function updateStyle(target, patch) {
  const clean = {};
  for (const [key, value] of Object.entries(patch)) {
    if (LIMITS[key]) {
      if (!Number.isFinite(+value)) throw Error("Enter a finite number.");
      clean[key] = Math.min(LIMITS[key][1], Math.max(LIMITS[key][0], +value));
    } else if (key === "color") {
      if (!/^#[\da-f]{6}$/i.test(value))
        throw Error("Enter a six-digit HEX color.");
      clean.color = value.toLowerCase();
    } else if (key === "tool") clean.tool = value;
  }
  Object.assign(target, clean);
}
export function matchesPreset(state, preset) {
  return ["tool", "color", "width", "opacity", "smoothing"].every(
    (key) => state[key] === preset[key],
  );
}
export function mixedValue(objects, key) {
  const values = objects.map(
    (o) => o[key] ?? (key === "opacity" ? 1 : undefined),
  );
  return values.every((v) => v === values[0]) ? values[0] : null;
}
