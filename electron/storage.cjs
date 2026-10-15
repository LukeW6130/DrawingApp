const fs = require("node:fs/promises");
const path = require("node:path");
const crypto = require("node:crypto");
const pendingWrites = new Map();
function atomicWrite(file, data) {
  const previous = pendingWrites.get(file) || Promise.resolve();
  const task = previous.catch(() => {}).then(() => writeNow(file, data));
  pendingWrites.set(file, task);
  task
    .finally(() => {
      if (pendingWrites.get(file) === task) pendingWrites.delete(file);
    })
    .catch(() => {});
  return task;
}
async function writeNow(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${crypto.randomUUID()}.tmp`;
  let handle;
  try {
    handle = await fs.open(temp, "wx");
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fs.rename(temp, file);
  } finally {
    if (handle) await handle.close();
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
module.exports = { atomicWrite };
