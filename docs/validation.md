# Validation notes

The action is in its initial integration phase. These checks establish the behavior below; they do
not make the native upload endpoint a supported GitHub REST API.

## Automated checks

[CI](https://github.com/joshka/betamax-action/actions/runs/35416588706) passes 32 tests, JavaScript
and Markdown linting, formatting, bundle comparison, Rust formatting and Clippy, dependency audit,
and zizmor 1.30.1. Tests cover malformed action manifests, path containment, process timeouts,
failed captures, API pagination, bot comment ownership, fork association, stale heads, run attempts,
and native upload credential routing and byte validation.

## Live rendering

The [integration run](https://github.com/joshka/betamax-action/actions/runs/35416332169) builds a
small Ratatui app and verifies:

- GIF, PNG and animated WebP on Ubuntu 24.04 x64.
- MP4 and WebM on Ubuntu 24.04 x64.
- GIF and PNG on Ubuntu 24.04 ARM64.
- Checkpoint collection through `extra-outputs`.
- 780 × 350 output dimensions and animation duration between 2.4 and 2.7 seconds.

Downloaded galleries were also inspected in a browser: images decoded at the expected dimensions,
and both video formats decoded and reported approximately 2.53 seconds of playback. Generated media
remains in Actions artifacts, rather than in the source repository.

These checks caught Betamax 0.1.15's direct video writer dropping frame delays. Betamax 0.1.17 fixes
video timing upstream. The action now requests MP4/WebM directly and keeps GIF conversion only for
WebP, which Betamax does not write natively. See the
[format tradeoffs](reference.md#supported-formats-and-conversion).

## PR reporting

The [demo comment](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738617709) was
created and updated across commits using only `GITHUB_TOKEN`. The same comment also reported a
manifest-loading failure when no galleries were available. The publisher uses the default-branch
workflow and a pinned action, with no PR checkout.

A partial rerun of the images job completed as attempt 2. The
[reporter](https://github.com/joshka/betamax-action/actions/runs/35416458946) updated that same
comment, selected the new images gallery, and retained ARM/video galleries with explicit “from
attempt 1” labels. Only one gallery-mode comment existed after this test.

## Native attachments

A fine-grained PAT restricted to `joshka/betamax-action` with Contents read/write uploaded ten
files: GIF, PNG, WebP, MP4 and WebM, including checkpoints and both runner architectures. The
[native comment](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738717951) is
separate from the gallery-link comment; both select the same artifacts.

GitHub displayed all images at 780 × 350 and both videos at approximately 2.53 seconds in a
signed-out browser. This verifies public-repository rendering, including native video players. It
does not establish the token's minimum permissions or private-repository access behavior.

The repository's reporting workflow rejects comments containing upload fallbacks or no native URLs,
so a successful artifact-link fallback cannot hide a failed native upload test. The PAT remains
restricted to the upload step.

## Remaining acceptance checks

- Native JPEG uploads and private-repository attachment access have not been exercised live.
- Fork association is covered with mocked API responses, but not a live external contributor PR.
- ARM64 animation conversion beyond GIF has not been exercised in the live matrix.
- Other applications and fonts need their own tape assertions and visual review.
