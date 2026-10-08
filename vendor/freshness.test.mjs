// Runs freshness.mjs as the vendor-freshness workflow does: as a process, against a lock that
// sync.mjs wrote into a real target directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SYNCED = "0123456789abcdef0123456789abcdef01234567";
const NOW = "fedcba9876543210fedcba9876543210fedcba98";

/** Writes `files` (path → content) under a fresh temporary directory and returns it. */
function tree(t, files) {
  const root = mkdtempSync(join(tmpdir(), "freshness-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const run = (script, args) => spawnSync(process.execPath, [join(here, script), ...args], { encoding: "utf8" });

/** A brand-like source exporting a file and a directory to servo-map-inbox, synced at SYNCED. */
function synced(t) {
  const source = tree(t, {
    "vendor.json": JSON.stringify({
      targets: {
        "servo-map-inbox": [
          { from: "generated/tokens.css", to: "app/brand/tokens.css" },
          { from: "exports/inbox", to: "." },
        ],
        "servo-map-web": [{ from: "exports/web", to: "." }],
      },
    }),
    "generated/tokens.css": ":root{}",
    "exports/inbox/public/brand/mark.svg": "<svg/>",
    "exports/inbox/public/brand/.DS_Store": "finder",
    "exports/web/public/a.png": "a",
  });
  const target = tree(t, {});
  const result = run("sync.mjs", ["--source-root", source, "--source", "servo-map-brand", "--commit", SYNCED, "--target", "servo-map-inbox", "--target-root", target]);
  assert.equal(result.status, 0, result.stderr);
  return { source, lock: join(target, ".vendor/servo-map-brand.json") };
}

const freshness = (source, lock, target = "servo-map-inbox") =>
  run("freshness.mjs", ["--source-root", source, "--source", "servo-map-brand", "--commit", NOW, "--target", target, "--lock", lock]);

test("passes when the lock records every file the source exports now, whatever commit it names", (t) => {
  const { source, lock } = synced(t);
  // Another export changed: the source moved on, but not in a way this target receives.
  writeFileSync(join(source, "exports/web/public/a.png"), "a, changed");
  const result = freshness(source, lock);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^fresh: servo-map-inbox's \.vendor\/servo-map-brand\.json at 0123456 records every file servo-map-brand@fedcba9 exports to it \(2\)$/m);
});

test("fails naming each changed, added and removed file", (t) => {
  const { source, lock } = synced(t);
  writeFileSync(join(source, "generated/tokens.css"), ":root{--bar:6px}");
  writeFileSync(join(source, "exports/inbox/public/brand/wordmark.svg"), "<svg/>");
  rmSync(join(source, "exports/inbox/public/brand/mark.svg"));
  const result = freshness(source, lock);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^stale: servo-map-inbox's \.vendor\/servo-map-brand\.json at 0123456 differs from what servo-map-brand@fedcba9 exports to it; merge the vendor sync pull request:$/m);
  assert.match(result.stderr, /\n {2}changed: app\/brand\/tokens\.css\n {2}added: public\/brand\/wordmark\.svg\n {2}removed: public\/brand\/mark\.svg$/m);
});

test("fails for a target that has never merged a sync", (t) => {
  const { source } = synced(t);
  const result = freshness(source, join(source, "no-such-lock.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^stale: servo-map-inbox has no \.vendor\/servo-map-brand\.json; it has never merged the files servo-map-brand@fedcba9 exports to it \(2\)\.$/m);
});

test("fails when a hash in the lock differs, though the paths agree", (t) => {
  const { source, lock } = synced(t);
  const edited = JSON.parse(readFileSync(lock, "utf8"));
  edited.files["public/brand/mark.svg"] = "0".repeat(64);
  writeFileSync(lock, JSON.stringify(edited));
  const result = freshness(source, lock);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\n {2}changed: public\/brand\/mark\.svg$/m);
});

test("fails for a target the source's vendor.json does not name", (t) => {
  const { source, lock } = synced(t);
  const result = freshness(source, lock, "servo-map-ios");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /vendor\.json has no target servo-map-ios/);
});
