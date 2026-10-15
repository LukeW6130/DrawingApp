# Test Nocturne on your Windows computer

## 1. Start the app

**No Node.js required:** extract `Nocturne-Notes-Windows-x64.zip` completely, then double-click **Nocturne Notes.exe** inside the extracted folder. Keep the EXE next to its `resources`, DLLs and other runtime files. Do not launch directly inside the ZIP or move only the EXE.

The provided build is unsigned. An installed/signed release is not included. The single-file installer could not be generated in the delivery sandbox; the extracted folder is the ready-to-run form.

**From source:** install Node.js 22.12+ (24 LTS recommended), open PowerShell in the source folder, then:

```powershell
npm ci
npm run build
npm start
```

The default layout follows your reference: solid black infinite canvas, white/blue/red/green/yellow pens at the top of a narrow left rail, compact stroke controls beside it, and a collapsed large inspector. Click **☷** in the top bar or press **Tab** to open the inspector. Click **+** at the bottom of the rail, or press **Ctrl+K**, to find all tools and commands. Settings lets you choose which tools remain visible.

## 2. Ten-minute acceptance test

Use a disposable new document. Save it as `Nocturne-test.nocturne`.

| Test | What to do | Expected result |
|---|---|---|
| Pens | Press **1**, draw; repeat with **2–5**. Use your tablet with light and firm pressure. | Five ink colors. Supported pen devices produce different widths; the mouse produces constant-width strokes. |
| Quick properties | Click the width value beside the pen rail, enter `6`, then change opacity and smoothing. | New strokes use these settings. Earlier strokes remain unchanged. |
| Navigation | Hold **Space**, drag, release and draw. Use Ctrl+wheel, then Ctrl+1. | Temporary pan returns to your prior tool. Zoom is centered at the cursor. Fit brings notes back into view. |
| Text safety | Choose **T**, click the canvas, type `BEVT 123` and a math formula. Click Done. | The text remains editable; typing letters/numbers does not switch tools or presets. Double-click it using Select to edit again. |
| Selection | Use **V**, click a stroke, drag it. Resize using the lower-right handle and rotate using the top handle. | Object geometry remains editable. Ctrl+D duplicates. Ctrl+Z / Ctrl+Y reverse and restore the changes. |
| Erasers | Use **E** on a stroke. Undo. Find **Partial eraser** in Ctrl+K and erase through its middle. | Whole eraser removes one stroke; partial eraser splits it. Undo restores it. |
| Screenshot | Take a Windows snip, return to Nocturne and press Ctrl+V. Resize the image; open the inspector and click Lock. Select a pen and annotate. | Image appears, transforms, then stays protected while ink is added above it. |
| PDF | Import `examples/two-page-worksheet.pdf` (included). Choose all pages, vertical layout. Annotate both pages. | Both differently sized pages appear on a locked PDF layer. Ink remains editable on the Notes layer. |
| Annotated PDF | Export → **Annotated PDF pages** → Export. Open the result in your PDF reader. | Two pages with their original sizes, annotations correctly placed, and selectable original worksheet text. |
| Background | Settings → Appearance: change background, select grid, change spacing. | Grid/background update without changing existing ink colors. |
| Project | Save, close the tab, open `Nocturne-test.nocturne`. | Strokes/text remain selectable and editable; images, PDF pages, layers and bookmarks survive. |
| PNG | Select objects or draw an Export region, export PNG with background unchecked. | PNG uses the chosen bounds and has transparency. |

## 3. Shortcuts and restart persistence

1. Open **Settings → Shortcuts** (or Ctrl+Shift+K).
2. Search `Pen`. Click Add for the Pen command, press **F6**, then Assign.
3. Assign **B** to another command. Confirm that the editor warns about the conflict and only reassigns it when you explicitly choose Reassign.
4. Export the shortcut profile. Remove F6, import the profile and verify F6 returns.
5. Create/edit a pen preset; change an interface color. Save your project and close the app.
6. Reopen. **F6**, your preset, and the interface color should still work.

The single-letter and number bindings apply when focus is on the canvas, not when editing text, numeric fields, searches or dropdowns. Windows-reserved shortcuts cannot be captured reliably and are rejected where detectable.

## 4. Recovery after an interrupted session

1. Start a **new disposable document** and draw a recognizable shape. Do not save it.
2. Wait at least **10 seconds** for autosave.
3. Open Windows Task Manager and end **Nocturne Notes**. Do this only with the disposable test document.
4. Reopen the app and choose **Recover notes**.
5. Verify the shape is present and editable, then save the recovered project.

Recovery is a rolling copy, not a substitute for saving projects. Changes during the last eight seconds before a crash may not be present.

## 5. Automated checks you can run

```powershell
npm test
npm run build
npm run test:ui
```

- `npm test`: model, shortcuts, geometry, spatial index and atomic save tests.
- `npm run test:ui`: desktop workflow through Playwright, including the real Windows clipboard bridge and restart. It uses a separate `test-results/electron-profile` and test-only files. The screenshot clipboard test temporarily replaces your Windows clipboard contents.
- `npm run dev`, then visit `http://127.0.0.1:5173/verify.html`: browser integration suite with generated image/PDF fixtures. Use the port printed by Vite if it differs. It writes test settings and browser recovery data for that localhost origin, separate from desktop settings.

## 6. If something fails

Record the action, expected/actual result, Windows version, tablet model/driver, and whether it happens with both mouse and stylus. For PDF issues, note page count, original page rotation and whether the failure is in viewing or export. Save a disposable `.nocturne` reproduction if possible.

If native launch fails, try the source launch above and copy the terminal error. The delivery environment could build the unpacked Windows app but could not launch Electron, so native startup, hardware pressure, clipboard variants and the desktop restart test still need your Windows-session check. See `VERIFICATION.md` for the exact completed checks and limitations.
