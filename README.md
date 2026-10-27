# Passport Scanner

Local passport OCR for modern browsers, including difficult photographs. Automatically crops excess background, straightens tilted pages, improves contrast and rereads enlarged field crops. Reads Latin passport names, printed Cyrillic names when visible, document number, birth/issue/expiry dates and sex. Validates TD3 MRZ check digits and returns candidates for **human review**.

- JPEG, PNG, WebP and HEIC/HEIF; EXIF orientation, page cropping, deskewing and extra passes for difficult photos.
- Browser workers with self-hosted, pinned Tesseract/WASM models. No cloud OCR, API keys, telemetry or document uploads.
- Framework-independent TypeScript API, warmup, cancellation and explicit disposal.
- Russian passport layout refinements. This is a passport scanner, not a universal document classifier, identity verification service or forgery detector.

## Install

The package is distributed through GitHub Releases; it is not published to the npm registry.

```sh
npm install https://github.com/Hillman95/passport-scanner/releases/download/v0.1.1/hillman95-passport-scanner-0.1.1.tgz
npx passport-scanner-assets public/ocr
```

Serve `public/ocr` at `/ocr` from the **same origin** as your application. Run the asset preparation command during builds. It copies locally installed, pinned dependencies; it does not fetch models from a CDN. Preserve the generated `licenses` directories and notices when deploying.

```ts
import { createPassportScanner } from "@hillman95/passport-scanner";

const scanner = createPassportScanner({
  ocrPath: "/ocr/tesseract-v7",
  heifWorkerPath: "/ocr/heif-v1.23.5/worker.js",
});

// Call after the form paints, or when the user enters the relevant section.
await scanner.warmup();

const controller = new AbortController();
const result = await scanner.recognize(file, {
  signal: controller.signal,
  quarterTurns: 0,
  onProgress: (message) => {
    statusElement.textContent = message;
  },
});

// Display candidates beside the image; require confirmation before saving.
for (const [field, candidate] of Object.entries(result.fields)) {
  // candidate.value, candidate.source, candidate.checked, candidate.warning
}

controller.abort(); // Wire cancellation while recognition is pending.
await scanner.dispose(); // On permanent form/tab teardown; recreate to scan again.
```

`scanner.decode(file, signal?)` converts HEIC into a JPEG for a preview and leaves supported regular images unchanged. Revoke preview object URLs when clearing or closing the form. One recognition can run per scanner. Options `idleMs` (default 120000) and `prewarmAfterScan` (default true) control unused worker lifetime and warming a clean replacement. Instances have separate workers and settings. Lifecycle disposal also aborts pending HEIC decoding.

`extractPassport(englishLines, russianLines, mrzText, now?)` is available for applications that already produce OCR lines. Subpath exports expose image preparation, parser and worker helpers; the factory is the recommended API.

## Result fields

| Field                                                     | Meaning                                                        |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| `last_name`, `first_name`, `middle_name`                  | Printed Cyrillic name parts; never reverse-transliterated      |
| `passport_surname`, `passport_given_name`                 | Latin passport name fields                                     |
| `passport_number`                                         | Document number                                                |
| `birth_date`, `passport_issued_on`, `passport_expires_on` | ISO date, only when the complete date is readable/corroborated |
| `sex`                                                     | `male` or `female` when recognized                             |

A candidate's `checked` flag means a corresponding **MRZ check digit** matched; it does not mean the document, identity or all characters are valid. Names, sex and issue dates have no applicable MRZ checksum. `warning` signals uncertainty or disagreement. `mrz` is `valid`, `partial` or `unreadable`; fields can be absent. Never automatically accept Cyrillic names, dates located by layout, or conflicting readings. Do not overwrite existing form data without the person's explicit choice.

Unreadable years and issue dates are left empty; the library never derives an issue date from expiry or invents missing name letters. Glare, blur, clipping and patterned backgrounds can still prevent recognition. No measured accuracy claim is made. UI messages currently use Russian. Limits: 15 MiB compressed input, 40 megapixels, minimum 300 pixels on each side. Browser WASM memory can be significant, especially during warmup and high-resolution passes.

## Browser example and development

Node.js 22+ is needed for development; OCR itself runs in the browser, not Node.js. Chrome/Edge/Firefox/Safari must support WebAssembly, workers, canvas and `createImageBitmap`. Configure CSP for same-origin workers/scripts/models and WASM execution (`wasm-unsafe-eval` where required). No external scripts or fonts are required by the example.

```sh
npm ci
npm run check
npm run assets
npm run dev
# http://127.0.0.1:4173/examples/
npx playwright install chromium
npm run test:e2e
npm pack
```

The example draws a fictional specimen in memory. The repository contains **no real document photographs, face images or OCR outputs**. Tests use generated text/pixels and fictional/ICAO sample values. Browser tests assert that recognition makes only same-origin GET requests and that cancellation ignores late results.

## Privacy, security and licensing

Selected images remain in browser memory. A used OCR worker is terminated instead of reused; HEIC workers are terminated on success, error, cancellation or timeout. No images or OCR text are written to localStorage, IndexedDB or logs by this library. Hosting applications, extensions and browser diagnostics can still access their own page data; applications must manage what they save or send.

Original code is [MIT licensed](LICENSE). Third-party components keep their own free-software licenses: Apache-2.0, BSD, MIT and others; **HEIC decoding uses LGPL-3.0 libheif/libde265** in a separate, replaceable bundle. MIT does not relicense those components. Preserve notices and corresponding-source links. HEVC patent licensing is separate from open-source copyright licensing; this project does not promise royalty-free HEVC use in every jurisdiction. See [third-party notices](THIRD_PARTY_NOTICES.md), [release audit](docs/publication-audit.md) and [security policy](SECURITY.md).
