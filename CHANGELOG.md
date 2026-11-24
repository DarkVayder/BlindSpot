# Changelog

All notable changes to the Blindspot CLI. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## [0.1.0] — unreleased

First release.

### Added

- `blindspot analyze`: maps every file in a git repository by complexity (TypeScript and
  JavaScript), change pressure, knowledge concentration, explicit AI provenance and import
  impact, and sorts files by a descriptive attention index (model `bs-risk@0.1.0`).
- Terminal summary, versioned JSON report and a standalone HTML report with a strict
  Content Security Policy and no external requests.
- `--baseline` and `blindspot compare` to compare two reports, and `--fail-on` to gate CI on
  files newly at or above a band.
- `blindspot init` for a starter `blindspot.config.json`, and `blindspot schema` for the
  configuration and report JSON Schemas.
- A GitHub Action (`DarkVayder/BlindSpot`) that writes a job summary, compares a pull request
  with the commit it branched from, and can gate on `fail-on`. It runs self-contained on the
  runner with no token or network.

### Notes

- The attention index is not a prediction of defects. In a registered study on 10
  open-source repositories it ranked files that later received bug fixes below file size
  alone. See `docs/research-report.md` in the source repository.
- The CLI makes no network calls and collects no telemetry.
