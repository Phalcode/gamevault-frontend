import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [
  version,
  metadataRoot,
  outputPath,
  repository = "Phalcode/gamevault-frontend",
  assetTag = version,
] = process.argv.slice(2);

if (!version || !metadataRoot || !outputPath) {
  console.error(
    "Usage: node scripts/build-tauri-updater-manifest.mjs <version> <metadataRoot> <outputPath> [repository] [assetTag]",
  );
  process.exit(1);
}

async function collectJsonFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files;
}

const metadataFiles = await collectJsonFiles(metadataRoot);

if (metadataFiles.length === 0) {
  throw new Error(`No updater metadata files found under ${metadataRoot}.`);
}

const platforms = {};

for (const filePath of metadataFiles.sort()) {
  const raw = await readFile(filePath, "utf8");
  const entry = JSON.parse(raw);

  if (
    !entry.osKey ||
    !entry.arch ||
    !Array.isArray(entry.updaters) ||
    entry.updaters.length === 0
  ) {
    throw new Error(`Invalid updater metadata in ${filePath}.`);
  }

  // Emit one feed entry per installer (e.g. "linux-x86_64-deb" and
  // "linux-x86_64-appimage"). The Tauri updater client looks up
  // "<os>-<arch>-<installer>" before falling back to "<os>-<arch>", so this
  // lets both .deb and AppImage installs auto-update.
  for (const updater of entry.updaters) {
    if (!updater.assetName || !updater.signature) {
      throw new Error(
        `Invalid updater metadata (missing assetName/signature) in ${filePath}.`,
      );
    }
    const key =
      `${entry.osKey}-${entry.arch}` +
      (updater.installer ? `-${updater.installer}` : "");
    platforms[key] = {
      url: `https://github.com/${repository}/releases/download/${assetTag}/${encodeURIComponent(updater.assetName)}`,
      signature: updater.signature,
    };
  }

  // Fallback "<os>-<arch>" key for clients whose installed bundle type is
  // unknown; point it at the first (primary) updater bundle.
  const fallbackKey = `${entry.osKey}-${entry.arch}`;
  if (!platforms[fallbackKey]) {
    const primary = entry.updaters[0];
    platforms[fallbackKey] = {
      url: `https://github.com/${repository}/releases/download/${assetTag}/${encodeURIComponent(primary.assetName)}`,
      signature: primary.signature,
    };
  }
}

const manifest = {
  version,
  platforms,
};

const notes = process.env.GV_UPDATER_NOTES?.trim();
if (notes) {
  manifest.notes = notes;
}

const buildId = process.env.GV_BUILD_ID?.trim();
if (buildId) {
  manifest.build_id = buildId;
}

const buildCommit = process.env.GV_BUILD_COMMIT?.trim();
if (buildCommit) {
  manifest.build_commit = buildCommit;
}

const buildChannel = process.env.GV_BUILD_CHANNEL?.trim();
if (buildChannel) {
  manifest.build_channel = buildChannel;
}

const outputDir = path.dirname(outputPath);
if (outputDir && outputDir !== ".") {
  await mkdir(outputDir, { recursive: true });
}

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote updater manifest to ${outputPath}`);
