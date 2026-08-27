import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const packageJson = JSON.parse(
  await readFile(path.join(repoRoot, "package.json"), "utf8"),
);
const tauriConfig = JSON.parse(
  await readFile(path.join(repoRoot, "src-tauri", "tauri.conf.json"), "utf8"),
);

const appId = tauriConfig.identifier || "com.phalcode.gamevault";
const productName = tauriConfig.productName || "GameVault";
const homepage = tauriConfig.bundle?.homepage || "";
const shortDescription =
  tauriConfig.bundle?.shortDescription || packageJson.description || "";
const longDescription = tauriConfig.bundle?.longDescription || shortDescription;
const author = packageJson.author || "Phalcode";
// package.json uses human-readable license names, AppStream expects SPDX ids.
const license = (packageJson.license || "Unknown").replace(
  /[^A-Za-z0-9.+-]/g,
  "-",
);
// On Linux the binary and desktop file are named after the lowercased product.
const linuxName = productName.toLowerCase();
const desktopId = `${linuxName}.desktop`;

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const metainfo = `<?xml version="1.0" encoding="UTF-8"?>
<component type="desktop-application">
  <id>${escapeXml(appId)}</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>${escapeXml(license)}</project_license>
  <name>${escapeXml(productName)}</name>
  <summary>${escapeXml(shortDescription)}</summary>
  <description>
    <p>${escapeXml(longDescription)}</p>
  </description>
  <launchable type="desktop-id">${escapeXml(desktopId)}</launchable>
  <provides>
    <binary>${escapeXml(linuxName)}</binary>
  </provides>
  <url type="homepage">${escapeXml(homepage)}</url>
  <developer id="com.phalcode">
    <name>${escapeXml(author)}</name>
  </developer>
</component>
`;

const outputPath = path.join(
  repoRoot,
  "src-tauri",
  "linux",
  `${appId}.metainfo.xml`,
);
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, metainfo, "utf8");

console.log(`Wrote AppStream metainfo to ${outputPath}`);
