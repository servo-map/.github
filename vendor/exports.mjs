// What a source repository exports to one target, read from its vendor.json (decision 0015). One
// owner for that answer: sync.mjs copies these files, freshness.mjs compares them with the target's
// lock, so the two cannot disagree about which files a target should hold.
//
// Not vendored: check.mjs is the only file a target receives, and it reads locks, not vendor.json.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/** SHA-256 of a file's bytes, as a lock records it. */
export const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Every file under `path`, as paths relative to `path` ("" when `path` is itself a file). */
function walk(path) {
  if (!existsSync(path)) throw new Error(`vendor.json exports a missing path: ${path}`);
  if (statSync(path).isFile()) return [""];
  return readdirSync(path, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name !== ".DS_Store")
    .map((entry) => relative(path, join(entry.parentPath, entry.name)));
}

/**
 * The files `target` receives from the source checked out at `sourceRoot`: a Map from the path in
 * the target to the absolute path of the source file. Throws when vendor.json does not name the
 * target or exports a path that does not exist.
 */
export function exportedFiles(sourceRoot, target) {
  const config = JSON.parse(readFileSync(join(sourceRoot, "vendor.json"), "utf8"));
  const mappings = config.targets?.[target];
  if (!Array.isArray(mappings)) throw new Error(`vendor.json has no target ${target}`);
  const files = new Map();
  for (const { from, to } of mappings) {
    const source = join(sourceRoot, from);
    for (const rel of walk(source)) {
      files.set(rel === "" ? to : join(to, rel), rel === "" ? source : join(source, rel));
    }
  }
  return files;
}
