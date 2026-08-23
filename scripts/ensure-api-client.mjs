import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_SPEC_URL = "https://gamevault.alfagun74.de/api/docs-yaml";
const API_DIR = path.resolve("src/api");
const MARKER = path.join(API_DIR, ".api-spec-hash");

const specUrl = process.env.GV_API_SPEC_URL?.trim() || DEFAULT_SPEC_URL;

async function readSpec() {
  const localPath = process.env.GV_API_SPEC_PATH?.trim();

  if (localPath && existsSync(localPath)) {
    return readFile(localPath, "utf8");
  }

  const response = await fetch(specUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch API spec (${response.status}).`);
  }

  return response.text();
}

function hashContent(content) {
  return createHash("sha256").update(content).digest("hex");
}

async function generateApiClient() {
  console.log("API client changed, regenerating...");
  await rm(API_DIR, { recursive: true, force: true });
  await mkdir(API_DIR, { recursive: true });

  const cliJs = path.resolve(
    "node_modules",
    "@openapitools",
    "openapi-generator-cli",
    "main.js",
  );

  const args = [
    "generate",
    "-g",
    "typescript-fetch",
    "-i",
    specUrl,
    "-o",
    API_DIR,
    "--global-property",
    "models,supportingFiles",
    "-p",
    "enumPropertyNaming=snake_case",
    "-p",
    "modelPropertyNaming=snake_case",
  ];

  const result = spawnSync(process.execPath, [cliJs, ...args], {
    stdio: "inherit",
  });

  return result.status === 0;
}

async function main() {
  const spec = await readSpec();
  const hash = hashContent(spec);

  // Close undici's connection pool once we're done fetching. Without this the
  // keep-alive socket keeps the event loop alive for ~4s (keepAliveTimeout)
  // before the process can exit naturally.
  const dispatcher = globalThis[Symbol.for("undici.globalDispatcher.1")];
  if (dispatcher?.close) {
    await dispatcher.close();
  }

  const markerExists = existsSync(MARKER);
  const markerMatches =
    markerExists && (await readFile(MARKER, "utf8")).trim() === hash;
  const apiExists = existsSync(path.join(API_DIR, "runtime.ts"));

  if (markerMatches && apiExists) {
    console.log("API client is up to date, skipping generation.");
    return;
  }

  const generated = await generateApiClient();
  if (!generated) {
    process.exitCode = 1;
    return;
  }

  await writeFile(MARKER, `${hash}\n`, "utf8");
  console.log("API client generated.");
}

// NOTE: do not use process.exit() here. On Windows, exiting while libuv still
// has a pending worker-thread async completion (e.g. the threadpool DNS lookup
// triggered by fetch) aborts the process with:
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c, line 94
// (exit code 3221226505). Letting the process end naturally drains the loop
// first and avoids the crash.
await main();
