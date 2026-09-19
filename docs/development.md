# Maintaining Betamax Action

For dependencies and local commands, see [Contributing](../CONTRIBUTING.md). This guide covers how
the two actions communicate, where to change their behavior, and how to test changes that need
GitHub.

## Architecture

The render action executes tapes, collects media and uploads artifacts. The report action selects
artifacts from a completed PR run and updates a bot comment. Artifact names connect the two actions;
the reporter does not read the renderer's manifest to decide which PR or comment to update.

Rendering runs PR-controlled commands, so reporting uses a separate runner and reviewed code.
Gallery mode reads only API metadata. Attachment mode also downloads and checks media before
uploading it with a separate user token. [Security](../SECURITY.md) defines the trust boundary.

### Code map

| Files                                                                                        | Responsibility                                                                |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`action.yml`](../action.yml), [`src/render-entry.js`](../src/render-entry.js)               | Render inputs, outputs, uploads and failure status.                           |
| [`src/install.js`](../src/install.js)                                                        | Release verification, local executable selection and dependency installation. |
| [`src/render.js`](../src/render.js)                                                          | Tape discovery, output requests, media collection and HTML galleries.         |
| [`src/process.js`](../src/process.js), [`src/common.js`](../src/common.js)                   | Process limits, paths, identifiers and media checks.                          |
| [`report/action.yml`](../report/action.yml), [`src/report-entry.js`](../src/report-entry.js) | Report inputs, event guard and token masking.                                 |
| [`src/report.js`](../src/report.js)                                                          | Run and PR verification, artifact selection and comment updates.              |
| [`src/github.js`](../src/github.js)                                                          | Paginated API requests, downloads, digest checks and uploads.                 |
| [`scripts/`](../scripts), [`test/`](../test), [workflows](../.github/workflows)              | Bundling, local tests and integration checks.                                 |

### Rendering and reporting behavior

The renderer appends native output directives to each tape and sends it through stdin. It collects
partial results after tape failures and attempts to upload diagnostics even after setup errors.
Subprocess logs go to files rather than the Actions command interpreter.

Gallery and media uploads use `skipArchive: true`; diagnostics use a ZIP. GitHub's `/zip` download
route returns raw bytes for the unarchived artifacts. Keep this distinction when changing downloads;
the reporter never extracts archives.

The reporter checks source repository, workflow, event, run attempt and PR head before selecting
artifacts. It locates its comment by marker and bot author, rejects duplicate matching comments, and
rechecks the head and attempt before writing. Partial reruns select the latest available artifacts
for each variant and label older galleries. Attachment limits apply across the selected matrix, even
when each rendering job fits its own limit.

## Testing

Local tests use temporary files and injected API responses. They cover discovery, subprocesses,
media validation, run selection, comment ownership and credential routing. Run a focused suite with:

```sh
node --test test/render.test.js
node --test test/report.test.js
node --test test/install.test.js test/metadata.test.js
```

The [render workflow](../.github/workflows/betamax.yml) exercises the committed bundles with a real
Betamax CLI and Ratatui application. `verify-media.mjs` checks formats, dimensions and playback.
`verify-webp.py` decodes frames with Pillow and compares opaque pixels with PNG. Preserve checks for
palette reduction, frozen animation and missing final-frame holds when changing formats.

The local-binary job wraps a verified release and checks an invocation marker while supplying an
invalid release version. It tests executable selection and download bypass. It does not build
Betamax from source.

### Live reporter tests

