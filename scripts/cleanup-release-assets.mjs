import process from "node:process";

const [repository, tag, ...allowedAssets] = process.argv.slice(2);

if (!repository || !tag || allowedAssets.length === 0) {
  console.error(
    "Usage: node scripts/cleanup-release-assets.mjs <repository> <tag> <allowedAsset>...",
  );
  process.exit(1);
}

const token = process.env.GITHUB_TOKEN?.trim();

if (!token) {
  throw new Error("GITHUB_TOKEN is required to clean up release assets.");
}

const allowed = new Set(allowedAssets);

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

for (const asset of release.assets ?? []) {
  if (allowed.has(asset.name)) {
    continue;
  }

  await githubRequest(
    `https://api.github.com/repos/${repository}/releases/assets/${asset.id}`,
    { method: "DELETE" },
  );
  console.log(`Deleted stale release asset ${asset.name}`);
}
