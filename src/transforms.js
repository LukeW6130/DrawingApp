// Handle directions and positions are shared by rendering and pointer hit testing.
export function handles(b) {
  return [
    [-1, -1, "nwse"],
    [1, -1, "nesw"],
    [-1, 1, "nesw"],
    [1, 1, "nwse"],
    [0, -1, "ns"],
    [1, 0, "ew"],
    [0, 1, "ns"],
    [-1, 0, "ew"],
  ].map(([x, y, cursor]) => ({
    x,
    y,
    cursor: cursor + "-resize",
    px: b.x + ((x + 1) * b.w) / 2,
    py: b.y + ((y + 1) * b.h) / 2,
  }));
}
export function handleAt(b, p, zoom) {
  return handles(b)
    .filter((h) => Math.hypot(p.x - h.px, p.y - h.py) <= 10 / zoom)
    .sort(
      (a, b) =>
        Math.hypot(p.x - a.px, p.y - a.py) - Math.hypot(p.x - b.px, p.y - b.py),
    )[0];
}
export function resizeFromHandle(b, h, dx, dy, proportional = false) {
  let sx = h.x ? Math.max(0.02, 1 + (h.x * dx) / b.w) : 1;
  let sy = h.y ? Math.max(0.02, 1 + (h.y * dy) / b.h) : 1;
  if (proportional) {
    const scale = !h.x
      ? sy
      : !h.y
        ? sx
        : Math.abs(sx - 1) > Math.abs(sy - 1)
          ? sx
          : sy;
    sx = sy = scale;
  }
  return {
    sx,
    sy,
    origin: { x: b.x + ((1 - h.x) * b.w) / 2, y: b.y + ((1 - h.y) * b.h) / 2 },
  };
}
