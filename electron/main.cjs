const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  clipboard,
  Menu,
} = require("electron");
const fs = require("node:fs/promises"),
  path = require("node:path");
const { atomicWrite } = require("./storage.cjs");
const { projectFilename } = require("./filename.cjs");
let win;
const allowed = new Set();
const root = () => app.getPath("userData");
const readJSON = async (file, fallback) => {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return fallback;
  }
};
const settingsFile = () => path.join(root(), "settings.json");
const recentFile = () => path.join(root(), "recent.json");
async function remember(file) {
  let list = await readJSON(recentFile(), []);
  await atomicWrite(
    recentFile(),
    JSON.stringify([file, ...list.filter((x) => x !== file)].slice(0, 15)),
  );
}
async function readFile(file) {
  const stat = await fs.stat(file);
  if (stat.size > 512 * 1024 * 1024)
    throw Error("File exceeds the 512 MB import limit.");
  return {
    name: path.basename(file),
    path: file,
    data: (await fs.readFile(file)).toString("base64"),
  };
}
ipcMain.handle("open", async (_, kind) => {
  const result = await dialog.showOpenDialog(win, {
    properties: ["openFile", ...(kind === "assets" ? ["multiSelections"] : [])],
    filters:
      kind === "project"
        ? [{ name: "Nocturne project", extensions: ["nocturne"] }]
        : [
            {
              name: "Images and PDFs",
              extensions: ["png", "jpg", "jpeg", "webp", "gif", "bmp", "pdf"],
            },
          ],
  });
  if (result.canceled) return [];
  const files = [];
  for (const f of result.filePaths) {
    allowed.add(f);
    files.push(await readFile(f));
  }
  return files;
});
ipcMain.handle("save", async (_, data, file, saveAs, name) => {
  if (typeof data !== "string") throw Error("Invalid document");
  if (!file || saveAs || !allowed.has(file)) {
    const result = await dialog.showSaveDialog(win, {
      defaultPath:
        file && !saveAs
          ? file
          : path.join(
              file ? path.dirname(file) : app.getPath("documents"),
              projectFilename(name),
            ),
      filters: [{ name: "Nocturne project", extensions: ["nocturne"] }],
    });
    if (result.canceled) return null;
    file = result.filePath;
  }
  await atomicWrite(file, data);
  allowed.add(file);
  await remember(file);
  return file;
});
ipcMain.handle("export", async (_, data, name) => {
  const ext = path.extname(name).slice(1);
  if (!["png", "pdf", "json"].includes(ext)) throw Error("Unsupported export");
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.basename(name),
    filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
  });
  if (r.canceled) return false;
  await atomicWrite(r.filePath, Buffer.from(data, "base64"));
  return true;
});
ipcMain.handle("settingsRead", () => readJSON(settingsFile(), null));
ipcMain.handle("settingsWrite", (_, value) =>
  atomicWrite(settingsFile(), JSON.stringify(value)),
);
ipcMain.handle("recent", () => readJSON(recentFile(), []));
ipcMain.handle("openRecent", async (_, file) => {
  const list = await readJSON(recentFile(), []);
  if (!list.includes(file)) throw Error("Unknown recent file");
  allowed.add(file);
  return readFile(file);
});
ipcMain.handle("autosave", async (_, docs) =>
  atomicWrite(path.join(root(), "recovery.json"), JSON.stringify(docs)),
);
ipcMain.handle("recover", () =>
  readJSON(path.join(root(), "recovery.json"), []),
);
ipcMain.handle("markClean", () =>
  atomicWrite(path.join(root(), "recovery.json"), "[]"),
);
ipcMain.handle("fullscreen", () => {
  win.setFullScreen(!win.isFullScreen());
  return win.isFullScreen();
});
ipcMain.handle("clipboard", async () => {
  const items = await clipboard.read(),
    files = [];
  for (const item of items) {
    for (const type of item.types) {
      if (!/CF_HDROP|FileNameW/.test(type)) continue;
      const blob = await item.getType(type),
        b = Buffer.from(await blob.arrayBuffer());
      let names = [];
      if (type.includes("CF_HDROP") && b.length >= 20) {
        const offset = b.readUInt32LE(0),
          wide = b.readUInt32LE(16) !== 0;
        if (offset >= 20 && offset < b.length)
          names = b
            .subarray(offset)
            .toString(wide ? "utf16le" : "latin1")
            .split("\0")
            .filter(Boolean);
      } else if (type.includes("FileNameW"))
        names = [b.toString("utf16le").split("\0")[0]];
      for (const name of names)
        if (/\.(pdf|png|jpe?g|webp|bmp)$/i.test(name))
          files.push(await readFile(name));
    }
  }
  if (files.length) return { files };
  for (const item of items) {
    const type = item.types.find((type) =>
      /^image\/(png|jpeg|webp|bmp)$/.test(type),
    );
    if (type) {
      const blob = await item.getType(type);
      return {
        image: `data:${type};base64,${Buffer.from(await blob.arrayBuffer()).toString("base64")}`,
      };
    }
  }
  return { text: await clipboard.readText() };
});
app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  win = new BrowserWindow({
    width: 1450,
    height: 940,
    minWidth: 800,
    minHeight: 560,
    backgroundColor: "#000000",
    title: "Nocturne Notes",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, "../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
