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

  if (!entry.platform || !entry.assetName || !entry.signature) {
    throw new Error(`Invalid updater metadata in ${filePath}.`);
  }

  platforms[entry.platform] = {
    url: `https://github.com/${repository}/releases/download/${assetTag}/${encodeURIComponent(entry.assetName)}`,
    signature: entry.signature,
  };
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms,
};

const notes = process.env.GV_UPDATER_NOTES?.trim();
if (notes) {
  manifest.notes = notes;
}

const outputDir = path.dirname(outputPath);
if (outputDir && outputDir !== ".") {
  await mkdir(outputDir, { recursive: true });
}

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote updater manifest to ${outputPath}`);
