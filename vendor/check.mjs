#!/usr/bin/env node
// Fails when a vendored file differs from what its source repository exported (decision 0015).
// Vendored by servo-map/.github vendor/sync.mjs; run from the repository root: node .vendor/check.mjs
//
// Each `.vendor/<source>.json` lock lists the files a source repository owns here, with their
// SHA-256 at the source commit it names. Fix a failure in the source and let its sync pull request
// bring the change; never edit the vendored copy.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const vendorDir = dirname(fileURLToPath(import.meta.url));
const root = dirname(vendorDir);
const problems = [];
let checked = 0;

for (const name of readdirSync(vendorDir).filter((n) => n.endsWith(".json"))) {
  const lock = JSON.parse(readFileSync(join(vendorDir, name), "utf8"));
  for (const [path, want] of Object.entries(lock.files)) {
    const abs = join(root, path);
    checked += 1;
    if (!existsSync(abs)) {
      problems.push(`missing: ${path} (from ${lock.source}@${lock.commit.slice(0, 7)})`);
    } else if (createHash("sha256").update(readFileSync(abs)).digest("hex") !== want) {
      problems.push(`edited: ${path} differs from ${lock.source}@${lock.commit.slice(0, 7)}`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Vendored files differ from their source; change them there instead:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`vendor check: ${checked} files match their source`);
