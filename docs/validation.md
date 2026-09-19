# Validation notes

The action is in its initial integration phase. These checks establish the behavior below; they do
not make the native upload endpoint a supported GitHub REST API.

## Automated checks

[CI](https://github.com/joshka/betamax-action/actions/runs/35420275141) passes 40 tests, JavaScript
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
video timing upstream. Betamax 0.1.18 adds native WebP, removing the remaining GIF conversion. See
the [format tradeoffs](reference.md#supported-formats).

The [0.1.17 integration run](https://github.com/joshka/betamax-action/actions/runs/35418745511)
passes the same dimension and duration assertions with native MP4/WebM output. Its
[reporter run](https://github.com/joshka/betamax-action/actions/runs/35418824523) also passes
gallery and native-attachment publication.

## Native WebP

The [0.1.18 integration run](https://github.com/joshka/betamax-action/actions/runs/35420275147)
passes native GIF/PNG/WebP on x64 and ARM64, MP4/WebM on x64, and WebP-only rendering through the
local-executable input. Each tape directory contains exactly the requested formats; the local job
produces no GIF intermediate. Checkpoint collection also passes.

Pillow independently decodes each WebP: five changing frames, 534 opaque colors, 780 × 350 pixels,
and a final-frame hold of 1019–1020 ms. Total playback remains within 2.4–2.7 seconds. On both
architectures, the final WebP frame matches the native PNG's opaque pixels exactly. These checks
catch palette reduction, frozen animation, missing outputs and a dropped final hold.

The [trusted reporter](https://github.com/joshka/betamax-action/actions/runs/35420338087) publishes
four [gallery links](https://github.com/joshka/betamax-action/pull/5#issuecomment-5739231944) and
all 13
[native attachments](https://github.com/joshka/betamax-action/pull/5#issuecomment-5739233701),
including the three native WebP captures, without upload fallbacks.

The default selects
[Betamax 0.1.18](https://github.com/joshka/betamax/releases/tag/betamax-v0.1.18). Both Linux
archives were downloaded and hashed against GitHub's published release asset digests before changing
the default:

| Target                    | SHA-256                                                            |
| ------------------------- | ------------------------------------------------------------------ |
| x86_64-unknown-linux-gnu  | `c04bc6716963d7d5158fa0504049776bb0acab693335fbfbd9e393b87a297143` |
| aarch64-unknown-linux-gnu | `beb6abcd40a400fbad14b8ee418efa790710ce7fdc4093614044d009669e7f56` |

Tests cover unsupported and silently missing native WebP output. Older explicitly selected binaries
receive the requested output unchanged and fail visibly; see the
[format policy](reference.md#supported-formats).

## Local executable selection

The
[local-binary job](https://github.com/joshka/betamax-action/actions/runs/35419537426/job/105834460682)
invokes an executable inside the checkout and passes the same GIF/PNG dimension and duration checks.
It deliberately supplies an invalid release version and checks an invocation marker, proving that
`binary` is selected rather than a downloaded fallback. This fixture wraps a verified release;
consumers build their own CLI as shown in the [local-binary example](local-binary.md).

Tests also cover literal paths with spaces, path rejection before setup, ignored release settings,
download bypass, explicit dependency setup and the checksum-verified release default on Linux.

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
- Other applications and fonts need their own tape assertions and visual review.
