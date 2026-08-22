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

const ARCH_LABELS = {
  x86_64: "x64",
  aarch64: "arm64",
  i686: "i686",
  armv7: "armv7",
};

// Arch tokens as emitted by the Tauri bundler, in order of preference.
const ARCH_TOKENS = [
  "x86_64",
  "amd64",
  "aarch64",
  "arm64",
  "x64",
  "i686",
  "ia32",
  "x86",
  "armv7",
  "arm",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Rebuilds a Tauri bundle filename into a clean, structured release name:
//   <Product>-<os>-<arch>-<version><kind/extension>
// e.g. GameVault_17.0.0_x64-setup.exe -> GameVault-windows-x64-17.0.0-setup.exe
//      gamevault_17.0.0_amd64.AppImage -> GameVault-linux-x64-17.0.0.AppImage
function toStructuredReleaseName(
  filename,
  version,
  productName,
  osLabel,
  archLabel,
) {
  const pattern = new RegExp(`^(.+?)_${escapeRegExp(version)}_(.+)$`);
  const match = filename.match(pattern);

  if (!match) {
    return `${productName}-${osLabel}-${archLabel}-${version}-${filename}`;
  }

  const [, , rest] = match;
  const cleanedRest = ARCH_TOKENS.reduce(
    (acc, token) => acc.replace(new RegExp(`^${token}(?=[.-]|$)`, "i"), ""),
    rest,
  );

  return `${productName}-${osLabel}-${archLabel}-${version}${cleanedRest}`;
}

const tauriConfig = JSON.parse(
  await readFile(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);
const productName = tauriConfig.productName || "GameVault";
const archLabel = ARCH_LABELS[resolveArchKey()] || resolveArchKey();

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
const updaterReleaseName = toStructuredReleaseName(
  path.basename(updaterAssetPath),
  version,
  productName,
  platform,
  archLabel,
);

await stat(signaturePath);

const releaseFiles = [
  {
    source: updaterAssetPath,
    target: updaterReleaseName,
  },
  {
    source: signaturePath,
    target: `${updaterReleaseName}.sig`,
  },
];

for (const optionalAsset of config.optionalReleaseAssets) {
  const assetPath = await resolveOptionalAsset(
    optionalAsset.dir,
    optionalAsset.suffix,
  );
  if (assetPath) {
    releaseFiles.push({
      source: assetPath,
      target: toStructuredReleaseName(
        path.basename(assetPath),
        version,
        productName,
        platform,
        archLabel,
      ),
    });
  }
}

await rm(releaseAssetsDir, { recursive: true, force: true });
await mkdir(releaseAssetsDir, { recursive: true });
await mkdir(metadataDir, { recursive: true });

for (const file of releaseFiles) {
  await copyFile(file.source, path.join(releaseAssetsDir, file.target));
}

const signature = (await readFile(signaturePath, "utf8")).trim();

if (!signature) {
  throw new Error(`Signature file for ${platform} updater bundle is empty.`);
}

const metadata = {
  version,
  platform: `${config.osKey}-${resolveArchKey()}`,
  assetName: updaterReleaseName,
  signature,
  releaseAssetNames: releaseFiles.map((file) => file.target),
};

const metadataPath = path.join(metadataDir, `${platform}.json`);
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

console.log(`Prepared ${platform} release assets in ${releaseAssetsDir}`);
console.log(`Prepared updater metadata in ${metadataPath}`);
