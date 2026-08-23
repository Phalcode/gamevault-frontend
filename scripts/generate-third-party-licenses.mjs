#!/usr/bin/env node
/**
 * Generates src/generated/third-party-licenses.json from the installed
 * production dependencies using license-checker-rseidelsohn.
 *
 * The output contains one entry per production package with its license
 * type, repository and the full license text, so it can be shown in the
 * in-app "Open Source Licenses" view (Settings → About).
 *
 * Usage:
 *   pnpm licenses            (requires `pnpm install` to have run)
 *
 * Regenerate and commit the output whenever dependencies change
 * (CI can run this on lockfile changes).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const checker = require("license-checker-rseidelsohn");

checker.init({ start: process.cwd(), production: true }, (err, json) => {
  if (err) {
    console.error("license-checker failed:", err.message ?? err);
    process.exit(1);
  }

  const packages = Object.entries(json)
    .map(([id, info]) => {
      // "name@version", where name may be scoped ("@scope/name")
      const at = id.lastIndexOf("@");
      const name = at > 0 ? id.slice(0, at) : id;
      const version = at > 0 ? id.slice(at + 1) : "";

      let licenseText = "";
      if (info.licenseFile) {
        try {
          licenseText = readFileSync(info.licenseFile, "utf8");
        } catch {
          // Some packages ship without a license file; keep the text empty.
        }
      }

      return {
        name,
        version,
        licenses: Array.isArray(info.licenses)
          ? info.licenses.join(", ")
          : (info.licenses ?? "Unknown"),
        repository: info.repository ?? null,
        url: info.url ?? null,
        licenseText,
      };
    })
    .sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    );

  const outDir = join(process.cwd(), "src/generated");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, "third-party-licenses.json"),
    JSON.stringify(
      { generatedAt: new Date().toISOString(), packages },
      null,
      2,
    ),
  );

  console.log(
    `Wrote ${packages.length} packages to src/generated/third-party-licenses.json`,
  );
});
