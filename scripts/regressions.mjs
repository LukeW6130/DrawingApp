import assert from "node:assert/strict";
import { chromium } from "playwright";
import { createServer } from "vite";
import { newDocument, normalizeStroke } from "../src/model.js";

const server = await createServer({ server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const url = server.resolvedUrls.local[0];
  browser = await chromium.launch({
    headless: true,
    ...(process.env.BROWSER_CHANNEL
      ? { channel: process.env.BROWSER_CHANNEL }
      : {}),
  });
  const errors = [];
  for (const action of ["Recover notes", "Discard recovery"]) {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.on("pageerror", (error) => errors.push(error.message));
    const doc = newDocument("Recovery regression");
    doc.objects.push(
      normalizeStroke(
        [
          { x: 10, y: 10, p: 1 },
          { x: 80, y: 80, p: 1 },
        ],
        {
          layer: doc.activeLayer,
          color: "#ffffff",
          width: 3,
          opacity: 1,
        },
      ),
    );
    const recovery = JSON.stringify([
      { doc, path: null, dirty: true, revision: 1 },
    ]);
    await page.addInitScript((data) => {
      if (!sessionStorage.getItem("regression-seeded")) {
        localStorage.setItem("nocturne.recovery", data);
        sessionStorage.setItem("regression-seeded", "true");
      }
    }, recovery);
    await page.goto(url);
    await page.waitForFunction(() => window.nocturne);
    await page.waitForTimeout(9000);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("nocturne.recovery")),
      recovery,
    );
    await page.keyboard.press("Escape");
    assert.equal(await page.locator("dialog[open]").count(), 1);
    await page.evaluate(() => nocturne.autosave());
    assert.equal(
      await page.evaluate(() => localStorage.getItem("nocturne.recovery")),
      recovery,
    );
    // Reload also exercises the beforeunload autosave path while unresolved.
    await page.reload();
    await page.waitForFunction(() => window.nocturne);
    assert.equal(
      await page.evaluate(() => localStorage.getItem("nocturne.recovery")),
      recovery,
    );
    await page.getByRole("button", { name: action, exact: true }).click();
    await page.waitForFunction(() => !nocturne.recoveryPending);
    if (action === "Recover notes") {
      assert.equal(
        await page.evaluate(() => nocturne.doc.objects[0].id),
        doc.objects[0].id,
      );
      await page.evaluate(() => nocturne.autosave());
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("nocturne.recovery"))[0].doc.name,
        ),
        doc.name,
      );
      // Registry, palette and keyboard must all select from an empty selection.
      assert.equal(
        await page.evaluate(() => nocturne.registry.available("selection.all")),
        true,
      );
      await page.evaluate(() => nocturne.registry.run("selection.all"));
      assert.deepEqual(await page.evaluate(() => [...nocturne.selection]), [
        doc.objects[0].id,
      ]);
      await page.evaluate(() => nocturne.registry.run("selection.clear"));
      await page.keyboard.press("Control+k");
      await page.locator("dialog input").fill("Select all unlocked objects");
      await page
        .getByRole("button", { name: /Select all unlocked objects/ })
        .click();
      assert.deepEqual(await page.evaluate(() => [...nocturne.selection]), [
        doc.objects[0].id,
      ]);
      await page.evaluate(() => nocturne.registry.run("selection.clear"));
      await page.locator("#ink").focus();
      await page.keyboard.press("Control+a");
      assert.deepEqual(await page.evaluate(() => [...nocturne.selection]), [
        doc.objects[0].id,
      ]);
      // Disabled commands must stay disabled through the keyboard path too.
      await page.evaluate(() => {
        nocturne.registry.commands.get("selection.all").available = () => false;
        nocturne.selection.clear();
      });
      await page.keyboard.press("Control+a");
      assert.equal(await page.evaluate(() => nocturne.selection.size), 0);
    } else {
      assert.equal(
        await page.evaluate(() => localStorage.getItem("nocturne.recovery")),
        null,
      );
      await page.evaluate(() => nocturne.autosave());
      assert.equal(
        await page.evaluate(
          () =>
            JSON.parse(localStorage.getItem("nocturne.recovery"))[0].doc.name,
        ),
        "Untitled",
      );
    }
    await context.close();
  }
  const page = await browser.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(new URL("verify.html", url).href);
  await page.waitForFunction(() => window.integrationResults, null, {
    timeout: 60000,
  });
  const results = await page.evaluate(() => window.integrationResults);
  assert.equal(results.passed, true, JSON.stringify(results));
  assert.deepEqual(errors, []);
  console.log(
    `PASS: pending recovery survives autosave, Escape and reload; recover/discard resume writes; Select All registry, palette and keyboard agree. ${results.results.filter((r) => r.startsWith("PASS")).length} integration checks passed.`,
  );
} finally {
  await browser?.close();
  await server.close();
}
