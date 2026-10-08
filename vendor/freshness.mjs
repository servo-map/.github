#!/usr/bin/env node
// Fails when a target repository's lock no longer records what its source exports today.
//
//   node freshness.mjs --source-root <dir> --source <name> --commit <sha> --target <name> --lock <file>
//
// check.mjs proves a target's vendored files match the commit its lock names; it cannot see that the
// source has moved on since, for example while the sync pull request waits unmerged. This compares
// the files and SHA-256 hashes the source at `--commit` exports to `--target` (exports.mjs, the same
// reading sync.mjs copies from) with the `files` of the target's `.vendor/<source>.json` on its
// default branch, given as `--lock`. A lock that does not exist means the target never merged a sync.
//
// Only content counts: a lock naming an older commit with identical files is fresh, so a source
// commit that leaves its exports alone does not make every target stale.

import { existsSync, readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { exportedFiles, sha256 } from "./exports.mjs";

const { values: args } = parseArgs({
  options: {
    "source-root": { type: "string" },
    source: { type: "string" },
    commit: { type: "string" },
    target: { type: "string" },
    lock: { type: "string" },
  },
});
for (const key of ["source-root", "source", "commit", "target", "lock"]) {
  if (!args[key]) throw new Error(`missing --${key}`);
}

const want = new Map([...exportedFiles(args["source-root"], args.target)].map(([dest, source]) => [dest, sha256(source)]));
const exportsAt = `${args.source}@${args.commit.slice(0, 7)}`;
const lockName = `.vendor/${args.source}.json`;

if (!existsSync(args.lock)) {
  console.error(`stale: ${args.target} has no ${lockName}; it has never merged the files ${exportsAt} exports to it (${want.size}).`);
  process.exit(1);
}

const lock = JSON.parse(readFileSync(args.lock, "utf8"));
const have = new Map(Object.entries(lock.files ?? {}));
const byPath = (a, b) => a.localeCompare(b);
const differences = [
  ...[...want.keys()].filter((path) => have.has(path) && have.get(path) !== want.get(path)).sort(byPath).map((path) => `changed: ${path}`),
  ...[...want.keys()].filter((path) => !have.has(path)).sort(byPath).map((path) => `added: ${path}`),
  ...[...have.keys()].filter((path) => !want.has(path)).sort(byPath).map((path) => `removed: ${path}`),
];
const lockAt = `${lockName} at ${String(lock.commit).slice(0, 7)}`;

if (differences.length > 0) {
  console.error(
    `stale: ${args.target}'s ${lockAt} differs from what ${exportsAt} exports to it; merge the vendor sync pull request:\n  ${differences.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`fresh: ${args.target}'s ${lockAt} records every file ${exportsAt} exports to it (${want.size})`);
