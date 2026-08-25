import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [existingPath, channel, manifestPath, outputPath] = process.argv.slice(2);

if (!existingPath || !channel || !manifestPath || !outputPath) {
  console.error(
    "Usage: node scripts/merge-tauri-updater-channels.mjs <existingPath> <channel> <manifestPath> <outputPath>",
  );
  process.exit(1);
}

if (!["stable", "unstable", "early-access"].includes(channel)) {
  throw new Error(`Unsupported channel '${channel}'.`);
}

async function readJsonIfPresent(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();
    return trimmed ? JSON.parse(trimmed) : {};
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return {};
    }

    throw error;
  }
}

const existing = await readJsonIfPresent(existingPath);
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

if (
  !manifest.version ||
  !manifest.platforms ||
  typeof manifest.platforms !== "object"
) {
  throw new Error(`Invalid updater manifest in ${manifestPath}.`);
}

const channels = {
  ...existing,
  [channel]: manifest,
};

await writeFile(outputPath, `${JSON.stringify(channels, null, 2)}\n`, "utf8");
console.log(`Wrote updater channels source to ${path.resolve(outputPath)}`);
