# Nocturne Notes

An offline Windows drawing and handwritten note-taking app, built for a black infinite canvas. No account or cloud service is required. The application is original; no Concepts assets are included. The default layout follows the supplied reference: a pure-black canvas, presets at the top of a narrow left rail, a compact adjacent properties panel, and a collapsed inspector.

## Run the Windows app

Extract `Nocturne-Notes-Windows-x64.zip`, then open **Nocturne Notes.exe** inside the extracted folder. Keep all runtime files together. No administrator installation is required. The executable is unsigned. Keep permanent notes as `.nocturne` projects using **File → Save**. See [TESTING.md](TESTING.md) for your step-by-step test checklist.

If a packaged executable is unavailable, use the source instructions below. Supported target: Windows 10/11 x64 with a functioning Chromium/Electron desktop environment.

## Develop and build

Install Node.js 22.12 or newer (Node 24 LTS recommended) and npm. From this folder:

```powershell
npm ci
npm run build
npm start
```

To work on the renderer with hot reload:

```powershell
npm run dev
```

Open the printed localhost address. Browser mode supports the same canvas/model but downloads files and uses localStorage; Windows clipboard file paths, atomic native saves and recent-file paths require the desktop app.

Build a portable Windows executable:

```powershell
npm run dist
```

On an unrestricted Windows build machine, output is `release/Nocturne-Notes-1.0.0-Windows-x64.exe` and `release/win-unpacked/`. The delivery environment produced the unpacked application but blocked the NSIS packaging process, so the delivered ZIP contains that complete application folder. Use `npm run dist:dir` if you only need the unpacked app. Electron includes its runtime; users do not need Node.js. Building requires internet access once for npm packages and Electron/build tooling. Drawing, saving and bundled PDF handling work offline afterward.

## Drawing and navigation

- **1–5**: Chalk, Sky, Coral, Mint and Gold complete pen presets.
- **B** pen, **H** highlighter, **E** whole-stroke eraser, **V** selection, **L** lasso, **T** text.
- **Space held** or middle-mouse drag: temporary pan. Wheel pans; **Ctrl+wheel** zooms at the cursor. **Shift+wheel** pans horizontally.
- **Ctrl+Z / Ctrl+Y** undo/redo; **Ctrl+C / Ctrl+V** copy/paste; **Ctrl+S** save; **[ / ]** width.
- **Ctrl+K** searches all commands. **Ctrl+Shift+K** opens the shortcut editor. **F1** opens the drawing guide.
- **F10** focus mode, **F11** fullscreen, **Tab** properties panel, **Ctrl+1** fit content, **Ctrl+0** 100% zoom.

The full properties inspector starts collapsed: use Tab or the top-bar ☷ button to open it. Additional tools are available from the rail’s + button / Ctrl+K and can be pinned via Settings.

All these bindings are editable, including hold-to-pan and an optional hold-to-erase command. Multiple bindings, explicit conflict reassignment, reset and JSON profile import/export are supported. Drawing shortcuts are ignored while typing in text fields or dialogs. Windows system combinations cannot be reassigned.

Hold Shift to draw a straight stroke, square, circle or constrained line. Polygon: click vertices, then Enter or double-click. Recognition can convert near-straight strokes and closed rectangle/ellipse gestures after pen-up. This is a geometric heuristic, not handwriting recognition.

Selection supports rectangle/lasso, Shift-add, movement, duplication, grouping, object locking and deletion. Drag the lower-right handle to resize, or the handle above the selection to rotate. Shift constrains aspect ratio or rotation. The inspector also provides exact coordinates, size and angle. Lasso selects objects by their centers. Double-click typed text to edit it.

## Images, PDFs and exports

Import PNG, JPEG, WebP, GIF, BMP or PDF through **File → Import**, drag-and-drop, or the Windows clipboard. GIF imports display as a browser image; animated frames are not separately editable. Clipboard images take precedence over internally copied objects; **File → Paste copied canvas objects** explicitly pastes the latter. Clipboard file lists are read when Windows exposes CF_HDROP. Unsupported clipboard data produces a message.

PDF import accepts `all` or ranges such as `1, 3-5`, with vertical, horizontal or grid placement and adjustable gaps. The original PDF is embedded in the project. Pages are locked on their own layer by default, while annotations remain on an editable layer. PDF.js renders visible pages on demand at zoom-dependent resolution (up to 4×, bounded by a 16-megapixel page budget). Source PDF vectors/text are retained independently of display rendering.

