import { appendFile, readFile } from "node:fs/promises";
import process from "node:process";

const [packageJsonPath] = process.argv.slice(2);

if (!packageJsonPath) {
  console.error("Usage: node scripts/compute-build-info.mjs <packageJsonPath>");
  process.exit(1);
}

function parseCoreVersion(version) {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    throw new Error(`Unsupported version '${version}'. Expected SemVer.`);
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

async function writeGithubOutput(values) {
  if (!process.env.GITHUB_OUTPUT) {
    return;
  }

  const lines = Object.entries(values).map(([key, value]) => `${key}=${value}`);
  await appendFile(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, "utf8");
}

const pkg = JSON.parse(await readFile(packageJsonPath, "utf8"));
const baseVersion = String(pkg.version || "").trim();
const rawBuildChannel = String(process.env.GV_BUILD_CHANNEL || "")
  .trim()
  .toLowerCase();
const buildChannel = ["stable", "unstable", "early-access"].includes(
  rawBuildChannel,
)
  ? rawBuildChannel
  : "stable";
const runNumber = String(
  process.env.GITHUB_RUN_NUMBER || process.env.GV_BUILD_RUN_NUMBER || "0",
).trim();
const runAttempt = String(
  process.env.GITHUB_RUN_ATTEMPT || process.env.GV_BUILD_RUN_ATTEMPT || "1",
).trim();
const buildCommit = String(
  process.env.GITHUB_SHA || process.env.GV_BUILD_COMMIT || "",
)
  .trim()
  .slice(0, 7);

const { major, minor, patch } = parseCoreVersion(baseVersion);
const buildId = `${runNumber}.${runAttempt}`;
const buildVersion =
  buildChannel === "stable"
    ? baseVersion
    : `${major}.${minor}.${patch}-${buildChannel}.${runNumber}.${runAttempt}`;
const releaseRef = buildChannel === "stable" ? baseVersion : buildChannel;

const result = {
  base_version: baseVersion,
  build_version: buildVersion,
  build_channel: buildChannel,
  build_commit: buildCommit,
  build_id: buildId,
  release_ref: releaseRef,
};

await writeGithubOutput(result);
console.log(JSON.stringify(result, null, 2));
