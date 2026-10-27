import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";

const lock = JSON.parse(
  await readFile(new URL("../package-lock.json", import.meta.url)),
);
const allowed = new Set([
  "MIT",
  "MIT-0",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "LGPL-3.0",
  "CC0-1.0",
  "Unlicense",
  "BlueOak-1.0.0",
  "MPL-2.0",
  "Python-2.0",
  "CC-BY-4.0",
]);
const inventory = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path) continue;
  const license = pkg.license ?? "UNKNOWN";
  const terms = license.replace(/[()]/g, "").split(/\s+(?:OR|AND)\s+/);
  if (!terms.every((term) => allowed.has(term)))
    throw new Error(`Unreviewed dependency license: ${path}: ${license}`);
  if (
    !pkg.resolved?.startsWith("https://registry.npmjs.org/") ||
    !pkg.integrity
  )
    throw new Error(
      `Dependency is not pinned to the public npm registry: ${path}`,
    );
  inventory.push({
    package: path.replace(/^node_modules\//, ""),
    version: pkg.version,
    license,
    development: !!pkg.dev,
    optional: !!pkg.optional,
  });
}
const manifest = JSON.parse(
  await readFile(new URL("../licenses/upstream.json", import.meta.url)),
);
for (const item of manifest) {
  const content = await readFile(new URL(`../${item.file}`, import.meta.url));
  if (createHash("sha256").update(content).digest("hex") !== item.sha256)
    throw new Error(`Upstream attribution checksum changed: ${item.file}`);
}
const report = JSON.stringify(inventory, null, 2) + "\n";
const destination = new URL(
  "../docs/dependency-licenses.json",
  import.meta.url,
);
if (process.argv.includes("--write")) await writeFile(destination, report);
else if ((await readFile(destination, "utf8")) !== report)
  throw new Error(
    "Dependency inventory changed; review it before regenerating with --write",
  );
console.log(
  `Reviewed ${inventory.length} locked dependency entries and ${manifest.length} upstream notices/models.`,
);
