import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [templatePath, outputPath] = process.argv.slice(2);

if (!templatePath || !outputPath) {
  console.error(
    "Usage: node scripts/write-tauri-release-config.mjs <templatePath> <outputPath>",
  );
  process.exit(1);
}

const pubkey = process.env.GV_TAURI_UPDATER_PUBKEY?.trim();

if (!pubkey) {
  throw new Error(
    "GV_TAURI_UPDATER_PUBKEY is required to generate the Tauri release config.",
  );
}

const template = JSON.parse(await readFile(templatePath, "utf8"));
const merged = {
  ...template,
  plugins: {
    ...(template.plugins ?? {}),
    updater: {
      ...(template.plugins?.updater ?? {}),
      pubkey,
    },
  },
};

const outputDir = path.dirname(outputPath);
if (outputDir && outputDir !== ".") {
  await mkdir(outputDir, { recursive: true });
}

await writeFile(outputPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
console.log(`Wrote Tauri release config to ${path.resolve(outputPath)}`);
