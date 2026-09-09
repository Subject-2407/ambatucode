/**
 * Re-vendors the BullMQ Lua scripts the Go worker executes.
 *
 * The worker runs BullMQ's own scripts rather than reimplementing the queue
 * state machine, so those scripts have to be copied into the Go module and
 * kept in step with the installed `bullmq` version. Run this after any BullMQ
 * upgrade, in the same commit as the upgrade.
 *
 * The source is `dist/cjs/scripts`, not `dist/cjs/commands`. Both ship with
 * the package, but `commands` still carries unresolved `--- @include`
 * directives while `scripts` is what BullMQ's own build already flattened —
 * with the fragments spliced in at the exact points the directives sat, after
 * the `local rcall = redis.call` the fragments depend on. Resolving the
 * includes independently means reproducing that ordering rule, and getting it
 * wrong yields Lua that only fails once Redis runs it.
 *
 * Usage: node scripts/revendor-bullmq-lua.mjs
 */
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");

/** The three entry points the worker executes, by BullMQ's own script name. */
const SCRIPTS = ["moveToActive", "moveToFinished", "moveJobFromActiveToWait"];

const pkgJson = require.resolve("bullmq/package.json", {
  paths: [path.join(repoRoot, "apps/web")],
});
const pkgRoot = path.dirname(pkgJson);
const version = JSON.parse(fs.readFileSync(pkgJson, "utf8")).version;
const scriptsDir = path.join(pkgRoot, "dist/cjs/scripts");
const outDir = path.join(repoRoot, "apps/worker/internal/queue/lua");

if (!fs.existsSync(scriptsDir)) {
  throw new Error(`bullmq prebuilt scripts not found at ${scriptsDir}`);
}

/** Finds a script's module file regardless of the `-N` key count in its name. */
function resolveScriptFile(name) {
  const match = fs
    .readdirSync(scriptsDir)
    .find((file) => file.startsWith(`${name}-`) && file.endsWith(".js"));
  if (!match) {
    throw new Error(`bullmq ${version} no longer ships a ${name} script`);
  }
  return path.join(scriptsDir, match);
}

const vendored = [];
for (const name of SCRIPTS) {
  const loaded = require(resolveScriptFile(name))[name];
  if (!loaded?.content || typeof loaded.keys !== "number") {
    throw new Error(`${name} did not export the expected {content, keys} shape`);
  }
  if (loaded.content.includes("@include")) {
    throw new Error(`${name} still contains an unresolved @include; it is not the flattened build`);
  }
  // The key count comes from BullMQ rather than the filename, and is re-encoded
  // into the filename so the Go side has a single source for it.
  vendored.push({ filename: `${name}-${loaded.keys}.lua`, content: loaded.content });
}

// Clear the Lua out rather than merging into it: a script dropped upstream must
// disappear here too, or the Go embed keeps executing a stale copy. Only the
// .lua files are removed — README.md is ours and is not regenerated.
fs.mkdirSync(outDir, { recursive: true });
for (const stale of fs.readdirSync(outDir)) {
  if (stale.endsWith(".lua")) fs.rmSync(path.join(outDir, stale));
}
// Previous versions of this script vendored an includes/ tree; it is obsolete.
fs.rmSync(path.join(outDir, "includes"), { recursive: true, force: true });

for (const { filename, content } of vendored) {
  fs.writeFileSync(path.join(outDir, filename), content, "utf8");
}
fs.copyFileSync(path.join(pkgRoot, "LICENSE"), path.join(outDir, "LICENSE.bullmq"));

console.info(`Vendored ${vendored.length} flattened Lua scripts from bullmq ${version}:`);
for (const { filename } of vendored) console.info(`  ${filename}`);
console.info("Update the version named in lua/README.md by hand if it changed.");
