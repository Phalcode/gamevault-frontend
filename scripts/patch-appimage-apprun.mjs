#!/usr/bin/env node
/**
 * Patch the Linux AppImage so it preloads the host's libwayland-client on
 * Wayland.
 *
 * Root cause of "Could not create default EGL display: EGL_BAD_PARAMETER":
 * the AppImage bundles an incompatible `libwayland-client.so` from the build
 * machine, which mismatches the host compositor. Preloading the host library
 * (the well-known `LD_PRELOAD=/usr/lib64/libwayland-client.so.0` workaround)
 * fixes it.
 *
 * How it works:
 *   1. Extract the Tauri-built AppImage (`--appimage-extract`).
 *   2. Rename the generated `AppRun` to `AppRun.real` and install a wrapper
 *      `AppRun` that sets `LD_PRELOAD` to the host libwayland (when running
 *      under Wayland) and then execs the real AppRun.
 *   3. Repack with `appimagetool`.
 *   4. Re-sign the modified AppImage with `tauri signer sign` so the updater
 *      signature still validates (the original `.sig` no longer matches).
 *
 * Skips cleanly when no AppImage is present (e.g. Windows/macOS runners).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  chmod,
  mkdtemp,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const exec = promisify(execFile);

const APPRUN_WRAPPER = `#!/usr/bin/env bash
# GameVault Wayland launcher.
#
# The AppImage bundles its own libwayland-client, which can mismatch the host
# compositor and cause:
#   Could not create default EGL display: EGL_BAD_PARAMETER
# Preload the host's libwayland-client (if present) before starting the real
# AppRun, which is kept under AppRun.real so its environment setup (APPDIR,
# LD_LIBRARY_PATH, etc.) is preserved.
if [ -n "$WAYLAND_DISPLAY" ]; then
  for lib in \\
    /usr/lib64/libwayland-client.so.0 \\
    /usr/lib64/libwayland-client.so \\
    /usr/lib/x86_64-linux-gnu/libwayland-client.so.0 \\
    /usr/lib/x86_64-linux-gnu/libwayland-client.so \\
    /usr/lib/aarch64-linux-gnu/libwayland-client.so.0 \\
    /usr/lib/aarch64-linux-gnu/libwayland-client.so \\
    /usr/lib/arm-linux-gnueabihf/libwayland-client.so.0 \\
    /usr/lib/arm-linux-gnueabihf/libwayland-client.so \\
    /usr/lib/libwayland-client.so.0 \\
    /usr/lib/libwayland-client.so; do
    if [ -e "$lib" ]; then
      export LD_PRELOAD="$lib\${LD_PRELOAD:+:\$LD_PRELOAD}"
      break
    fi
  done
fi

if [ -x "$APPDIR/AppRun.real" ]; then
  exec "$APPDIR/AppRun.real" "$@"
elif [ -x "$(dirname "$0")/AppRun.real" ]; then
  exec "$(dirname "$0")/AppRun.real" "$@"
else
  echo "GameVault: AppRun.real not found" >&2
  exit 1
fi
`;

function log(message) {
  console.log(`[appimage-patch] ${message}`);
}

async function resolveAppImage(bundleRoot) {
  let entries;
  try {
    entries = await readdir(bundleRoot);
  } catch {
    return null;
  }
  const matches = entries.filter(
    (name) => name.endsWith(".AppImage") && !name.endsWith(".AppImage.sig"),
  );
  if (matches.length === 0) return null;
  if (matches.length > 1) {
    throw new Error(
      `Multiple AppImages found in ${bundleRoot}: ${matches.join(", ")}`,
    );
  }
  return path.join(bundleRoot, matches[0]);
}

async function downloadAppimageTool(destDir) {
  const dest = path.join(destDir, "appimagetool");
  const url = "https://github.com/AppImage/appimagetool/releases/download/continuous/appimagetool-x86_64.AppImage";
  log(`Downloading appimagetool from ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download appimagetool: ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, buffer);
  await chmod(dest, 0o755);
  return dest;
}

async function repack(squashFs, outputPath, workDir) {
  const tool = await downloadAppimageTool(workDir);
  log("Repacking AppImage with patched AppRun...");
  await exec(tool, [squashFs, outputPath], {
    env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
  });
}

async function resign(appImagePath) {
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY;
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD;
  if (!privateKey) {
    throw new Error(
      "Repacked the AppImage but TAURI_SIGNING_PRIVATE_KEY is not set; " +
        "cannot re-sign. Refusing to keep an unsigned AppImage.",
    );
  }
  // Remove the stale signature so `tauri signer sign` writes a fresh one.
  const sigPath = `${appImagePath}.sig`;
  await rm(sigPath, { force: true });

  const tauriBin = path.join(process.cwd(), "node_modules", ".bin", "tauri");
  log("Re-signing patched AppImage...");
  const args = ["signer", "sign", "-k", privateKey];
  if (password) {
    args.push("-p", password);
  }
  args.push(appImagePath);
  await exec(tauriBin, args, { env: process.env });
}

async function main() {
  const bundleRoot = path.join(
    process.cwd(),
    "src-tauri",
    "target",
    "release",
    "bundle",
    "appimage",
  );
  const appImagePath = await resolveAppImage(bundleRoot);

  if (!appImagePath) {
    log("No AppImage found; skipping.");
    return;
  }

  log(`Patching ${path.basename(appImagePath)}`);

  const workDir = await mkdtemp(path.join(tmpdir(), "gamevault-appimage-"));
  try {
    // 1. Extract the AppImage into a squashfs-root directory.
    log("Extracting AppImage...");
    await exec(appImagePath, ["--appimage-extract"], { cwd: workDir });

    const squashFs = path.join(workDir, "squashfs-root");
    const appRun = path.join(squashFs, "AppRun");
    const appRunReal = path.join(squashFs, "AppRun.real");

    // 2. Preserve the generated AppRun and install our wayland wrapper.
    await rename(appRun, appRunReal);
    await writeFile(appRun, APPRUN_WRAPPER);
    await chmod(appRun, 0o755);

    // 3. Repack into a new AppImage, then replace the original.
    const output = path.join(workDir, "patched.AppImage");
    await repack(squashFs, output, workDir);
    await rename(output, appImagePath);

    // 4. Re-sign so the updater signature still matches.
    await resign(appImagePath);

    log("Done.");
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`[appimage-patch] Failed: ${error.message}`);
  process.exit(1);
});
