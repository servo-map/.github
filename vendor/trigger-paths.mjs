#!/usr/bin/env node
// Fails when a path a source repository exports would not start its vendor-sync workflow.
//
//   node trigger-paths.mjs --source-root <dir> --workflow <path relative to source-root>
//
// The caller workflow's `on.push.paths` restates the `from` entries of its vendor.json, because a
// trigger cannot be computed. This is the check on that copy: every `from` must be covered by the
// filter, or a change to an exported file would reach no target. A `from` that is a file must match
// the filter; one that is a directory must match at any depth (`dir/**`, not `dir/*`). A workflow
// with no push trigger, or a push trigger with no `paths`, has no filter to fall short.

import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

const { values: args } = parseArgs({
  options: { "source-root": { type: "string" }, workflow: { type: "string" } },
});
for (const key of ["source-root", "workflow"]) {
  if (!args[key]) throw new Error(`missing --${key}`);
}

const indentOf = (line) => line.length - line.trimStart().length;
/** A YAML scalar as written in a list: without its quotes or a trailing comment. */
function scalar(text) {
  const value = text.trim();
  const quoted = /^(["'])(.*?)\1/.exec(value);
  return quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
}

/** The lines nested under the first `key:` at exactly `indent`, or null when there is no such key. */
function block(lines, key, indent) {
  const start = lines.findIndex((line) => indentOf(line) === indent && new RegExp(`^["']?${key}["']?:`).test(line.trim()));
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => indentOf(line) <= indent);
  return { head: lines[start].trim().replace(/^[^:]+:/, ""), body: end === -1 ? rest : rest.slice(0, end) };
}

/**
 * The `on.push.paths` patterns of a workflow file, or null when a push is not filtered by path.
 * Reads the block and flow list forms GitHub's own examples use; this is not a YAML parser.
 */
function pushPaths(text) {
  const lines = text.split("\n").filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
  const on = block(lines, "on", 0);
  const push = on && block(on.body, "push", indentOf(on.body[0] ?? ""));
  if (!push || push.body.length === 0) return null;
  const paths = block(push.body, "paths", indentOf(push.body[0]));
  if (!paths) return null;
  const flow = /^\s*\[(.*)\]/.exec(paths.head);
  if (flow) return flow[1].split(",").map(scalar).filter(Boolean);
  return paths.body.filter((line) => line.trim().startsWith("- ")).map((line) => scalar(line.trim().slice(2)));
}

/** A GitHub filter pattern as a regular expression (`*`, `**`, `?`, `+`, `[]` as its docs define). */
function patternRegExp(pattern) {
  let source = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (pattern.startsWith("**/", i)) {
      source += "(?:.*/)?";
      i += 2;
    } else if (pattern.startsWith("**", i)) {
      source += ".*";
      i += 1;
    } else if (char === "*") source += "[^/]*";
    else if (char === "?" || char === "+") source += char;
    else if (char === "[" && pattern.includes("]", i)) {
      const close = pattern.indexOf("]", i);
      source += pattern.slice(i, close + 1);
      i = close;
    }
    else if (char === "\\") source += `\\${pattern[(i += 1)] ?? "\\"}`;
    else source += char.replace(/[.^$(){}|[\]/-]/, "\\$&");
  }
  return new RegExp(`^${source}$`);
}

/** Whether `path` starts the workflow: the last pattern that matches decides, `!` excluding. */
function matches(patterns, path) {
  let matched = false;
  for (const pattern of patterns) {
    const negated = pattern.startsWith("!");
    if (patternRegExp(negated ? pattern.slice(1) : pattern).test(path)) matched = !negated;
  }
  return matched;
}

const root = args["source-root"];
const config = JSON.parse(readFileSync(join(root, "vendor.json"), "utf8"));
const patterns = pushPaths(readFileSync(join(root, args.workflow), "utf8"));
if (patterns === null) {
  console.log(`trigger paths: ${args.workflow} does not filter pushes by path`);
  process.exit(0);
}

const exported = [...new Set(Object.values(config.targets ?? {}).flatMap((mappings) => mappings.map(({ from }) => from)))];
const uncovered = exported.filter((from) => {
  const abs = join(root, from);
  if (!existsSync(abs)) throw new Error(`vendor.json exports a missing path: ${from}`);
  // Two probes below a directory: a pattern that stops at one level (`dir/*`) misses nested files.
  const probes = statSync(abs).isFile() ? [from] : [`${from}/probe`, `${from}/probe/probe`];
  return !probes.every((probe) => matches(patterns, probe));
});

if (uncovered.length > 0) {
  console.error(
    `${args.workflow} is not started by every path vendor.json exports; add to its on.push.paths:\n  ${uncovered.join("\n  ")}`,
  );
  process.exit(1);
}
console.log(`trigger paths: ${exported.length} exported paths start ${args.workflow}`);