Exports:

- **PNG**: visible content, selection or a drawn export region; 1×/2×/4×; optional transparent background.
- **Annotated PDF pages**: original imported page sizes, original searchable PDF text/vectors, vector ink and common text annotations. Unicode text and imported images use image fallback. Original PDF backgrounds remain opaque. Pages must have zero canvas rotation and zero source rotation metadata; use flattened PDF for rotated source pages.
- **Vector PDF canvas region**: notes without imported PDF backgrounds. Source PDF content requires annotated-pages or flattened mode.
- **Flattened PDF canvas region**: explicit image-based export, including on-screen dark PDF viewing. The resolution setting controls raster quality.

PNG/flattened exports are limited to 64 megapixels and 16,384 pixels per edge. Export preview uses a smaller image for review. Dark PDF viewing never alters the source PDF. In annotated-pages mode, annotations are placed relative to each page; the selected area option filters objects, while page output follows selected/visible PDF page objects.

## Customization

Settings include HEX/RGB colors, lined/square/dot backgrounds, grid spacing/thickness/opacity, A4 guides, interface colors, toolbar side/width/order/visibility and interface scaling. Appearance profiles export/import as JSON. Presets support named tool/color/width/opacity/smoothing, duplicate/reorder/delete, and custom color swatches. Eyedropper samples the visible canvas.

Layers support activation, rename, reorder, opacity, show/hide and locking. Use Commands for deleting layers or unlocking objects on the active layer. Bookmarks save camera positions. Search finds typed text; handwritten ink has no OCR.

## Project format and recovery

`.nocturne` is versioned UTF-8 JSON containing editable object geometry, pressure samples, layers, camera, bookmarks, document appearance and base64-embedded original assets. It is portable and inspectable. It is not encrypted.

Desktop settings, recent file paths and recovery copies live in Electron's user-data folder (normally `%APPDATA%/nocturne-notes`). Saves write a temporary sibling file, flush it, then atomically rename it. Recovery runs every eight seconds after changes and on close. An unexpected close offers recovery on the next launch. Use Save for long-term files; recovery is a single rolling session copy.

## Architecture

| Module | Responsibility |
|---|---|
| `src/model.js` | Editable document schema, validation, geometry, undo/redo, spatial index |
| `src/render.js` | Visible-object rendering, grids, selection overlays and image cache |
| `src/input.js` | Pointer pressure, coalesced samples, smoothing, gestures, erasers and transforms |
| `src/commands.js` | Central command registry, bindings, conflicts, profiles and reserved keys |
| `src/pdf.js` | PDF.js display, original asset preservation, pdf-lib exports |
| `src/app.js` | Workspace, tabs, command wiring, clipboard/import/export workflows |
| `src/settings.js`, `src/ui.js` | Settings and reusable dialogs |
| `electron/main.cjs`, `preload.cjs` | Isolated desktop file/clipboard bridge, native dialogs, recovery |
| `electron/storage.cjs` | Flush-and-rename atomic storage |

Electron is used for Windows desktop packaging and native clipboard/dialog access. Pointer Events supply pen pressure and coalesced samples when the device/driver exposes them. The model is independent of the renderer. The canvas uses viewport queries from a spatial bin index; hidden/offscreen objects are skipped. PDF caches are bounded. Undo history retains up to 150 state checkpoints and shares immutable asset strings; very large edits can still incur snapshot costs.

Renderer security: no Node integration, context isolation, sandboxed preload, local bundled resources, a restrictive content security policy and a narrow IPC bridge. New windows and external navigation are denied. Import size is limited to 512 MB in the desktop file bridge. Invalid projects fail validation.

## Verification

```powershell
npm test
npm run build
npm run test:ui
```

`npm test` covers persistence, atomic saves, undo/redo, erasing, geometry, spatial culling and shortcuts. `test:ui` is a Playwright Electron workflow that uses an isolated test profile and replaces only native file-picker dialogs with test destinations. It requires an environment that can launch Electron.

For renderer integration tests, run `npm run dev` and open `/verify.html`. It runs the real application controllers against generated images and a two-page PDF, displaying pass/fail results. This page is a development entry point and is not included in the production bundle.

See [VERIFICATION.md](VERIFICATION.md) for checks actually completed in the delivery environment and remaining limitations. Hardware pen pressure, touch rejection and native clipboard variants require testing on your own tablet/Windows session.

