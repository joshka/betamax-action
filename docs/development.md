# Maintain Betamax Action

Start with [local checks](../CONTRIBUTING.md), then use this page when changing the action itself.
For consumer setup and input semantics, use [getting started](getting-started.md) and the
[input reference](reference.md). [Validation notes](validation.md) hold live evidence and remaining
acceptance checks.

- [Architecture and code map](#architecture-and-code-map)
- [Render, artifact and report flow](#render-artifact-and-report-flow)
- [Choose the right test](#choose-the-right-test)
- [Change inputs or formats](#change-inputs-or-formats)
- [Change the artifact contract](#change-the-artifact-contract)
- [Update dependencies or Betamax](#update-dependencies-or-betamax)
- [Debug a failed preview](#debug-a-failed-preview)
- [Test the trusted reporter](#test-the-trusted-reporter)

## Architecture and code map

Two Node.js actions separate execution from publication. Rendering executes tapes and possibly a
PR-built Betamax executable. That runner is untrusted even if rendering succeeds. Reporting needs
write access, so it runs on a fresh runner with reviewed, pinned code and no PR checkout or cache.
Sharing a job would let a tape or build step steal credentials from later steps.

The entry points translate Actions inputs and outputs; the other modules expose functions that local
tests can call without an Actions runner. Both entry points are bundled so consumers execute the
reviewed JavaScript without an npm install. These boundaries keep credential handling out of the
rendering path and make reporting decisions testable with injected API responses.

| Start here                                                                                                | Responsibility                                                                                          |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| [`action.yml`](../action.yml), [`src/render-entry.js`](../src/render-entry.js)                            | Render inputs, event guard, artifact uploads, outputs and failure status                                |
| [`src/install.js`](../src/install.js)                                                                     | Verified Linux release download or literal local executable selection; optional dependency installation |
| [`src/render.js`](../src/render.js)                                                                       | Tape discovery, native output requests, media collection, scenario names and self-contained gallery     |
| [`src/process.js`](../src/process.js), [`src/common.js`](../src/common.js)                                | Bounded process logs/timeouts, paths, identifiers, media signatures and limits                          |
| [`report/action.yml`](../report/action.yml), [`src/report-entry.js`](../src/report-entry.js)              | Reporter inputs, GitHub.com/event guard and token masking                                               |
| [`src/report.js`](../src/report.js)                                                                       | Source-run/PR checks, artifact selection, comment ownership and stale-update prevention                 |
| [`src/github.js`](../src/github.js)                                                                       | Paginated API requests, bounded downloads, digest checks and native uploads                             |
| [`scripts/build.mjs`](../scripts/build.mjs), [`scripts/check-dist.mjs`](../scripts/check-dist.mjs)        | Build both committed bundles and detect drift                                                           |
| [`test/`](../test), [`examples/`](../examples), [`scripts/verify-media.mjs`](../scripts/verify-media.mjs) | Local behavioral tests and real media fixture assertions                                                |
| [Workflows](../.github/workflows)                                                                         | Local-check parity, unprivileged integration rendering and pinned reporting                             |

## Render, artifact and report flow

1. The render entry point validates inputs and creates a temporary output directory. A supplied
   `binary` must be executable, stay inside `working-directory` and contain no symlink components.
   It bypasses release version and checksum selection; optional dependency installation still runs.
   Without `binary`, the installer selects a Linux x64/ARM64 archive and verifies its SHA-256.
1. Discovery sorts and deduplicates tape paths, excludes build directories, and rejects traversal.
   Each tape receives appended native `Output` directives through stdin. GIF, PNG, WebP, MP4 and
   WebM go directly to Betamax; there is no conversion fallback for an older CLI.
1. Each tape has a timeout and a log capped at 1 MiB. Subprocess output goes to files rather than
   the Actions command interpreter. Failed tapes normally leave partial results and do not stop
   later tapes. Collection validates signatures and limits: 10 MiB per file, 20 files and 40 MiB per
   render invocation. These checks help diagnose mistakes; PR code can bypass them.
1. The renderer writes `manifest.json`, a gallery with embedded media, and individual media files.
   The entry point uploads gallery and media as separate raw artifacts using `skipArchive: true`. It
   attempts a separate diagnostics archive in `finally`, including tape/setup logs and the manifest
   when present. It marks the action failed after uploads if tapes or collection failed.
1. A completed run triggers the default-branch reporter. It independently fetches run, workflow,
   artifact and PR metadata, verifies the source workflow and current PR head/repository, and
   selects artifacts. It never treats the render manifest as authorization or downloads it.
1. Gallery mode constructs links entirely from API metadata. Native mode additionally downloads
   selected media, checks digest, size and signature, and uploads raw bytes. It never extracts a
   ZIP. The `/zip` API route still returns raw bytes for these `skipArchive` artifacts.
1. The reporter finds its own bot comment by marker, rejects duplicates, and skips stale run
   attempts. It rechecks the PR head and run attempt immediately before writing. Partial reruns
   retain the latest available attempt for each variant and label older galleries explicitly.

The reporter enforces native limits across all selected variants, so a matrix can pass each render
job's limit but exceed the report's 20-file/40-MiB budget. A digest authenticates the uploaded
bytes, not the producer. Magic-byte checks do not decode or sanitize media; see the
[security boundary](../SECURITY.md#optional-native-uploads).

## Choose the right test

Run commands from the repository root. The release-installer test skips on non-Linux hosts; CI
supplies that coverage. [CONTRIBUTING](../CONTRIBUTING.md) lists setup and the full checks. For
focused feedback:

```sh
node --test test/render.test.js
node --test test/report.test.js
node --test test/install.test.js test/metadata.test.js
```

| Layer                                                             | Establishes                                                                                                                                                        | Does not establish                                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| Local Node tests                                                  | Discovery, subprocess behavior, malformed media, metadata, names, stale runs, fork association and credential routing using temporary files and injected responses | Actual GitHub permissions, endpoint acceptance or real Betamax rendering                     |
| Bundle comparison                                                 | Rebuilding the checked-in bundles produces identical bytes                                                                                                         | That source tests execute the bundles on Actions                                             |
| [Betamax workflow](../.github/workflows/betamax.yml)              | Bundled action loading, real CLI output, raw artifact upload, dimensions and timing on Linux x64/ARM64                                                             | Arbitrary application correctness or security of PR code                                     |
| [Pinned report workflow](../.github/workflows/betamax-report.yml) | Deployed reporter works with real artifacts and configured credentials                                                                                             | Reporter source changes in the current PR, minimum PAT permissions or external-fork behavior |

The integration fixture builds a small Ratatui application. `verify-media.mjs` checks requested
formats and playback; `verify-webp.py` independently decodes WebP frames with Pillow and compares
opaque pixels with PNG where available. The local-binary variant wraps a verified release, checks an
invocation marker and supplies an invalid release version. This proves local selection and download
bypass, not that a consumer's PR-built CLI works.

Pushes to `main` and manual render dispatches exercise rendering but do not qualify for PR
reporting: the reporter requires a source run whose event is `pull_request`. Keep live results and
manual visual inspection in [validation notes](validation.md), with run links and explicit gaps.
Current gaps include native JPEG, private-repository access and a live external contributor PR.

### Rebuild the committed bundles

After changing runtime source or npm dependencies:

```sh
npm run build
node scripts/check-dist.mjs
jj diff --stat
```

Review and include `dist/render/index.js`, `dist/report/index.js`, adjacent legal notices and
`dist/package.json` as applicable. Never patch the bundles directly. The builder targets Node 24,
emits ESM, and supplies `createRequire` for bundled dependencies that need it.

`check-dist.mjs` hashes the current files, rebuilds, then compares. Run it **before** an intentional
build when checking whether committed bundles are stale; running it after a build checks
reproducibility. A failing check leaves the rebuilt files in the working copy for review.

## Change inputs or formats

For an input, update its action manifest, entry-point parsing/defaults, owning function and tests in
one change. Keep manifest defaults and JavaScript fallbacks aligned. Metadata tests catch malformed
YAML and input types, but do not prove that every input is wired correctly. Add behavioral coverage
for the effect, invalid values and precedence; `binary` overriding `version`/`sha256` is an example.
Update the [reference](reference.md) and rebuild both bundles.

For a format, follow its full path:

1. Add the requested extension to `parseFormats` only if Betamax can emit it natively. Confirm
   behavior with the oldest CLI version the change claims to support; unsupported or silently
   missing requested output must fail visibly.
1. Update `mediaType` and MIME handling, collection/gallery tests, and the reporter's artifact-name
   parser. JPEG is currently accepted as an extra output/native attachment, not as a requested
   render format.
1. Add real fixture checks for decoding, dimensions and timing where applicable. A magic-byte unit
   fixture is insufficient evidence for visual output. Extend the CI matrix only where the CLI and
   decoder are supported.
1. Decide whether a pinned reporter can consume the new media before deploying the producer. Follow
   [the contract procedure](#change-the-artifact-contract), then record live evidence and any
   untested combinations.

## Change the artifact contract

Artifact names are the protocol between independently deployed render and report actions. The
reporter does not read the gallery or manifest to learn filenames or captions. Current names are:

```text
betamax-<key>-<variant>-r<attempt>.html
betamax-<key>-<variant>-r<attempt>-m<index>.<scenario>.<extension>
betamax-<key>-<variant>-r<attempt>-diagnostics
```

The reporter also accepts legacy media names without `.<scenario>`. Keys and variants are bounded
identifiers; the attempt and media index carry selection/order. Scenario slugs are lossy, normalized
basenames of at most 60 characters. They provide display titles, never PR identity, paths or URLs.
The index preserves uniqueness when slugs collide. Diagnostics are not selected for comments.

A producer-only change can silently hide media from old pinned reporters. For example, an older
parser accepts `-m1.png` but ignores `-m1.demo.png`; the gallery can still appear and the report can
succeed. Testing new producer and consumer source together will miss this deployment failure.

For a change requiring a new reader:

1. First make the reporter accept both existing and proposed artifacts. Test mixed names, partial
   reruns, malformed names, collisions, ordering and limits. Preserve authorization checks before
   downloads and ensure display data cannot become workflow/PR metadata.
1. Review the reporter source and regenerated bundle. Publish that reviewed commit, then make a
   separately reviewed default-branch workflow change pinning the reporter to its full SHA. Do not
   point a privileged workflow at unreviewed PR code to accelerate testing.
1. Verify the deployed reader still handles old artifacts. Only then deploy the renderer that emits
   the new names. Named scenarios used this reader-first sequence; the repository workflow now pins
   the scenario-aware reader and its parser retains legacy support.
1. Check real comments for every expected media item. A green step or gallery link alone is not
   evidence of native-media compatibility. Tell consumers when their reporter pin must advance
   before their render pin, and keep old-name tests while those producers remain supported.

This is a compatibility deployment procedure, not permission to merge or publish a release.
Versioning, tag movement and Marketplace policy are still undecided; this guide does not establish a
release policy. The action version and its default Betamax CLI version are separate decisions.

## Update dependencies or Betamax

npm dependencies are locked and bundled. Review `package.json` and `package-lock.json` together, run
`npm ci --ignore-scripts`, tests, lint, `npm audit`, and rebuild `dist/`. The existing `smol-toml`
override addresses the Markdown linter's transitive dependency; verify the upstream resolution
before removing it. [Dependabot](../.github/dependabot.yml) groups routine npm and Actions updates
with a seven-day cooldown. Workflow dependencies use full commit SHAs.

To change the default Betamax release:

1. Download the x64 and ARM64 `.tgz` assets for the exact release from `joshka/betamax`. Hash the
   archives, not the extracted executable, and compare against the release asset digests before
   adding entries to `CHECKSUMS` in `src/install.js`. Retain older entries unless deliberately
   changing support. An explicit `sha256` overrides the built-in digest for a selected version.
1. Align `action.yml`, the fallback in `src/render-entry.js`, the matrix version in
   `.github/workflows/betamax.yml`, and `scripts/prepare-local-binary.mjs`. Update tests and
   examples that intentionally name the default. Use the search below to find remaining references.
1. Rebuild bundles, run local checks, then exercise both architectures, native formats and the local
   executable path in CI. Check independent decoder results and inspect representative galleries; a
   successful CLI exit can still hide timing or visual regressions.
1. Record version, archive digests and live run links in [validation notes](validation.md). Separate
   unverified formats/platforms from verified ones rather than carrying forward old evidence.

```sh
rg -n '0\.1\.19|CHECKSUMS|version:' action.yml src scripts test docs .github
```

A supplied local executable deliberately bypasses release digests. Do not describe its path checks
as equivalent provenance verification. For input precedence, see
[version and checksum inputs](reference.md#rendering-inputs).

## Debug a failed preview

| Symptom                                | First check                                                                                                           |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| No gallery                             | Render setup error, cancellation, tape selection or artifact upload failure; inspect diagnostics if any were produced |
| Partial gallery or failed action       | `manifest.json` problems/results and `tape-N.log`; successful exit with a missing native output is an error           |
| Dependency/download failure            | Setup logs, platform, exact version and archive checksum; local `binary` errors occur before dependency setup         |
| No comment/update                      | Source event/workflow, current PR head and head repository, run attempt, bot marker and existing run stamp            |
| Gallery present, native preview absent | Artifact-name compatibility with the deployed reporter, expired artifacts and aggregate limits                        |
| Native artifact fallback               | Reporter warning, digest/signature/size check, redirect host, or upload-token authorization                           |
| Local tests pass, CI behavior differs  | Committed bundle drift and the reporter's actual pinned SHA                                                           |

Download diagnostics for inspection; do not execute their contents or paste untrusted logs into a
privileged workflow. Subprocess logs are truncated at 1 MiB, so a missing tail is not proof that
nothing else ran. The manifest is useful evidence for debugging, never a trusted security claim.

Individual attachment failures normally warn and publish artifact fallback links. This repository's
report workflow adds an assertion for native URLs and absence of fallback text, so its live check
fails visibly. Duplicate delivery of an already published run attempt intentionally does nothing:
after fixing an upload problem, rerun the **render workflow** for the current PR head, not just the
reporter. More consumer-facing recovery guidance is in
[attachment retries](attachments.md#failures-and-retries).

## Test the trusted reporter

Local reporter tests need no PAT. They inject API responses and cover credential routing, but cannot
prove GitHub accepts a token or that an environment is configured correctly. Keep new reporter code
under local tests until reviewed; PR CI executes the existing default-branch pin.

For live acceptance, use the [reader-first procedure](#change-the-artifact-contract) when required,
then a normal PR render run with no secrets, `contents: read`, and checkout credentials disabled.
Use a fresh GitHub-hosted runner for reporting, with no PR checkout, build, executable or cache. The
[repository reporter](../.github/workflows/betamax-report.yml) has `actions: read` and
`pull-requests: write`, requires a PR source event and `refs/heads/main`, and uses the
`betamax-attachments` environment. Both gallery and native steps share that environment/job; only
the native step receives `BETAMAX_ATTACHMENT_TOKEN` as an input.

Environment branch rules and secret placement live in GitHub settings, not in this YAML.
Independently verify an exact `main` branch rule, no wildcard/tag rules, and no repository-level
copy of the PAT before native acceptance. Required environment reviewers are optional policy, not
enforced by this repository's code. The environment does not isolate the secret from other trusted
default-branch workflows or administrators. Follow
[attachment setup](attachments.md#verify-isolation) rather than adding a test secret to a PR job or
weakening a protection rule.

Gallery mode needs only the Actions token and never downloads media. Native mode sends the separate
PAT only to `uploads.github.com`; API comments and authenticated artifact requests use the Actions
token. Approved blob redirects receive no token. Verify native URLs and the bot author, inspect
media in a browser, and record the run and gaps. Never include tokens or signed download URLs in
evidence. A same-repository PR does not establish external-fork acceptance; that remains a separate
live test.
