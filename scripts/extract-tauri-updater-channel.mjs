import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [channelsPath, channel, outputPath] = process.argv.slice(2);

if (!channelsPath || !channel || !outputPath) {
  console.error(
    "Usage: node scripts/extract-tauri-updater-channel.mjs <channelsPath> <channel> <outputPath>",
  );
  process.exit(1);
}

if (!["stable", "unstable", "early-access"].includes(channel)) {
  throw new Error(`Unsupported channel '${channel}'.`);
}

const channels = JSON.parse(await readFile(channelsPath, "utf8"));
const manifest = channels[channel];

if (!manifest || !manifest.version || !manifest.platforms) {
  throw new Error(
    `Channel '${channel}' is missing or invalid in ${channelsPath}.`,
  );
}

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${channel} updater manifest to ${path.resolve(outputPath)}`);
