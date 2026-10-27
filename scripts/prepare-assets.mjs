#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));
const target = resolve(process.argv[2] ?? "public/ocr");
const files = [
  [
    require.resolve("tesseract.js/dist/worker.min.js"),
    "tesseract-v7/worker.min.js",
  ],
  ...["", "simd-", "relaxedsimd-"].map((variant) => [
    require.resolve(`tesseract.js-core/tesseract-core-${variant}lstm.wasm.js`),
    `tesseract-v7/tesseract-core-${variant}lstm.wasm.js`,
  ]),
  ...["eng", "rus"].map((lang) => [
    join(
      dirname(require.resolve(`@tesseract.js-data/${lang}`)),
      "4.0.0_best_int",
      `${lang}.traineddata.gz`,
    ),
    `tesseract-v7/lang/${lang}.traineddata.gz`,
  ]),
  [
    join(root, "vendor/mrz/mrz.traineddata.gz"),
    "tesseract-v7/lang/mrz.traineddata.gz",
  ],
  [join(root, "vendor/mrz/LICENSE"), "tesseract-v7/licenses/mrz-model.txt"],
  [join(root, "scripts/heif-worker.js"), "heif-v1.23.5/worker.js"],
  [
    join(
      dirname(require.resolve("libheif-js/package.json")),
      "libheif-wasm/libheif-bundle.js",
    ),
    "heif-v1.23.5/libheif-bundle.js",
  ],
];
const notices = JSON.parse(
  await readFile(join(root, "licenses/upstream.json"), "utf8"),
);
for (const item of notices) {
  if (item.file.startsWith("licenses/")) {
    for (const directory of ["tesseract-v7/licenses", "heif-v1.23.5/licenses"])
      files.push([join(root, item.file), `${directory}/${item.file.slice(9)}`]);
  }
}
for (const [source, name] of files) {
  const destination = join(target, name);
  const data = await readFile(source);
  const current = await readFile(destination).catch(() => null);
  if (current?.equals(data)) continue;
  await mkdir(dirname(destination), { recursive: true });
  await copyFile(source, destination);
}
for (const directory of ["tesseract-v7/licenses", "heif-v1.23.5/licenses"]) {
  await copyFile(
    join(root, "THIRD_PARTY_NOTICES.md"),
    join(target, directory, "NOTICE.txt"),
  );
  await writeFile(
    join(target, directory, "sources.json"),
    JSON.stringify(notices, null, 2) + "\n",
  );
}
console.log(
  `Prepared pinned self-hosted OCR assets and third-party notices in ${target}`,
);
