import { access, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Copies Monaco's AMD build into `public/monaco/vs` so the editor loads from
 * this server and never from a CDN.
 *
 * Ambatucode is offline-first: a lab machine with no route to the internet
 * must still open the editor. `@monaco-editor/react` defaults to jsDelivr, so
 * the vendored copy plus `loader.config({ paths: { vs } })` in the editor
 * component are what actually make that true.
 *
 * The copy is generated, not committed — it is several megabytes of files that
 * belong to the installed package version. A stamp file records which version
 * produced it so an upgrade re-copies and an unchanged install does not.
 */

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, "..");
const target = join(webRoot, "public", "monaco");
const vsTarget = join(target, "vs");
const stampFile = join(target, ".version");

const require = createRequire(import.meta.url);

async function readStamp() {
  try {
    return (await readFile(stampFile, "utf8")).trim();
  } catch {
    return null;
  }
}

async function exists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** Walks up from a resolved entry point to the directory holding its manifest. */
async function findPackageRoot(entry) {
  let dir = dirname(entry);
  while (!(await exists(join(dir, "package.json")))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`No package.json above ${entry}`);
    dir = parent;
  }
  return dir;
}

async function main() {
  // The package blocks a direct `package.json` import through its exports
  // map, so the install directory is found by walking up from the entry
  // point instead — which also works whatever layout pnpm chose.
  const packageRoot = await findPackageRoot(require.resolve("monaco-editor"));
  const { version } = JSON.parse(await readFile(join(packageRoot, "package.json"), "utf8"));
  const source = join(packageRoot, "min", "vs");

  if ((await readStamp()) === version && (await exists(vsTarget))) {
    console.info(`monaco-editor ${version} already vendored`);
    return;
  }

  if (!(await exists(source))) {
    throw new Error(`monaco-editor build not found at ${source}; run pnpm install`);
  }

  await rm(vsTarget, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(source, vsTarget, { recursive: true });
  await writeFile(stampFile, `${version}\n`, "utf8");

  console.info(`Vendored monaco-editor ${version} into public/monaco/vs`);
}

main().catch((error) => {
  console.error("Failed to vendor monaco-editor:", error);
  process.exitCode = 1;
});
