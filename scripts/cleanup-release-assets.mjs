import process from "node:process";

const argv = process.argv.slice(2);
const repository = argv[0];
const tag = argv[1];
const keepVersionIndex = argv.indexOf("--keep-version");
const keepVersion =
  keepVersionIndex !== -1 ? argv[keepVersionIndex + 1] : null;

if (!repository || !tag) {
  console.error(
    "Usage: node scripts/cleanup-release-assets.mjs <repository> <tag> [--keep-version <version>]",
  );
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN?.trim();

if (!token) {
  throw new Error("GITHUB_TOKEN is required to clean up release assets.");
}

// Assets that must always survive a prerelease cleanup.
const ALWAYS_KEEP = new Set([
  "gamevault-frontend.zip",
  "unstable.json",
  "early-access.json",
  "latest.json",
  "updater-channels.json",
]);

// Keep the assets still referenced by the currently-published updater feeds so
// the updater never points at a deleted artifact (relevant on partially
// succeeded builds where the feed was not republished).
async function fetchManifestAssetNames(assets) {
  const names = new Set();

  for (const feed of ["unstable.json", "early-access.json", "latest.json"]) {
    const asset = assets.find((a) => a.name === feed);
    if (!asset) continue;

    try {
      const response = await fetch(
        `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`,
        {
          headers: {
            Accept: "application/octet-stream",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!response.ok) continue;

      const manifest = await response.json();
      const platforms = manifest.platforms ?? {};
      for (const entry of Object.values(platforms)) {
        const url = entry?.url;
        if (!url) continue;
        const name = decodeURIComponent(url.split("/").pop() || "");
        if (!name) continue;
        names.add(name);
        names.add(`${name}.sig`);
      }
    } catch {
      // best-effort; fall back to version-only keep if the feed can't be read.
    }
  }

  return names;
}

async function githubRequest(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(options.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API request failed (${response.status}): ${text || response.statusText}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

const release = await githubRequest(
  `https://api.github.com/repos/${repository}/releases/tags/${tag}`,
);
const manifestAssetNames = await fetchManifestAssetNames(release.assets ?? []);

for (const asset of release.assets ?? []) {
  if (ALWAYS_KEEP.has(asset.name)) continue;
  if (keepVersion && asset.name.includes(keepVersion)) continue;
  if (manifestAssetNames.has(asset.name)) continue;

  await githubRequest(
    `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`,
    { method: "DELETE" },
  );
  console.log(`Deleted stale release asset ${asset.name}`);
}
