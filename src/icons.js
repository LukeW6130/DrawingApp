const paths = {
  pen: "M4 20l2-6L17 3l4 4L10 18z M6 14l4 4 M15 5l4 4",
  highlighter: "M5 15l9-12 6 5-9 11z M5 15l6 4-2 3H3z",
  eraser: "M3 14l10-11 8 7-10 11H8z M8 9l8 7 M11 21h10",
  partial: "M3 14l10-11 8 7-10 11H8z M8 9l8 7 M15 21h2 M20 21h1",
  select: "M5 3v17l5-5 4 7 3-2-4-7h7z",
  lasso: "M6 18C-2 6 8 1 17 5s7 14-5 14C3 19 4 13 8 14s3 8-1 9",
  text: "M3 4h18 M12 4v17 M8 21h8",
  line: "M4 20L20 4",
  arrow: "M4 20L20 4 M10 4h10v10",
  rect: "M4 4h16v16H4z",
  ellipse: "M21 12a9 7 0 1 1-18 0a9 7 0 1 1 18 0",
  polygon: "M7 3h10l5 9-5 9H7l-5-9z",
  pan: "M7 12V6a2 2 0 0 1 4 0v5-7a2 2 0 0 1 4 0v7-5a2 2 0 0 1 4 0v6-2a2 2 0 0 1 4 0v6c0 8-11 8-14 4l-6-7c-2-3 1-5 3-2l2 2",
  eyedropper: "M14 3l7 7 M16 5L4 17v4h4L20 9",
  region: "M3 8V3h5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5",
  more: "M4 5h16 M4 12h16 M4 19h16",
  import: "M12 3v12 M7 10l5 5 5-5 M4 16v5h16v-5",
};
export function icon(tool) {
  return `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[tool] || paths.pen}"/></svg>`;
}
