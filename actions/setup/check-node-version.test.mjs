// Runs check-node-version.mjs as the setup action does: as a process, from a repository root.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "check-node-version.mjs");
const pkg = (typesNode, extra = {}) => JSON.stringify({ devDependencies: typesNode ? { "@types/node": typesNode } : {}, ...extra });
const rootPkg = (typesNode = "^26.6.3") => pkg(typesNode, { engines: { node: "26.x" } });

/** Runs the check in a temporary repository holding `files` (path → content) plus `.node-version` 26. */
function run(t, files) {
  const root = mkdtempSync(join(tmpdir(), "node-version-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [path, content] of Object.entries({ ".node-version": "26\n", ...files })) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return spawnSync(process.execPath, [script], { cwd: root, encoding: "utf8" });
}

// servo-map-core's layout: a glob, two literal directories, then other top-level keys.
const WORKSPACE = `packages:
  - "packages/*"
  - "scripts"
  - catalogue   # unquoted

allowBuilds:
  - esbuild
`;

test("passes when engines and every workspace package agree with .node-version", (t) => {
  const result = run(t, {
    "package.json": rootPkg(),
    "pnpm-workspace.yaml": WORKSPACE,
    "packages/shared/package.json": pkg("^26.0.0"),
    "scripts/package.json": pkg("~26.1.0"),
    "catalogue/package.json": pkg(null),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(package\.json, catalogue\/package\.json, packages\/shared\/package\.json, scripts\/package\.json\)/);
});

test("fails for a workspace package outside packages/", (t) => {
  const result = run(t, {
    "package.json": rootPkg(),
    "pnpm-workspace.yaml": WORKSPACE,
    "packages/shared/package.json": pkg("^26.0.0"),
    "scripts/package.json": pkg("^24.0.0"),
    "catalogue/package.json": pkg("^25.1.0"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /scripts\/package\.json @types\/node is "\^24\.0\.0", expected \^26/);
  assert.match(result.stderr, /catalogue\/package\.json @types\/node is "\^25\.1\.0", expected \^26/);
});

test("fails for a package matched by a glob and for the root's engines", (t) => {
  const result = run(t, {
    "package.json": pkg("^26.0.0", { engines: { node: "24.x" } }),
    "pnpm-workspace.yaml": WORKSPACE,
    "packages/worker/package.json": pkg("^24.0.0"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /package\.json engines\.node is "24\.x", expected "26\.x"/);
  assert.match(result.stderr, /packages\/worker\/package\.json @types\/node is "\^24\.0\.0"/);
});

test("checks only the root when there is no pnpm-workspace.yaml", (t) => {
  const result = run(t, { "package.json": rootPkg(), "packages/stray/package.json": pkg("^24.0.0") });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(package\.json\)/);
});

test("checks only the root when pnpm-workspace.yaml lists no packages", (t) => {
  const result = run(t, {
    "package.json": rootPkg(),
    "pnpm-workspace.yaml": "pmOnFail: ignore\nminimumReleaseAgeExclude:\n  - \"scripts\"\n",
    "scripts/package.json": pkg("^24.0.0"),
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\(package\.json\)/);
});

test("reads a one-line list, ** globs and ! exclusions", (t) => {
  const result = run(t, {
    "package.json": rootPkg(),
    "pnpm-workspace.yaml": "packages: ['apps/**', \"!apps/legacy\"]\n",
    "apps/site/package.json": pkg("^26.0.0"),
    "apps/tools/cli/package.json": pkg("^24.0.0"),
    "apps/legacy/package.json": pkg("^20.0.0"),
    "apps/site/node_modules/dep/package.json": pkg("^18.0.0"),
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /apps\/tools\/cli\/package\.json @types\/node is "\^24\.0\.0"/);
  assert.doesNotMatch(result.stderr, /legacy|node_modules/);
});

test("fails for the root's own @types/node", (t) => {
  const result = run(t, { "package.json": rootPkg("^24.0.0") });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^- package\.json @types\/node is "\^24\.0\.0", expected \^26$/m);
});
