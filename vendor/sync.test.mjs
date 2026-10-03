// Runs sync.mjs and the check.mjs it installs as the workflow does: as processes, on real directories.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");

/** Writes `files` (path → content) under a fresh temporary directory and returns it. */
function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), "vendor-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

function sync(sourceRoot, targetRoot, { source = "servo-map-core", target = "servo-map-web" } = {}) {
  return spawnSync(
    process.execPath,
    [join(here, "sync.mjs"), "--source-root", sourceRoot, "--source", source, "--commit", COMMIT, "--target", target, "--target-root", targetRoot],
    { encoding: "utf8" },
  );
}

const check = (targetRoot) => spawnSync(process.execPath, [join(targetRoot, ".vendor/check.mjs")], { encoding: "utf8" });
const readLock = (targetRoot, source = "servo-map-core") => JSON.parse(readFileSync(join(targetRoot, `.vendor/${source}.json`), "utf8"));
const vendorJson = (targets) => JSON.stringify({ targets });

/** A source exporting one file and one directory to servo-map-web, synced into an empty target. */
function synced(t) {
  const source = tree(t, {
    "vendor.json": vendorJson({
      "servo-map-web": [
        { from: "generated/tokens.css", to: "src/brand/tokens.css" },
        { from: "exports/web", to: "." },
      ],
    }),
    "generated/tokens.css": ":root{}",
    "exports/web/public/z.png": "z",
    "exports/web/public/logos/a.png": "a",
    "exports/web/.DS_Store": "finder",
  });
  const target = tree(t, { "README.md": "target" });
  const result = sync(source, target);
  assert.equal(result.status, 0, result.stderr);
  return { source, target };
}

test("copies a file mapping to its named path and a directory mapping file by file", (t) => {
  const { target } = synced(t);
  assert.equal(readFileSync(join(target, "src/brand/tokens.css"), "utf8"), ":root{}");
  assert.equal(readFileSync(join(target, "public/z.png"), "utf8"), "z");
  assert.equal(readFileSync(join(target, "public/logos/a.png"), "utf8"), "a");
  assert.equal(existsSync(join(target, ".DS_Store")), false);
  assert.equal(readFileSync(join(target, "README.md"), "utf8"), "target");
});

test("writes a lock naming the source, the commit and every file's hash, sorted by path", (t) => {
  const { target } = synced(t);
  const lock = readLock(target);
  assert.equal(lock.source, "servo-map/servo-map-core");
  assert.equal(lock.commit, COMMIT);
  assert.deepEqual(Object.keys(lock.files), ["public/logos/a.png", "public/z.png", "src/brand/tokens.css"]);
  for (const [path, hash] of Object.entries(lock.files)) assert.equal(hash, sha256(join(target, path)));
});

test("installs check.mjs and records its hash apart from the exported files", (t) => {
  const { target } = synced(t);
  const lock = readLock(target);
  assert.equal(readFileSync(join(target, ".vendor/check.mjs"), "utf8"), readFileSync(join(here, "check.mjs"), "utf8"));
  assert.deepEqual(lock.tooling, { ".vendor/check.mjs": sha256(join(here, "check.mjs")) });
  assert.equal(".vendor/check.mjs" in lock.files, false);
});

test("removes a file the source no longer exports and leaves the target's own files", (t) => {
  const { source, target } = synced(t);
  rmSync(join(source, "exports/web/public/z.png"));
  assert.equal(sync(source, target).status, 0);
  assert.equal(existsSync(join(target, "public/z.png")), false);
  assert.equal(existsSync(join(target, "public/logos/a.png")), true);
  assert.equal(existsSync(join(target, "README.md")), true);
  assert.deepEqual(Object.keys(readLock(target).files), ["public/logos/a.png", "src/brand/tokens.css"]);
});

test("keeps one lock per source in the same target", (t) => {
  const { target } = synced(t);
  const brand = tree(t, { "vendor.json": vendorJson({ "servo-map-web": [{ from: "icon.svg", to: "src/app/icon.svg" }] }), "icon.svg": "<svg/>" });
  assert.equal(sync(brand, target, { source: "servo-map-brand" }).status, 0);
  assert.deepEqual(Object.keys(readLock(target, "servo-map-brand").files), ["src/app/icon.svg"]);
  assert.equal(Object.keys(readLock(target).files).length, 3);
  assert.equal(existsSync(join(target, "public/z.png")), true);
  assert.equal(check(target).status, 0);
});

test("fails for a target vendor.json does not name, and for an export that does not exist", (t) => {
  const source = tree(t, { "vendor.json": vendorJson({ "servo-map-web": [{ from: "gone.txt", to: "gone.txt" }] }) });
  const target = tree(t, {});
  const unknown = sync(source, target, { target: "servo-map-ios" });
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /vendor\.json has no target servo-map-ios/);
  const missing = sync(source, target);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /exports a missing path/);
});

test("check.mjs passes on a fresh sync and counts itself", (t) => {
  const { target } = synced(t);
  const result = check(target);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vendor check: 4 files match their source/);
});

test("check.mjs fails on an edited vendored file", (t) => {
  const { target } = synced(t);
  writeFileSync(join(target, "public/z.png"), "edited by hand");
  const result = check(target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edited: public\/z\.png differs from servo-map\/servo-map-core@0123456/);
});

test("check.mjs fails on a missing vendored file", (t) => {
  const { target } = synced(t);
  rmSync(join(target, "src/brand/tokens.css"));
  const result = check(target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /missing: src\/brand\/tokens\.css/);
});

test("check.mjs fails when it was edited itself", (t) => {
  const { target } = synced(t);
  const path = join(target, ".vendor/check.mjs");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// a hand edit\n`);
  const result = check(target);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /edited: \.vendor\/check\.mjs matches no lock/);
});

test("check.mjs accepts itself when one lock of several records it", (t) => {
  // Another source synced earlier with different tooling: its lock names a check.mjs since replaced.
  const { target } = synced(t);
  const stale = { source: "servo-map/servo-map-brand", commit: COMMIT, files: {}, tooling: { ".vendor/check.mjs": "0".repeat(64) } };
  writeFileSync(join(target, ".vendor/servo-map-brand.json"), JSON.stringify(stale));
  assert.equal(check(target).status, 0);
});

test("check.mjs still passes a lock written before the tooling key existed", (t) => {
  const { target } = synced(t);
  const lock = readLock(target);
  delete lock.tooling;
  writeFileSync(join(target, ".vendor/servo-map-core.json"), JSON.stringify(lock));
  const path = join(target, ".vendor/check.mjs");
  writeFileSync(path, `${readFileSync(path, "utf8")}\n// unrecorded, so not checked\n`);
  const result = check(target);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /vendor check: 3 files match their source/);
});
