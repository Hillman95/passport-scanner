# Contributing

Use synthetic fixtures only; never submit real document photographs, extracted personal data or production credentials. Keep the library framework-independent, browser-local and free of telemetry.

Run `npm ci`, `npm run check`, `npx playwright install chromium`, and `npm run test:e2e`. For dependency changes, review all changed license/source information before regenerating `docs/dependency-licenses.json` with `node scripts/audit-licenses.mjs --write`. Update upstream notices when changing models or WASM builds. Do not weaken checks to accept an unknown license.

Use pull requests and explain the behavior change and validation. Contributions are licensed under this repository's MIT license; third-party source retains its original license.
