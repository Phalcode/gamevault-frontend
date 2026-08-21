import {
  copyFile,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [platform, version] = process.argv.slice(2);

if (!platform || !version) {
  console.error(
    "Usage: node scripts/prepare-tauri-release-assets.mjs <platform> <version>",
  );
  process.exit(1);
}

const PLATFORM_CONFIG = {
  linux: {
    updaterDir: "appimage",
    updaterSuffix: ".AppImage",
    osKey: "linux",
    optionalReleaseAssets: [{ dir: "deb", suffix: ".deb" }],
  },
  windows: {
    updaterDir: "nsis",
    updaterSuffix: ".exe",
    osKey: "windows",
    optionalReleaseAssets: [],
  },
  macos: {
    updaterDir: "macos",
    updaterSuffix: ".app.tar.gz",
    osKey: "darwin",
    optionalReleaseAssets: [{ dir: "dmg", suffix: ".dmg" }],
  },
};

const config = PLATFORM_CONFIG[platform];

if (!config) {
  console.error(`Unsupported platform '${platform}'.`);
  process.exit(1);
}

const repoRoot = process.cwd();
const bundleRoot = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "release",
  "bundle",
);
const releaseAssetsDir = path.join(repoRoot, "release-assets", platform);
const metadataDir = path.join(repoRoot, "updater-metadata");

function resolveArchKey() {
  const rawArch = (process.env.RUNNER_ARCH || process.arch || "").toLowerCase();

  switch (rawArch) {
    case "x64":
    case "x86_64":
      return "x86_64";
    case "arm64":
    case "aarch64":
      return "aarch64";
    case "x86":
    case "ia32":
    case "i686":
      return "i686";
    case "arm":
    case "armv7":
      return "armv7";
    default:
      throw new Error(`Unsupported runner architecture '${rawArch}'.`);
  }
}

async function listFiles(dirPath) {
  const entries = await readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => path.join(dirPath, entry.name));
}

function pickSingleFile(files, predicate, description) {
  const matches = files.filter(predicate).sort();

  if (matches.length === 0) {
    throw new Error(
      `Could not find ${description}. Files seen: ${files.map((file) => path.basename(file)).join(", ") || "<none>"}`,
    );
  }

  return matches[0];
}

async function resolveOptionalAsset(dirName, suffix) {
  const dirPath = path.join(bundleRoot, dirName);

  try {
    const files = await listFiles(dirPath);
    return pickSingleFile(
      files,
      (file) => file.endsWith(suffix) && !file.endsWith(`${suffix}.sig`),
      `${platform} asset ${suffix}`,
    );
  } catch (error) {
    console.warn(`Skipping optional ${suffix} asset from ${dirName}:`, error);
    return null;
  }
}

const updaterDirPath = path.join(bundleRoot, config.updaterDir);
const updaterFiles = await listFiles(updaterDirPath);
const updaterAssetPath = pickSingleFile(
  updaterFiles,
  (file) =>
    file.endsWith(config.updaterSuffix) &&
    !file.endsWith(`${config.updaterSuffix}.sig`),
  `${platform} updater bundle`,
);
const signaturePath = `${updaterAssetPath}.sig`;

await stat(signaturePath);

const releaseFiles = [updaterAssetPath, signaturePath];

for (const optionalAsset of config.optionalReleaseAssets) {
  const assetPath = await resolveOptionalAsset(
    optionalAsset.dir,
    optionalAsset.suffix,
  );
  if (assetPath) {
    releaseFiles.push(assetPath);
  }
}

await rm(releaseAssetsDir, { recursive: true, force: true });
await mkdir(releaseAssetsDir, { recursive: true });
await mkdir(metadataDir, { recursive: true });

for (const filePath of releaseFiles) {
  await copyFile(
    filePath,
    path.join(releaseAssetsDir, path.basename(filePath)),
  );
}

const signature = (await readFile(signaturePath, "utf8")).trim();

if (!signature) {
  throw new Error(`Signature file for ${platform} updater bundle is empty.`);
}

const metadata = {
  version,
  platform: `${config.osKey}-${resolveArchKey()}`,
  assetName: path.basename(updaterAssetPath),
  signature,
};

const metadataPath = path.join(metadataDir, `${platform}.json`);
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log(`Prepared ${platform} release assets in ${releaseAssetsDir}`);
console.log(`Prepared updater metadata in ${metadataPath}`);
