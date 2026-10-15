const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld(
  "desktop",
  Object.fromEntries(
    [
      "open",
      "save",
      "export",
      "settingsRead",
      "settingsWrite",
      "recover",
      "autosave",
      "clipboard",
      "fullscreen",
      "recent",
      "openRecent",
      "markClean",
    ].map((name) => [name, (...args) => ipcRenderer.invoke(name, ...args)]),
  ),
);
