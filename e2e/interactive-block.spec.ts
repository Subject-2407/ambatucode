import { expect, test, type FrameLocator, type Page } from "@playwright/test";
import { signIn } from "./fixtures";

/**
 * The Interactive Block isolation contract, asserted in a real browser.
 *
 * Every claim here is one the unit tests cannot make. A unit test can prove the
 * assembled document *says* `sandbox="allow-scripts"`; only a browser can prove
 * that the frame consequently cannot read `document.cookie`, cannot reach
 * `parent`, and cannot open a socket. These are the tests that would catch
 * someone adding `allow-same-origin` to fix a layout bug.
 */

const MATERIAL_PATH = "/modules/python-foundations/materials/seed-material-loops";

/** The seeded block lives in the Control Flow material. */
async function openMaterialWithBlock(page: Page): Promise<FrameLocator> {
  await signIn(page, "coder");
  await page.goto(MATERIAL_PATH);

  const frame = page.frameLocator('iframe[title="Loop trace"]');
  // The block renders its own content, so waiting on that is waiting on the
  // frame having actually executed rather than merely existing.
  await expect(frame.locator("#step")).toBeVisible();
  return frame;
}

/**
 * Runs a reader inside the block's frame and reports what happened as text.
 *
 * Text, because a SecurityError thrown across a frame boundary does not survive
 * serialization back to the test — the frame has to describe the outcome rather
 * than let Playwright try to marshal the failure itself. "ok:" and "threw:"
 * then distinguish a value the frame could read from an access it was denied.
 */
async function probe(frame: FrameLocator, read: () => unknown): Promise<string> {
  return frame.locator("body").evaluate((_element, source) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const reader = new Function(`return (${source})()`) as () => unknown;
      return `ok:${String(reader())}`;
    } catch (error) {
      return `threw:${(error as Error).name}`;
    }
  }, read.toString());
}

test.describe("interactive block isolation", () => {
  test("renders inside visible platform framing", async ({ page }) => {
    await openMaterialWithBlock(page);

    // The framing is the mitigation the sandbox flags cannot provide: a Coder
    // has to be able to tell platform interface from authored content, so a
    // block can never pass itself off as a system prompt or a credential form.
    await expect(page.getByText("Interactive block").first()).toBeVisible();
    await expect(page.getByText("Loop trace")).toBeVisible();
  });

  test("carries the sandbox flags and nothing more", async ({ page }) => {
    await signIn(page, "coder");
    await page.goto(MATERIAL_PATH);

    const iframe = page.locator('iframe[title="Loop trace"]');
    await expect(iframe).toHaveAttribute("sandbox", "allow-scripts");
    await expect(iframe).toHaveAttribute("referrerpolicy", "no-referrer");

    // Named individually so a regression reads as the capability it restored
    // rather than as a string mismatch.
    const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
    for (const forbidden of [
      "allow-same-origin",
      "allow-forms",
      "allow-modals",
      "allow-popups",
      "allow-top-navigation",
      "allow-downloads",
      "allow-pointer-lock",
    ]) {
      expect(sandbox).not.toContain(forbidden);
    }
  });

  test("has an opaque origin, so it owns nothing", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);

    // The single fact everything else rests on. With allow-same-origin the
    // frame would report the application's own origin and every assertion
    // below would quietly start passing for the wrong reason.
    expect(await probe(frame, () => window.origin)).toBe("ok:null");
  });

  test("cannot read cookies or storage", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);

    // An opaque origin has no cookie jar, so the read yields nothing rather
    // than throwing — either way the session is unreachable.
    expect(await probe(frame, () => document.cookie)).toBe("ok:");

    // Storage is denied outright to an opaque origin.
    expect(await probe(frame, () => localStorage.length)).toMatch(/^threw:/);
    expect(await probe(frame, () => sessionStorage.length)).toMatch(/^threw:/);
  });

  test("cannot reach the hosting page", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);

    expect(await probe(frame, () => parent.document.title)).toMatch(/^threw:/);
    expect(await probe(frame, () => parent.location.href)).toMatch(/^threw:/);
    expect(await probe(frame, () => top!.document.body.innerHTML)).toMatch(/^threw:/);
  });

  test("cannot issue a network request", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);

    // default-src 'none' is what makes the platform offline-first as well as
    // exfiltration-proof: a block cannot phone home even to its own origin.
    const fetched = await frame.locator("body").evaluate(async () => {
      try {
        await fetch("/api/auth/me");
        return "REACHED";
      } catch {
        return "blocked";
      }
    });
    expect(fetched).toBe("blocked");

    const socket = await probe(frame, () => new WebSocket("ws://localhost:3001").url);
    expect(socket).toMatch(/^threw:/);
  });

  test("ignores a forged resize message from another frame", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);
    const iframe = page.locator('iframe[title="Loop trace"]');

    await expect(frame.locator("#step")).toBeVisible();
    const before = await iframe.boundingBox();

    // A second sandboxed frame reports the same `event.origin` of "null" as the
    // real block does, which is exactly why the host matches on window identity
    // instead. If it ever went back to checking origin, this would resize the
    // real block's frame.
    await page.evaluate(() => {
      const forger = document.createElement("iframe");
      forger.setAttribute("sandbox", "allow-scripts");
      forger.srcdoc =
        `<script>
        parent.postMessage({ type: "ambatucode:block:resize", height: 3999 }, "*");
      </` + `script>`;
      forger.style.width = "1px";
      forger.style.height = "1px";
      document.body.appendChild(forger);
    });

    await page.waitForTimeout(750);

    const after = await iframe.boundingBox();
    expect(after?.height).toBeCloseTo(before?.height ?? 0, 0);
  });

  test("sizes itself from its own content", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);
    const iframe = page.locator('iframe[title="Loop trace"]');

    await expect(frame.locator(".cell").first()).toBeVisible();

    // The resize bridge is the only reason a block is not stuck at the
    // pre-measured height it reserved, and a height of zero would mean the
    // block rendered into nothing the reader can see.
    const box = await iframe.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThan(0);
    expect(box?.height ?? 0).toBeLessThanOrEqual(4000);
  });

  test("stays interactive, and a failure stays inside its own frame", async ({ page }) => {
    const frame = await openMaterialWithBlock(page);

    await frame.locator("#step").click();
    await expect(frame.locator(".cell.seen")).toHaveCount(1);

    // The Material around it keeps rendering regardless of what the block does.
    await expect(page.getByRole("heading", { name: "Repeating work" })).toBeVisible();
  });
});
