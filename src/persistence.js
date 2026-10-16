import { serialize } from "./model.js";
export function initializeRevision(tab) {
  tab.revision = tab.dirty ? 1 : 0;
  tab.savedRevision = 0;
  tab.recoveryRevision = -1;
  return tab;
}
export function edited(tab) {
  tab.revision++;
  tab.dirty = tab.revision !== tab.savedRevision;
}
export async function saveRevision(tab, write) {
  if (tab.saving) return tab.saving;
  const revision = tab.revision,
    data = serialize(tab.doc),
    name = tab.doc.name;
  tab.saving = (async () => {
    const file = await write(data, name, tab.path);
    if (!file) return false;
    if (typeof file === "string") tab.path = file;
    tab.savedRevision = revision;
    tab.dirty = tab.revision !== revision;
    return true;
  })();
  try {
    return await tab.saving;
  } finally {
    tab.saving = null;
  }
}
export class RecoveryWriter {
  constructor() {
    this.revision = 0;
    this.savedRevision = -1;
    this.queue = Promise.resolve();
  }
  changed() {
    this.revision++;
  }
  get dirty() {
    return this.revision !== this.savedRevision;
  }
  write(tabs, write) {
    const revision = this.revision;
    const versions = tabs.map((t) => [t, t.revision]);
    const snapshot = tabs.map((t) => ({
      doc: JSON.parse(serialize(t.doc)),
      path: t.path,
      dirty: t.dirty,
      revision: t.revision,
    }));
    const task = this.queue.then(async () => {
      await write(snapshot);
      this.savedRevision = revision;
      for (const [tab, version] of versions) tab.recoveryRevision = version;
    });
    this.queue = task.catch(() => {});
    return task;
  }
}
