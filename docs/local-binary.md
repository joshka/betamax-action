# Test a PR-built Betamax CLI

Changes to Betamax's font fallback, terminal layout or video timing need to be exercised by a CLI
that contains those changes. A downloaded release cannot show what the PR's renderer will produce.

Build the CLI from the PR and use it to record representative tapes. Reviewers can inspect the
resulting images and animations in the PR without building Betamax locally. This connects the
proposed code to visible output; keep PNG/JSON fidelity assertions and playback checks alongside it
to catch failures that visual review may miss.

Choose the executable according to what you are testing:

- **Changes to your terminal application:** leave `binary` unset. A checksum-verified Betamax
  release records the application you build in the render job.
- **Changes to Betamax itself:** build its CLI from the PR and set `binary` to that executable. The
  recordings then exercise the candidate renderer, parser and media writers.

`binary: target/debug/betamax` names a file relative to `working-directory`, which defaults to the
checkout root. It takes precedence over `version` and `sha256`; neither release setting is validated
or used in this mode. The action invokes that executable directly, without parsing shell commands.
See the [path rules](reference.md#local-executable-selection) for absolute paths and symlinks.

## Build and render on the untrusted runner

The following workflow is for a checkout of the Betamax repository. It uses that repository's mise
configuration to provide Zig and builds the PR's CLI before recording `examples/basic.tape`. Save it
as `.github/workflows/betamax.yml`, or adapt these steps into an existing read-only render job.

A PR-built executable can compromise its entire build/render runner. Use an ephemeral GitHub-hosted
runner with no secrets and read-only repository access. **Never provide an attachment PAT in any
step of this job, including steps after rendering.** Path validation is a usability check, not a
sandbox. The [security boundary](../SECURITY.md#pr-built-executables) also applies to the build
tools and build scripts.

```yaml
name: Betamax
on: pull_request
permissions: {}
concurrency:
  group: betamax-${{ github.ref }}
  cancel-in-progress: true
jobs:
  render:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    permissions:
      contents: read
    env:
      CARGO_TARGET_DIR: target
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: dtolnay/rust-toolchain@02cb101ec7c40f2c49e1d9714d64511d8e1b74de # master
        with:
          toolchain: "1.98.1"
      - uses: jdx/mise-action@c2a87611a18de5b3828c5652fe268e992400cb5c # v4.3.0
        with:
          install: true
      - name: Build the PR's CLI
        run: mise exec -- cargo build --locked -p betamax
      - name: Record previews with that CLI
        uses: joshka/betamax-action@46a3673d7a5dd7696b862848cb7e9902d797094d
        with:
          binary: target/debug/betamax
          tapes: examples/basic.tape
          formats: gif,png,mp4,webm
```

Pin the rendering action to a reviewed commit with `binary` support. The action still installs
ffmpeg and fonts by default. If earlier steps already install them, explicitly set
`install-dependencies: false`; selecting a local executable does not disable dependency setup. The
executable must support Betamax's `run --quiet -` interface and the selected output formats.

## Publish from a separate trusted workflow

Use the [report workflow](getting-started.md#update-the-pr-comment) on the default branch. It runs
on a fresh runner with pinned reporter code. Do not check out PR code, download or execute the
PR-built binary, or restore PR caches in that job.

Gallery mode remains the default and requires no extra secret. It validates run, PR and artifact
metadata and links the artifacts without downloading their contents. Treat those artifacts as
untrusted: checks performed on the compromised render runner cannot establish their safety.

Optional [native attachments](attachments.md) need a separately configured, repository-scoped user
token in the trusted report job. That mode independently checks downloaded media digests, signatures
and byte limits before uploading, and never extracts archives. It must not rely on the render job's
checks or manifest as a security decision.
