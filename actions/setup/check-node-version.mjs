// .node-version owns the Node major (HAR-DEP-002). package.json engines.node states it for tools
// that read that field instead, and every @types/node should describe the same runtime, so both are
// copies this check keeps in step: the job fails when either names another major.
// Runs from the repository root; covers the root package.json and the package.json of every
// workspace package pnpm-workspace.yaml lists under `packages:` (the root alone when it lists none).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The `packages:` entries of a pnpm-workspace.yaml, unquoted. Reads only the two forms pnpm
 * documents (a block list or a one-line `[a, b]`), not YAML in general: this action runs before
 * the install, so it cannot depend on a YAML parser.
 */
function workspaceGlobs(yaml) {
  const lines = yaml.split(/\r?\n/);
  const start = lines.findIndex((line) => /^packages\s*:/.test(line));
  if (start === -1) return [];
  const unquote = (text) => text.replace(/\s+#.*$/, "").trim().replace(/^(['"])(.*)\1$/, "$2");
  const inline = lines[start].match(/^packages\s*:\s*\[(.*)\]/);
  if (inline) return inline[1].split(",").map(unquote).filter(Boolean);
  const globs = [];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*(#.*)?$/.test(line)) continue;
    const item = line.match(/^\s*-\s+(.*)$/);
    if (!item) break; // the next top-level key ends the list
    globs.push(unquote(item[1]));
  }
  return globs;
}

/** Directories under `dir` at any depth, `dir` included; never node_modules or dot directories. */
function descendants(dir) {
  const found = [dir];
  for (const entry of readdirSync(dir || ".", { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    found.push(...descendants(join(dir, entry.name)));
  }
  return found;
}

/** Directories matching a workspace glob, where a segment is a name, `*` (one level) or `**` (any depth). */
function expand(glob) {
  let dirs = [""];
  for (const segment of glob.split("/").filter((part) => part !== "" && part !== ".")) {
    dirs = dirs.flatMap((dir) => {
      if (!existsSync(dir || ".")) return [];
      if (segment === "**") return descendants(dir);
      if (!segment.includes("*")) return [join(dir, segment)];
      const pattern = new RegExp(`^${segment.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
      return readdirSync(dir || ".", { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== "node_modules" && pattern.test(entry.name))
        .map((entry) => join(dir, entry.name));
    });
  }
  return dirs;
}

/** The root package.json, then every workspace package's, sorted. */
function manifests() {
  if (!existsSync("pnpm-workspace.yaml")) return ["package.json"];
  const globs = workspaceGlobs(readFileSync("pnpm-workspace.yaml", "utf8"));
  const excluded = new Set(globs.filter((glob) => glob.startsWith("!")).flatMap((glob) => expand(glob.slice(1))));
  const found = new Set();
  for (const dir of globs.filter((glob) => !glob.startsWith("!")).flatMap(expand)) {
    const path = join(dir, "package.json");
    if (dir !== "" && !excluded.has(dir) && existsSync(path)) found.add(path);
  }
  return ["package.json", ...[...found].sort()];
}

const major = readFileSync(".node-version", "utf8").trim().replace(/^v/, "").split(".")[0];
const problems = [];

const root = JSON.parse(readFileSync("package.json", "utf8"));
if (root.engines?.node !== `${major}.x`) {
  problems.push(`package.json engines.node is "${root.engines?.node}", expected "${major}.x"`);
}

const checked = manifests();
for (const path of checked) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  const range = manifest.devDependencies?.["@types/node"] ?? manifest.dependencies?.["@types/node"];
  if (range && range.replace(/^[\^~]/, "").split(".")[0] !== major) {
    problems.push(`${path} @types/node is "${range}", expected ^${major}`);
  }
}

if (problems.length > 0) {
  console.error(`Node ${major} (.node-version) is not used everywhere:\n- ${problems.join("\n- ")}`);
  process.exit(1);
}
console.log(`Node ${major}: engines and @types/node agree with .node-version (${checked.join(", ")})`);
