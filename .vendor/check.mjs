#!/usr/bin/env node
// Fails when a vendored file differs from what its source repository exported (decision 0015).
// Vendored by servo-map/.github vendor/sync.mjs; run from the repository root: node .vendor/check.mjs
//
// Each `.vendor/<source>.json` lock lists the files a source repository owns here, with their
// SHA-256 at the source commit it names. Fix a failure in the source and let its sync pull request
// bring the change; never edit the vendored copy.
//
// This file is vendored too. Every sync overwrites it and records its hash under `tooling` in the
// lock it writes, so the check passes for itself when at least one lock names the copy on disk:
// two sources may pin different tooling commits, and only the latest sync's lock then matches. A
// lock written before `tooling` existed records nothing; with none recorded the self-check is skipped.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SELF = ".vendor/check.mjs";
const self = fileURLToPath(import.meta.url);
const vendorDir = dirname(self);
const root = dirname(vendorDir);
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const problems = [];
const recordedSelf = [];
let checked = 0;

for (const name of readdirSync(vendorDir).filter((n) => n.endsWith(".json"))) {
  const lock = JSON.parse(readFileSync(join(vendorDir, name), "utf8"));
  const from = `${lock.source}@${lock.commit.slice(0, 7)}`;
  for (const [path, want] of Object.entries(lock.files)) {
    const abs = join(root, path);
    checked += 1;
    if (!existsSync(abs)) {
      problems.push(`missing: ${path} (from ${from})`);
    } else if (sha256(abs) !== want) {
      problems.push(`edited: ${path} differs from ${from}`);
    }
  }
  if (lock.tooling?.[SELF]) recordedSelf.push(lock.tooling[SELF]);
}

if (recordedSelf.length > 0) {
  checked += 1;
  if (!recordedSelf.includes(sha256(self))) {
    problems.push(`edited: ${SELF} matches no lock; it is owned by servo-map/.github vendor/check.mjs`);
  }
}

if (problems.length > 0) {
  console.error(`Vendored files differ from their source; change them there instead:\n  ${problems.join("\n  ")}`);
  process.exit(1);
}
console.log(`vendor check: ${checked} files match their source`);
