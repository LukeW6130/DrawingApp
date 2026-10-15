# Verification record

The delivered source was checked on Windows in the Codex execution environment. These results describe what ran here, rather than implying that the tablet or standalone desktop app was tested.

| Check | Result |
|---|---|
| `npm test` | 15/15 passed (including eight-handle image/PDF pointer resizing, movement, undo/redo, proportional scaling and zoom-aware handle targeting): editable project round-trip, schema validation, undo/redo, partial erase, geometry, background independence, 20,000-object spatial lookup, page ranges, shortcut conflict/profile behavior, and atomic save. |
| `npm run build` | Passed. Vite produced the production renderer and bundled PDF.js worker. |
| `verify.html` browser integration | 21/21 passed. Covered presets, keyboard dispatch, typing safety, image resize/lock, two-page PDF rendering, annotated export with original page dimensions and searchable text, project assets, recovery data, transparent PNG, and viewport culling. The 20,000-object index and one visible frame took about 13 ms in the test browser; this is one sample, not a frame-rate guarantee. |
| Manual browser UI | Canvas layout, stroke drawing, text editor, shortcut editor, appearance controls and recovery dialog opened and responded. |
| Windows unpacked build | `electron-builder --win --x64 --dir` completed and produced `release/win-unpacked/Nocturne Notes.exe` with its runtime files. |
| Single-file portable installer | The NSIS packaging process could not spawn in the restricted execution environment. The complete unpacked application is delivered as a ZIP. |
| Native Electron startup and `test:ui` | The restricted execution environment terminated Electron before its UI started. This remains unverified here. |
| Hardware pen/touch | No drawing tablet was attached to the execution environment. Pressure and touch behavior require the user's device test. |
| Native Windows clipboard screenshot/PDF-file paste | The Electron clipboard bridge was implemented but could not be exercised because native Electron startup was blocked. |

Open [TESTING.md](TESTING.md) for a repeatable Windows test covering the remaining native and hardware checks. The test PDF and editable project are in `examples/`.

## Known functional limits

- The annotated PDF exporter rejects pages with nonzero source rotation metadata or PDF objects rotated on the canvas. Flattened PDF remains available for these pages.
- PDF display renders visible pages at zoom-dependent resolution with a memory limit; a very large source page may hit the limit. Annotated export uses the original PDF data instead of the display bitmap.
- Recognition is a basic geometry heuristic. It does not recognize handwritten text or complex diagrams.
- Touch supports one-finger pan, draw, or ignore. Pinch zoom and palm rejection depend on the device/browser and are not fully implemented.
- Undo history keeps 150 checkpoints. It avoids copying immutable asset strings, but a very large document may make edit checkpoints expensive.
- The delivered executable is unsigned. Windows may show publisher warnings when opening it.