The [report workflow](../.github/workflows/betamax-report.yml) runs the reviewed default-branch pin,
so a PR's render test does not test that PR's reporter source. Review and deploy reporter changes
before running a live test with write credentials. For artifact changes, follow the
[compatibility procedure](#artifact-compatibility).

Trigger rendering through a PR. Manual dispatches and pushes to `main` can test rendering, but their
runs do not qualify for PR reporting. Keep the render job read-only, with no secrets and checkout
credentials disabled. The reporter needs a fresh runner with no PR checkout, build or restored
cache.

For attachment uploads, check the environment and secret placement using the
[attachment procedure](attachments.md). Both report steps in this repository share the environment,
but only the attachment step receives the attachment token. Verify attachment URLs and the bot
author, inspect media in a browser, and record run links in the PR. The workflow checks for upload
fallbacks because the action can otherwise succeed after an individual upload fails.

### Recorded coverage

These are historical results retained from the former validation page, not new tests of this change:

| Check                              | Recorded result                                                                                                                                                                                     |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Betamax 0.1.19                     | [Integration run](https://github.com/joshka/betamax-action/actions/runs/35424306802) covered GIF/PNG/WebP on Linux x64 and ARM64, MP4/WebM on x64, and the local executable path.                   |
| Native WebP                        | [0.1.18 run](https://github.com/joshka/betamax-action/actions/runs/35420275147) checked changing frames, color preservation, final-frame holds and PNG pixel agreement.                             |
| Comment updates and partial reruns | [Reporter run](https://github.com/joshka/betamax-action/actions/runs/35416458946) updated one comment and retained older matrix variants with attempt labels.                                       |
| Attachment uploads                 | [Public-repository comment](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738717951) displayed GIF, PNG, WebP, MP4 and WebM using a repository-scoped PAT with Contents read/write. |
| Default Betamax 0.1.20             | Both archive hashes were checked against release digests. Live rendering for this version was not recorded in the validation notes.                                                                 |

JPEG attachments, private-repository attachment access, minimum PAT permissions and a live
external-fork PR remain unverified in those records. Keep future results with their PR or release,
rather than extending this table into a release diary. Do not carry earlier-version results forward
as proof of a new default. Release checksums remain in [`src/install.js`](../src/install.js).

## Changing inputs or formats

For an input, update the action manifest, entry-point parsing and defaults, implementation and tests
together. Test invalid values and precedence, such as `binary` overriding `version` and `sha256`.
Update the [README settings](../README.md#rendering-inputs) and rebuild both bundles.

For a format:

1. Add it to `parseFormats` only if Betamax emits it natively. Test the oldest CLI version you claim
   to support. Unsupported or missing output must fail.
1. Update `mediaType`, MIME handling, collection, gallery tests and the reporter's artifact parser.
1. Add real decoding, dimension and timing checks where applicable. Magic-byte fixtures cannot
   detect rendering errors.
1. Check compatibility with deployed reporters before publishing the renderer.

## Artifact compatibility

Artifact names are the protocol between independently deployed render and report actions. The
reporter does not read the gallery or manifest to learn filenames or captions. Current names are:

```text
betamax-<key>-<variant>-r<attempt>.html
betamax-<key>-<variant>-r<attempt>-m<index>.<scenario>.<extension>
betamax-<key>-<variant>-r<attempt>-diagnostics
```

The reporter also accepts legacy media names without `.<scenario>`. Keys and variants are bounded
identifiers. The attempt selects the run; the media index sets the order. Scenario slugs are lossy,
normalized basenames of at most 60 characters. They provide display titles, never PR identity, paths
or URLs. The index preserves uniqueness when slugs collide. Diagnostics are not selected for
comments.

Changing only the renderer can hide media from older pinned reporters. For example, an older parser
accepts `-m1.png` but ignores `-m1.demo.png`; the gallery can still appear and the report can
succeed. Testing only the new renderer with the new reporter will miss this failure.

Scenario slugs use the basename without its final extension. Normalize with Unicode NFKD, remove
combining marks, lowercase ASCII letters, and replace runs of other characters with hyphens. Trim
leading and trailing hyphens, retain the first 60 characters, then trim trailing hyphens again. An
empty result becomes `scenario`. Display titles replace hyphens with spaces and capitalize the first
letter. Dot separators keep scenario text separate from selection metadata.

When the reporter needs to accept a new artifact name or format:

1. First make the reporter accept both existing and proposed artifacts. Test mixed names, partial
   reruns, malformed names, collisions, ordering and limits. Preserve authorization checks before
   downloads and check that display text cannot change workflow or PR selection.
1. Review the reporter source and regenerated bundle. Publish that reviewed commit, then make a
   separately reviewed default-branch workflow change pinning the reporter to its full SHA. Do not
   point a privileged workflow at unreviewed PR code to accelerate testing.
1. Verify the deployed reporter still handles old artifacts, then deploy the renderer that emits the
   new names. The repository's pinned reporter accepts both named scenarios and legacy names.
1. Check real comments for every expected media item. A green step or gallery link alone is not
   enough to verify attachment uploads. Tell consumers when they must update their reporter pin
   before their render pin. Keep old-name tests while older renderers remain supported.

## Dependencies and Betamax releases

Review `package.json` and `package-lock.json` together. Run `npm ci --ignore-scripts`, tests, lint
and `npm audit`, then rebuild `dist/`. The `smol-toml` override addresses the Markdown linter's
transitive parser vulnerability; check the upstream dependency before removing it. Dependabot groups
routine npm and Actions updates with a seven-day cooldown. Workflow actions use full commit SHAs.

To change the default Betamax release:

1. Download the x64 and ARM64 archives for the exact release. Compare archive hashes with the
   release asset digests before adding them to `CHECKSUMS` in `src/install.js`. Retain older entries
   unless intentionally dropping support.
1. Update `action.yml`, `src/render-entry.js`, `.github/workflows/betamax.yml`,
   `scripts/prepare-local-binary.mjs`, and tests or documentation that name the default.
1. Rebuild bundles and run local checks. Exercise both architectures, requested formats and the
   local executable path in CI. Inspect recordings as well as decoder assertions.
1. Record the version, digests, run links and untested combinations in the PR or release record.

The action's release version is separate from its default Betamax version. Stable tags and
Marketplace publication do not yet have an agreed release policy.

## Debugging implementation failures

For setup problems, see [README troubleshooting](../README.md#troubleshooting). When investigating
an implementation failure:

- Compare the committed bundle and deployed reporter SHA with the source you tested.
- Inspect `manifest.json`, setup logs and `tape-N.log` for missing outputs and capture failures.
- Check artifact-name compatibility when galleries appear but inline attachments do not.
- Check report warnings for digest, signature, byte-limit, redirect or upload authorization
  failures.

Treat diagnostics as PR-controlled data. Download them for inspection, but do not execute their
contents or paste logs into a privileged workflow. Logs are capped at 1 MiB, so their tail may be
missing.
