import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const [version] = process.argv.slice(2);

if (!version) {
  console.error("Usage: node scripts/write-debian-changelog.mjs <version>");
  process.exit(1);
}

const changelogPath = path.join(process.cwd(), "src-tauri", "debian-changelog");
const notes = process.env.GV_UPDATER_NOTES?.trim() || "Native Linux bug fixes.";
const date = new Date().toISOString().slice(0, 10);

const existing = await readFile(changelogPath, "utf8").catch(() => "");

// Debian changelogs list newest entries first. If the top entry already
// matches the version we are building (e.g. a stable build whose committed
// changelog already carries that entry), leave it untouched.
const topVersion = existing.match(/^gamevault \(([^)]+)\)/)?.[1];
if (topVersion === version) {
  console.log(`debian-changelog already has an entry for ${version}; skipping`);
  process.exit(0);
}

const entry = [
  `gamevault (${version}) unstable; urgency=medium`,
  "",
  `  * ${notes}`,
  "",
  ` -- Phalcode <support@gamevau.lt>  ${date} 00:00:00 +0000`,
  "",
  "",
].join("\n");

await writeFile(changelogPath, `${entry}${existing}`);

console.log(`Wrote debian-changelog entry for ${version}`);
