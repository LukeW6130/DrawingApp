import os from "node:os";
import { pathToFileURL } from "node:url";
const model = await import(
  process.argv[2] ? pathToFileURL(process.argv[2]).href : "../src/model.js"
);
const { newDocument, History, SpatialIndex, normalizeStroke, resizeObject } =
  model;
const doc = newDocument("Benchmark");
for (let i = 0; i < 3000; i++)
  doc.objects.push(
    normalizeStroke(
      Array.from({ length: 40 }, (_, j) => ({
        x: (i % 60) * 20 + j / 3,
        y: Math.floor(i / 60) * 14 + Math.sin(j / 3) * 5,
        p: 0.7,
      })),
      { layer: doc.activeLayer, width: 2, color: "#ffffff", opacity: 1 },
    ),
  );
const index = new SpatialIndex(),
  history = new History(doc),
  results = {};
function measure(name, fn) {
  const times = [];
  for (let i = 0; i < 7; i++) {
    const t = performance.now();
    fn();
    times.push(performance.now() - t);
  }
  times.sort((a, b) => a - b);
  results[name] = {
    medianMs: +times[3].toFixed(2),
    maxMs: +times[6].toFixed(2),
  };
}
measure("indexRebuild", () => index.rebuild(doc.objects));
measure("snapshot", () => history.snapshot());
measure("transformCommit", () => {
  const selected = doc.objects.slice(0, 100),
    fn = () =>
      selected.forEach((o) => resizeObject(o, 1.001, 1.001, { x: 0, y: 0 }));
  if (history.changeObjects) history.changeObjects(selected, fn);
  else history.change(fn);
});
measure("undoRedo", () => {
  history.undo();
  history.redo();
});
const points = Array.from({ length: 20000 }, (_, i) => ({
  x: i / 10,
  y: Math.sin(i / 10) * 20,
  p: 0.5,
}));
measure("longStrokeNormalize", () =>
  normalizeStroke(points, { layer: doc.activeLayer, width: 2 }),
);
console.log(
  JSON.stringify(
    {
      hardware: {
        cpu: os.cpus()[0].model,
        logicalCores: os.cpus().length,
        memoryGiB: +(os.totalmem() / 2 ** 30).toFixed(1),
        platform: os.platform(),
        node: process.version,
      },
      document: {
        strokes: 3000,
        points: 120000,
        serializedMiB: +(JSON.stringify(doc).length / 2 ** 20).toFixed(2),
      },
      results,
      heapUsedMiB: +(process.memoryUsage().heapUsed / 2 ** 20).toFixed(1),
    },
    null,
    2,
  ),
);
