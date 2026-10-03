// Runs trigger-paths.mjs as the vendor-sync workflow's plan job does: as a process, on a checkout.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const WORKFLOW = ".github/workflows/vendor-sync.yml";

/** A workflow file whose `on:` block is `on` (already indented two spaces). */
const workflow = (on) => `# Sends the exports.\nname: Vendor sync\n\non:\n${on}\n\njobs:\n  sync:\n    uses: x/y/z.yml@abc\n`;
const pushPaths = (...paths) => workflow(`  push:\n    branches: [main]\n    paths:\n${paths.map((p) => `      - ${p}`).join("\n")}\n  workflow_dispatch:`);

/**
 * A source repository exporting a directory, a nested directory and two files, with `caller` as its
 * vendor-sync workflow; returns the result of the check on it.
 */
function run(t, caller, files = {}) {
  const root = mkdtempSync(join(tmpdir(), "trigger-paths-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const tree = {
    "vendor.json": JSON.stringify({
      targets: {
        "servo-map-web": [{ from: "exports/web", to: "." }],
        "servo-map-ios": [
          { from: "generated/swift/Tokens.swift", to: "Vendor/Tokens.swift" },
          { from: "app-icon/ServoMap.icon", to: "Vendor/ServoMap.icon" },
        ],
        "servo-map-inbox": [{ from: "generated/tokens.css", to: "app/tokens.css" }],
      },
    }),
    "exports/web/public/a.png": "a",
    "generated/swift/Tokens.swift": "enum Tokens {}",
    "generated/tokens.css": ":root{}",
    "app-icon/ServoMap.icon/icon.json": "{}",
    [WORKFLOW]: caller,
    ...files,
  };
  for (const [path, content] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return spawnSync(process.execPath, [join(here, "trigger-paths.mjs"), "--source-root", root, "--workflow", WORKFLOW], { encoding: "utf8" });
}

test("passes when every exported file and directory is covered", (t) => {
  const result = run(t, pushPaths("exports/**", "app-icon/ServoMap.icon/**", "generated/swift/**", "generated/tokens.css", "vendor.json"));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /trigger paths: 4 exported paths start \.github\/workflows\/vendor-sync\.yml/);
});

test("reads quoted patterns, trailing comments and a flow list", (t) => {
  const quoted = run(t, pushPaths(`"exports/**" # the web files`, "'app-icon/**'", "generated/**"));
  assert.equal(quoted.status, 0, quoted.stderr);
  const flow = run(t, workflow(`  push:\n    paths: ["exports/**", 'app-icon/**', generated/**]`));
  assert.equal(flow.status, 0, flow.stderr);
});

test("fails naming each export the filter misses", (t) => {
  const result = run(t, pushPaths("exports/**", "generated/swift/**", "vendor.json"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /is not started by every path vendor\.json exports/);
  assert.match(result.stderr, /\n {2}app-icon\/ServoMap\.icon\n {2}generated\/tokens\.css$/m);
  assert.doesNotMatch(result.stderr, /exports\/web/);
});

test("fails for a directory covered one level deep only, or by extension", (t) => {
  for (const pattern of ["exports/web/*", "exports/web/**/*.png", "exports/web"]) {
    const result = run(t, pushPaths(pattern, "app-icon/**", "generated/**"));
    assert.equal(result.status, 1, pattern);
    assert.match(result.stderr, /\n {2}exports\/web$/m);
  }
});

test("fails for an export a later negated pattern excludes", (t) => {
  const result = run(t, pushPaths("**", "'!generated/*.css'"));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /\n {2}generated\/tokens\.css$/m);
  assert.doesNotMatch(result.stderr, /Tokens\.swift/);
});

test("treats pattern characters as GitHub's filter does", (t) => {
  // `.` is literal, `*` stops at a slash, `[...]` is a character range, `**/` may match nothing.
  const literalDot = run(t, pushPaths("exports/**", "app-icon/**", "generated/swift/**", "generated/tokensXcss"));
  assert.equal(literalDot.status, 1);
  const star = run(t, pushPaths("exports/**", "app-icon/**", "generated/*"));
  assert.equal(star.status, 1);
  assert.match(star.stderr, /generated\/swift\/Tokens\.swift/);
  const range = run(t, pushPaths("exports/**", "app-icon/**", "generated/swift/**", "generated/[a-z]okens.css"));
  assert.equal(range.status, 0, range.stderr);
  const anywhere = run(t, pushPaths("**/web/**", "**/ServoMap.icon/**", "**/Tokens.swift", "**/tokens.css"));
  assert.equal(anywhere.status, 0, anywhere.stderr);
});

test("passes a workflow that does not filter pushes by path", (t) => {
  for (const on of ["  workflow_dispatch:", "  push:\n    branches: [main]\n  workflow_dispatch:", "  push:\n  workflow_dispatch:"]) {
    const result = run(t, workflow(on));
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /does not filter pushes by path/);
  }
});

test("reads the push filter, not another event's or paths-ignore", (t) => {
  const on = "  pull_request:\n    paths:\n      - '**'\n  push:\n    paths-ignore:\n      - docs/**\n    paths:\n      - exports/**";
  const result = run(t, workflow(on));
  assert.equal(result.status, 1);
  assert.match(result.stderr, /app-icon\/ServoMap\.icon/);
});

test("fails for an export that does not exist", (t) => {
  const result = run(t, pushPaths("**"), { "vendor.json": JSON.stringify({ targets: { "servo-map-web": [{ from: "gone", to: "gone" }] } }) });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /exports a missing path: gone/);
});
