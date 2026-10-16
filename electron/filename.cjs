function projectFilename(name) {
  let value = String(name || "Untitled")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 150);
  if (!value) value = "Untitled";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value))
    value = "_" + value;
  return value.replace(/\.nocturne$/i, "") + ".nocturne";
}
module.exports = { projectFilename };
