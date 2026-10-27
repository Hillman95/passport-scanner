import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const root = new URL("../", import.meta.url);
const ignored = new Set([
  ".git",
  "node_modules",
  "dist",
  ".local",
  "test-results",
  "playwright-report",
]);
const permittedBinary = "vendor/mrz/mrz.traineddata.gz";
const modelHash =
  "205834bdab50d440247b1c3ac92d9e66b8ada887ad04affb64447453f9175a81";
const patterns = [
  /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{30,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{30,}\b/,
  /(?:\/Users\/|\/home\/)[a-z][a-z0-9_-]+\//i,
  /\bIMG_[0-9]{4,}(?:[._ -]|\b)/i,
  /(?:password|secret|token)\s*[:=]\s*["'][^"']{12,}["']/i,
];
function inspect(name, bytes) {
  if (name === permittedBinary) {
    if (createHash("sha256").update(bytes).digest("hex") !== modelHash)
      throw new Error("Unreviewed model bytes");
    return;
  }
  if (
    /\.(?:jpe?g|png|webp|heic|heif|pdf|p12|p8|pem|key|zip|tgz|gz|map)$/i.test(
      name,
    ) ||
    /(?:^|\/)\.env(?:\.|$)/.test(name)
  )
    throw new Error(`Unreviewed binary/private file: ${name}`);
  if (bytes.includes(0)) throw new Error(`Unreviewed binary: ${name}`);
  const text = bytes.toString("utf8");
  for (let i = 0; i < patterns.length; i++)
    if (patterns[i].test(text))
      throw new Error(
        `Privacy check ${i + 1} failed in ${name}; values withheld`,
      );
}
async function walk(dir) {
  const files = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const path = join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlinks are not publishable");
    if (entry.isDirectory()) {
      if (relative(root.pathname, path) !== "examples/ocr")
        files.push(...(await walk(path)));
    } else files.push(path);
  }
  return files;
}
const files = await walk(root.pathname);
for (const file of files)
  inspect(relative(root.pathname, file), await readFile(file));
// Git's actual index must not contain any ignored or unexpected files.
try {
  const tracked = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  for (const name of tracked)
    inspect(name, await readFile(new URL(name, root)));
} catch (error) {
  if (error.status !== 128) throw error;
}
const temporary = await mkdtemp(join(tmpdir(), "passport-scanner-pack-"));
try {
  const packed = JSON.parse(
    execFileSync(
      "npm",
      ["pack", "--ignore-scripts", "--json", "--pack-destination", temporary],
      { cwd: root, encoding: "utf8" },
    ),
  )[0];
  if (
    packed.name !== "@hillman95/passport-scanner" ||
    packed.version !== "0.1.0"
  )
    throw new Error("Unexpected packed package identity");
  const archive = join(temporary, packed.filename);
  for (const file of packed.files) {
    if (
      !/^(?:dist\/|src\/|scripts\/(?:prepare-assets\.mjs|heif-worker\.js)$|vendor\/mrz\/|licenses\/|(?:LICENSE|README\.md|SECURITY\.md|THIRD_PARTY_NOTICES\.md|package\.json)$)/.test(
        file.path,
      )
    )
      throw new Error(`Unexpected package file: ${file.path}`);
    inspect(
      file.path,
      execFileSync("tar", ["-xOf", archive, `package/${file.path}`], {
        maxBuffer: 20_000_000,
      }),
    );
  }
  console.log(
    `Privacy scan passed: ${files.length} source files; ${packed.files.length} packed files. No photos or prior application history included.`,
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
