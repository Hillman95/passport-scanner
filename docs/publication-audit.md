# Initial public-release review

Review date: 2026-10-27. Scope: the standalone scanner source, test text/pixel generators, dependency lock, model, notices, fresh Git history and installable package contents.

- Extracted framework-independent scanner code using an explicit file list. No application repository history, CRM screens, UI kit, business/API modules, deployment configuration or private task notes are included.
- No real passport images, portraits, OCR captures, attachments or downloaded public document specimens are included. Test inputs are generated in memory from fictional text and pixels or documented ICAO sample values.
- The sole binary is the publicly licensed, pinned MRZ model. Its deterministic gzip has no filename/timestamp metadata; compressed and uncompressed hashes and source license are recorded.
- Source and npm package contents are checked for common credential patterns, private keys, local user paths, camera filenames, unapproved binaries and unexpected package files. Package exports/files are explicit. Generated models/WASM assets, dependency directories, environment files and test output are ignored by Git.
- Every direct/transitive/development/optional npm lock entry has a reviewed free-software license and a public registry URL plus integrity hash. The complete inventory is committed. Native WASM components and language-model licenses are reviewed separately, including the npm/upstream model license discrepancy.
- Original code is MIT; original third-party copyright/license texts remain intact. LGPL HEIF decoding stays in a separate replaceable script, with exact corresponding-source links and build recipe. No claim of worldwide patent-free HEVC is made.
- Publication starts with a clean initial commit under a project identity and a non-personal example-domain email. Existing private Git metadata is not transferred.

Verification commands: `npm ci`, `npm run check`, `npm run test:e2e`, `npm pack`; installation and asset preparation are additionally checked from the packed archive in a separate directory. Browser checks use real local OCR on the synthetic specimen, same-origin GET-only request assertions, cancellation and late-response handling. Real document data is never uploaded for verification.

This is an engineering privacy/license review of the release contents, not an audit of every upstream training record or a legal opinion about codec patents. Future releases must repeat the checks, review changed dependencies/model hashes, and review every added fixture before publication.

Initial local verification results: 44 unit tests and 2 Chromium browser tests passed. The production npm dependency audit reported zero known vulnerabilities. Gitleaks 8.30.1 (official release checksum verified) reported zero findings in both the public source tree and the packed package. A separate private denylist check reported zero matches; its private reference values are not part of this repository. Automated pattern scanning is not a guarantee against every possible secret.
