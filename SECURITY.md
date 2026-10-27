# Security and sensitive documents

Do not attach actual passports, face photographs, OCR outputs, credentials, personal emails, phone numbers or production logs to issues or pull requests. Reproduce problems using the in-memory fictional specimen or synthetic text/pixels. Remove sensitive metadata from any independently created fixture and review its bytes before sharing it.

For a security vulnerability, use GitHub's private vulnerability reporting feature in this repository. If private reporting is unavailable, open a minimal issue requesting a private contact channel without document data or exploit details.

The library performs local OCR and returns untrusted candidates. It does not verify identity, document authenticity or authorization. Validate and confirm fields in the hosting application. Configure your own retention and access controls for anything saved after review.

A fresh public Git history and explicit npm package file allowlist keep application history, infrastructure and local files out of release artifacts. `npm run audit:release` scans source/package paths and bytes for common credentials, private keys, home-directory paths, photo filenames, unreviewed binaries and package spillover. `npm run audit:licenses` verifies the locked dependency inventory and upstream notice/model hashes. These checks complement manual review; they cannot prove that every possible secret or upstream training datum is absent.

Only the BSD-licensed MRZ model is an approved binary in this source repository. Do not add document photographs or raw OCR captures, including real documents found online. Screenshots, videos, traces and browser test artifacts are not published by CI.
