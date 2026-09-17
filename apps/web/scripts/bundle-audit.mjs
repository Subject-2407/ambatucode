/**
 * Bundle audit: what each route makes a browser download before it can render,
 * and whether the heavy modules stay where they belong.
 *
 *   pnpm --filter web build
 *   pnpm --filter web bundle:audit
 *
 * Reads the production build, so run it after `next build`. It fails when:
 *
 *   - a heavy module reaches the first load of a route that does not need it.
 *     The rich text editor must load only when an Architect opens it; drag and
 *     drop belongs to the module builder; the virtualizer to the monitor.
 *   - a route's first-load JavaScript passes its gzip budget. A lab machine is
 *     old, and a Coder opening a Material should not pay for the builder.
 *
 * Monaco is not checked here because it never enters a bundle: it is vendored
 * under /public and fetched at run time. What routes carry is its small loader.
 *
 * Modules are recognised by strings that survive minification. A marker that
 * stops matching after an upgrade makes the audit pass silently, so each one
 * is also required to appear somewhere in the build.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const BUILD = path.resolve(import.meta.dirname, "..", ".next");

/** Gzip budget for any route's first-load JavaScript, in kilobytes. */
const ROUTE_BUDGET_KB = 300;

const HEAVY = {
  "rich text editor (TipTap/ProseMirror)": { marker: /prosemirror/i, allowedIn: [] },
  "drag and drop (dnd-kit)": {
    marker: /DndContext/,
    allowedIn: ["/manage/modules/[moduleId]/builder"],
  },
  "virtualizer (@tanstack/react-virtual)": {
    marker: /getVirtualItems/,
    allowedIn: ["/manage/sessions/[sessionId]/monitor"],
  },
};

if (!fs.existsSync(path.join(BUILD, "app-build-manifest.json"))) {
  console.error("No production build found. Run `pnpm --filter web build` first.");
  process.exit(1);
}

const pages = JSON.parse(
  fs.readFileSync(path.join(BUILD, "app-build-manifest.json"), "utf8"),
).pages;

const chunks = new Map();
function chunk(file) {
  if (!chunks.has(file)) {
    const bytes = fs.readFileSync(path.join(BUILD, file));
    chunks.set(file, { gzip: zlib.gzipSync(bytes).length, text: bytes.toString("utf8") });
  }
  return chunks.get(file);
}

/** "/(coder)/modules/[moduleSlug]/page" → "/modules/[moduleSlug]" */
function routeOf(page) {
  return page.replace(/\/page$/, "").replace(/\/\([^)]+\)/g, "") || "/";
}

const failures = [];
const report = [];

for (const [page, files] of Object.entries(pages)) {
  if (!page.endsWith("/page")) continue;
  const route = routeOf(page);
  const scripts = [...new Set(files.filter((file) => file.endsWith(".js")))];
  const gzipKb = scripts.reduce((sum, file) => sum + chunk(file).gzip, 0) / 1024;
  report.push({ route, gzipKb });

  if (gzipKb > ROUTE_BUDGET_KB) {
    failures.push(
      `${route} loads ${gzipKb.toFixed(1)} kB gzip, over the ${String(ROUTE_BUDGET_KB)} kB budget`,
    );
  }
  for (const [name, { marker, allowedIn }] of Object.entries(HEAVY)) {
    if (allowedIn.includes(route)) continue;
    if (scripts.some((file) => marker.test(chunk(file).text))) {
      failures.push(`${route} loads ${name} up front`);
    }
  }
}

// A marker that matches nothing anywhere has stopped recognising its module.
const everyChunk = fs
  .readdirSync(path.join(BUILD, "static", "chunks"), { recursive: true })
  .filter((file) => String(file).endsWith(".js"))
  .map((file) => path.join("static", "chunks", String(file)));
for (const [name, { marker }] of Object.entries(HEAVY)) {
  if (!everyChunk.some((file) => marker.test(chunk(file).text))) {
    failures.push(`the marker for ${name} matches nothing in the build; update it`);
  }
}

report.sort((left, right) => right.gzipKb - left.gzipKb);
console.info(`First-load JavaScript per route (gzip, budget ${String(ROUTE_BUDGET_KB)} kB):`);
for (const { route, gzipKb } of report) {
  console.info(`  ${gzipKb.toFixed(1).padStart(6)} kB  ${route}`);
}

if (failures.length > 0) {
  console.error("\nBundle audit failed:");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.info("\nBundle audit passed: heavy modules load only where they are used.");
