# Nocturne 1.1 verification — October 16, 2026

## Completed

- 23/23 Node regression tests: revision-safe saves, immutable recovery snapshots and propagated failures, filename sanitization, preset matching, swept erasing of freehand/recognized lines, targeted object history, and existing model/geometry/storage checks.
- Production Vite build passed.
- Native Electron smoke test passed outside the execution sandbox: mouse drawing, presets, undo/redo, text, PDF rendering/export, image resize/lock, real Windows screenshot clipboard paste, project save, recovery after restart, and shortcut/theme persistence. The clipboard implementation was updated to Electron 44's asynchronous API after this test exposed the obsolete calls.
- 35/35 browser integration checks passed. Browser integration results and performance observations are recorded in [browser-results.txt](docs/evidence/browser-results.txt). Original PDF page sizes and searchable text preservation are retained in the suite.
- Default/custom themes and narrow/large-interface layouts are captured under [docs/evidence](docs/evidence).

## Performance

Intel Core Ultra 9 288V, 8 logical cores, 31.6 GiB RAM, Windows, Node 24.21.0. Fixture: 3,000 strokes / 120,000 points / 6.28 MiB serialized document. Seven synchronous repetitions; medians below are observations, not latency guarantees.

| Operation | Before | After |
|---|---:|---:|
| Commit transform of 100 objects | 148.01 ms | 4.49 ms |
| Undo + redo of that transform | 224.80 ms | 6.52 ms |
| Spatial index rebuild | 0.34 ms | 0.21 ms |
| Full document snapshot | 50.99 ms | 54.03 ms |

Transform and selected-style history now snapshots only affected objects. Full snapshots remain for structural edits, so very large drawing/erase transactions can still pause. Index rebuild cost did not justify a broad indexing redesign. Run `node scripts/benchmark.mjs` to reproduce. Raw before/after reports are included under docs/evidence.

The browser fixture also renders 3,000 visible strokes and a 24-page PDF session. Page-image caching is bounded to 128 MiB in normal viewing; pinned export preparation has a 256 MiB limit and returns an actionable error above it. These budgets do not include source PDFs, JS objects, or all GPU allocations.

## Remaining practical limits

- Actual pen pressure, palm contact, touch navigation and Windows display scaling require the user's hardware. Interface-scale screenshots exercise layout, not OS scaling or tablet drivers.
- Native screenshot-image clipboard paste passed; CF_HDROP/FileNameW clipboard file variants have not been exercised on every source application.
- Import preview can be cancelled before applying. Export preview preparation stops after cancellation between page operations. Once final export/save starts, that operation finishes or reports failure; there is no mid-write cancellation.
- Full-history snapshots remain for structural edits. Very large documents still merit additional profiling.
- Searchable PDF export rejects rotated source/canvas pages; flattened PDF is the fallback. Recognition is geometric, not handwriting OCR. Touch remains one-finger pan/draw/ignore; pinch and palm rejection are not implemented.
- The Windows application is unsigned. Keep all runtime files together when extracting the ZIP.
