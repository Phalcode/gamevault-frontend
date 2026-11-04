/**
 * Copies the Bergamot translation engine (worker JS + WASM) from the npm
 * package into `public/bergamot-engine/` so both the web build and the Tauri
 * bundle can load it as plain static files.
 *
 * The files are generated, not committed: `public/bergamot-engine/` is
 * gitignored and rebuilt by `predev` / `prebuild`.
 */
import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = join(
  root,
  "node_modules",
  "@browsermt",
  "bergamot-translator",
  "worker",
);
const target = join(root, "public", "bergamot-engine");

const FILES = [
  "translator-worker.js",
  "bergamot-translator-worker.js",
  "bergamot-translator-worker.wasm",
];

async function main() {
  try {
    await stat(source);
  } catch {
    console.error(
      `[bergamot] engine not found at ${source}. Run "pnpm install" first.`,
    );
    process.exitCode = 1;
    return;
  }

  await mkdir(target, { recursive: true });
  for (const file of FILES) {
    await copyFile(join(source, file), join(target, file));
  }
  console.log(
    `[bergamot] engine copied to public/bergamot-engine (${FILES.length} files)`,
  );
}

await main();
