# Third-party software and model notices

Original scanner code is MIT licensed. The following components retain their original licenses; they are not relicensed under MIT. No paid service, proprietary OCR model or application UI kit is included.

| Component                              | Pinned version/source                                                                                    | License                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Tesseract.js and core                  | 7.0.0                                                                                                    | Apache-2.0                                                          |
| Tesseract English/Russian trained data | `@tesseract.js-data/{eng,rus}` 1.0.0, `4.0.0_best_int`                                                   | Apache-2.0 for upstream trained data; npm wrapper metadata says MIT |
| MRZ trained data                       | DoubangoTelecom/tesseractMRZ `1e7adfecda5f3c9ae1fb12cf6b4b8c3958c63e46`, `tessdata_fast/mrz.traineddata` | BSD-3-Clause                                                        |
| MRZ parser                             | mrz 5.0.2                                                                                                | MIT                                                                 |
| Validation                             | Zod 4.6.7                                                                                                | MIT                                                                 |
| HEIC JavaScript package                | libheif-js 1.23.5                                                                                        | LGPL-3.0                                                            |
| HEIF native decoder                    | libheif `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00`                                                       | LGPL-3.0-or-later                                                   |
| HEVC native decoder                    | libde265 1.0.15                                                                                          | LGPL-3.0-or-later                                                   |
| Emscripten runtime                     | 3.1.61 for the HEIF build                                                                                | MIT / University of Illinois-NCSA; preserve upstream details        |

Full verbatim license/copyright texts are in `licenses/` and `vendor/mrz/LICENSE`. Exact source URLs, revisions and file SHA-256 values are in [`licenses/upstream.json`](licenses/upstream.json). [`docs/dependency-licenses.json`](docs/dependency-licenses.json) lists every production, development and platform-optional npm lock entry. Dev tools are not shipped in the installable package.

## Native dependencies inside Tesseract core

The pinned core uses Tesseract (Apache-2.0), Leptonica (BSD), GIFLIB (MIT), libjpeg (IJG), libpng (libpng license), libtiff (libtiff license), libwebp (BSD plus its patent grant), zlib (Zlib), and OpenLibm (MIT/BSD/ISC and upstream per-file notices). These are free software; their original texts and exact submodule source revisions are retained in the manifest. OpenLibm's separate upstream test programs carry LGPL; those programs are not the scanner runtime. Native dependency lists cannot be inferred solely from npm's top-level `license` field.

## HEIF replacement and corresponding source

The scanner's MIT worker adapter loads **unmodified** `libheif-bundle.js` as a separate classic-worker script. Consumers can replace the bundle with an interface-compatible rebuilt version and configure a different worker URL. No restriction is imposed on modification or reverse engineering needed to debug the LGPL components. The asset copier preserves the library license texts (including the GPL text incorporated by LGPL) and this notice next to the bundle.

Corresponding source is freely downloadable from these exact upstream locations:

- [libheif-js source, wrapper and bundling/build scripts](https://github.com/catdad-experiments/libheif-js/tree/d8ec4bc3bc5bf8055975577bccbbc7e1d7313c2d). Its `scripts/install.js` identifies the prebuilt Emscripten release and performs the JS/WASM bundling.
- [libheif-emscripten build recipe and CI](https://github.com/catdad-experiments/libheif-emscripten/tree/5c8968a44e9c68ae677e24790d77d001ed7fe7cc). Version v1.23.5 pins the native submodule and Emscripten 3.1.61. CI enables WASM and TypeScript declarations and disables unsafe dynamic execution.
- [libheif source archive](https://github.com/strukturag/libheif/archive/413e2a87e6a70b3eccc3a3adc5801179dd2d9e00.tar.gz), including `build-emscripten.sh`, `post.js`, headers, native decoder code and build scripts.
- [libde265 1.0.15 source archive](https://github.com/strukturag/libde265/releases/download/v1.0.15/libde265-1.0.15.tar.gz).
- [Emscripten 3.1.61](https://github.com/emscripten-core/emscripten/tree/3.1.61).

The audited HEIF build enables libde265; optional AOM, WebCodecs, OpenJPEG and uncompressed codecs default off. No x265 encoder is included by that build recipe. This project does not redistribute prebuilt HEIF/Tesseract bundles in Git or its own package tarball; the pinned npm dependencies provide them. The asset command copies them for the consuming host, together with all notices and source links. A redistributor must keep corresponding source available and satisfy the applicable license for its own distribution; modified builds require updated source and notices.

HEVC patent claims are independent of these copyright licenses. Free-software source availability is not a guarantee that HEVC use is royalty-free worldwide.

## Model provenance

The MRZ model is the upstream pretrained model, not fine-tuned on user documents. Original model SHA-256: `ece2a54f125a73792f9cec74e6f8e62f6e5e00c7f19153ba865af689be5b5f01`; deterministic gzip SHA-256: `205834bdab50d440247b1c3ac92d9e66b8ada887ad04affb64447453f9175a81`. The gzip's timestamp is zero and its header has no original filename. Model weights are redistributed under the upstream BSD-3-Clause license. No claim is made to have audited the complete upstream training corpus, and upstream benchmark results are not scanner accuracy claims.

English/Russian models are the exact upstream npm bytes, copied without modification. The Apache-2.0 upstream trained-data license is retained despite the npm wrappers' differing MIT metadata.
