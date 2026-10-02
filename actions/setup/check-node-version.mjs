// .node-version owns the Node major (HAR-DEP-002). package.json engines.node states it for tools
// that read that field instead, and every @types/node should describe the same runtime, so both are
// copies this check keeps in step: the job fails when either names another major.
// Runs from the repository root; covers the root package.json and every packages/*/package.json.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const major = readFileSync(".node-version", "utf8").trim().replace(/^v/, "").split(".")[0];
const problems = [];

const manifests = ["package.json"];
if (existsSync("packages")) {
  for (const pkg of readdirSync("packages")) {
    const path = join("packages", pkg, "package.json");
    if (existsSync(path)) manifests.push(path);
  }
}

const root = JSON.parse(readFileSync("package.json", "utf8"));
if (root.engines?.node !== `${major}.x`) {
  problems.push(`package.json engines.node is "${root.engines?.node}", expected "${major}.x"`);
}

for (const path of manifests) {
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
console.log(`Node ${major}: engines and @types/node agree with .node-version`);
