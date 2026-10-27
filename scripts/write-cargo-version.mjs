import { readFile, writeFile } from "node:fs/promises";
import process from "node:process";

const [cargoTomlPath, version] = process.argv.slice(2);

if (!cargoTomlPath || !version) {
  console.error(
    "Usage: node scripts/write-cargo-version.mjs <cargoTomlPath> <version>",
  );
  process.exit(1);
}

const source = await readFile(cargoTomlPath, "utf8");
const packageSectionMatch = source.match(/\[package\][\s\S]*?(?=\n\[|$)/);

if (!packageSectionMatch) {
  throw new Error(`Could not find [package] section in ${cargoTomlPath}.`);
}

const packageSection = packageSectionMatch[0];
const nextPackageSection = packageSection.replace(
  /(^version\s*=\s*").*("\s*$)/m,
  `$1${version}$2`,
);

const currentVersion = packageSection.match(/^version\s*=\s*"([^"]*)"/m)?.[1];

if (packageSection === nextPackageSection) {
  if (currentVersion === version) {
    console.log(
      `Cargo package version is already ${version}; nothing to update.`,
    );
    process.exit(0);
  }
  throw new Error(`Could not update package version in ${cargoTomlPath}.`);
}

const rewritten = source.replace(packageSection, nextPackageSection);
await writeFile(cargoTomlPath, rewritten, "utf8");
console.log(`Updated Cargo package version to ${version}`);
