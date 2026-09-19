# Betamax Action

[Betamax](https://github.com/joshka/betamax) records terminal applications as screenshots,
animations and video. A tape is a text script describing commands, key presses and waits. This
action runs tapes in CI and publishes the recordings in a pull request comment.

`joshka/betamax-action` renders tapes and uploads media. `joshka/betamax-action/report` updates one
bot comment with gallery links or optional inline attachments.

The split protects reporting credentials from PR-controlled code. Tapes execute arbitrary shell
commands, so a contributor could modify a tape to steal credentials or change repository contents if
rendering had write access. Rendering therefore runs in a read-only PR job without secrets.
Reporting runs separately on a fresh runner with trusted code and write access, without checking out
or executing PR code.

Both actions target GitHub.com and Ubuntu 24.04 GitHub-hosted runners, on x64 or ARM64. There is no
stable `v1` tag yet; the examples pin a reviewed commit.

- [Rendering inputs](#rendering-inputs) and [outputs](#rendering-outputs)
- [Reporting inputs](#reporting-inputs) and [outputs](#reporting-outputs)
- [Workflow configuration](#workflow-configuration)
- [Configuration details](#configuration-details)
- [Formats, limits and failures](#formats-limits-and-failures)
- [Troubleshooting](#troubleshooting)

## Rendering inputs

`joshka/betamax-action` runs the selected tapes with Betamax and records them in the requested
formats. By default, it downloads a checksum-verified Betamax release and installs fonts and ffmpeg.
The application can be built in an earlier workflow step or by commands in the tape.

The action uploads an HTML gallery, individual media files and diagnostic logs as workflow
artifacts, and links the gallery in the job summary. The separate report action publishes these
results to the PR comment.

| Input                  | Default            | Behavior                                                                         |
| ---------------------- | ------------------ | -------------------------------------------------------------------------------- |
| `tapes`                | `**/*.tape`        | Newline-separated paths or globs; `!` excludes matches.                          |
| `working-directory`    | `.`                | Directory inside the checkout for CLI execution and relative paths.              |
| `formats`              | `gif,png`          | Comma-separated preview formats: `gif`, `png`, `webp`, `mp4`, `webm`.            |
| `extra-outputs`        | Empty              | Newline-separated globs for additional media, relative to the working directory. |
| `binary`               | Empty              | Local executable path; overrides release version and checksum.                   |
| `version`              | `0.1.20`           | Release version; ignored when `binary` is set.                                   |
| `sha256`               | Bundled for 0.1.20 | Release archive digest; ignored when `binary` is set.                            |
| `install-dependencies` | `true`             | Install ffmpeg and DejaVu, JetBrains Mono and Noto fonts with apt.               |
| `timeout-seconds`      | `120`              | Time limit for each tape; 1–1800.                                                |
| `retention-days`       | `14`               | Requested retention, 1–90 days, capped by repository policy.                     |
| `comment-key`          | `betamax`          | Shared identifier for rendering and reporting.                                   |
| `variant`              | `default`          | Unique matrix job identifier.                                                    |

Rendering identifiers (`comment-key` and `variant`) contain 1–40 lowercase letters, digits or
hyphens and begin with a letter or digit.

`sha256` checks the downloaded release archive. For a version without a bundled checksum, supply its
archive's SHA-256. `binary` bypasses the download and ignores both release settings.

## Rendering outputs

| Output             | Meaning                                           |
| ------------------ | ------------------------------------------------- |
| `output-directory` | Local directory containing media and diagnostics. |
| `artifact-url`     | HTML gallery artifact link.                       |
| `artifact-id`      | Numeric gallery artifact ID.                      |
| `tapes-passed`     | Number of tapes that exited successfully.         |
| `tapes-failed`     | Number of tapes that failed or timed out.         |

## Reporting inputs

`joshka/betamax-action/report` runs on `workflow_run` after a PR render workflow completes. It
selects that run's artifacts, checks that the PR head is still current, and creates or updates one
Actions bot comment. Matrix results appear together in the same comment.

By default, the comment links to gallery artifacts using `GITHUB_TOKEN`. Attachment mode uploads
media for inline display and requires a separate user token. Reporting runs with reviewed code on a
fresh runner, without checking out or executing PR code.

| Input              | Default               | Behavior                                                                             |
| ------------------ | --------------------- | ------------------------------------------------------------------------------------ |
| `workflow`         | Required              | Source workflow filename, for example `betamax.yml`.                                 |
| `comment-key`      | `betamax`             | Identifies the comment to create or update.                                          |
| `artifact-key`     | Same as `comment-key` | Render action key whose artifacts are selected.                                      |
| `mode`             | `artifacts`           | `artifacts` links galleries; `attachments` displays images and video in the comment. |
| `token`            | `${{ github.token }}` | Built-in token with Actions read and PR write permissions.                           |
| `attachment-token` | Empty                 | User token used only to upload attachments.                                          |

Leave `token` at its default so the Actions bot owns the comment. Use separate `comment-key` values
for independent workflows. Matrix jobs within one workflow share a key. `artifact-key` lets a report
use a different comment key while selecting the render action's artifacts.

## Reporting outputs

| Output        | Meaning                                                                       |
| ------------- | ----------------------------------------------------------------------------- |
| `comment-url` | URL of the comment created or updated. Unset when the reporter skips the run. |

## Workflow configuration

The render workflow runs on `pull_request` with `contents: read`. This example builds the
application in an earlier step. Tapes execute with the job's privileges, so the job requires a fresh
runner and no secrets or write credentials.

Example `.github/workflows/betamax.yml`:

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
    timeout-minutes: 15
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # Install your application's toolchain and build it here.
      - uses: joshka/betamax-action@46a3673d7a5dd7696b862848cb7e9902d797094d
        with:
          tapes: demos/**/*.tape
          formats: gif,png,webp
```

The report workflow resides on the default branch and runs on `workflow_run`. Its trigger selects
the render workflow by name; the `workflow` input identifies its filename. The concurrency group
serializes comment updates for a PR branch. The reporter must not check out PR code or restore PR
caches.

Example `.github/workflows/betamax-report.yml`:

```yaml
name: Betamax report
on:
  workflow_run:
    workflows: [Betamax]
    types: [completed]
permissions: {}
concurrency:
  group:
    betamax-report-${{ github.event.workflow_run.head_repository.id }}-${{
    github.event.workflow_run.head_branch }}
  cancel-in-progress: false
jobs:
  report:
    if: github.event.workflow_run.event == 'pull_request'
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    permissions:
      actions: read
      pull-requests: write
    steps:
      - uses: joshka/betamax-action/report@46a3673d7a5dd7696b862848cb7e9902d797094d
        with:
          workflow: betamax.yml
```

New commits update the same bot comment. Closed PRs, superseded heads and older run attempts are
skipped. Fork PRs can receive comments after rendering completes, subject to repository approval
policy for contributor workflows.

In the default `artifacts` mode, the comment and render job summary link to a downloadable HTML
gallery with embedded media. Individual media files are also available as artifacts. Downloads
require GitHub sign-in and repository access, and expire under the repository's retention policy.
See an
[example gallery comment](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738617709).

## Configuration details

### Tape execution and paths

Building the application in a separate workflow step keeps build time outside each tape's timeout
and reports build failures directly in CI. Multiple tapes can then record different behaviors of the
same executable without repeating the build.

A tape can also build the application: hide recording, run the build, wait for completion, clear the
terminal, launch the application, wait for its ready state, then show recording. In that case, build
time counts toward the tape's timeout, and the tape must detect build failures as well as successful
completion.

The action adds output directives for `formats` without modifying the checked-in tape. Tape-declared
output paths are relative to `working-directory`.

GitHub Actions normally runs shell steps in `GITHUB_WORKSPACE`, where `actions/checkout` places the
repository. By default, the shell inside a Betamax tape starts in the runner user's home directory
instead. Unless shell startup commands change that directory, commands such as `cargo build` or
`./target/debug/my-app` run outside the checkout and cannot find the project or its executable.

The action sets `BETAMAX_WORKING_DIRECTORY` to the absolute path selected by its `working-directory`
input, which defaults to the checkout root. This input controls tape discovery and output paths; it
does not change the tape shell's initial directory. Before running project-relative commands, change
directory inside the tape:

```text
Type@0ms "cd \"$BETAMAX_WORKING_DIRECTORY\""
Enter
```

### Checkpoints and existing media

`extra-outputs` collects tape checkpoints or media produced by other steps:

```yaml
with:
  tapes: demos/**/*.tape
  formats: gif,webp
  extra-outputs: |
    target/review/**/*.png
    target/review/**/*.jpg
```

Use a fresh output directory. The action collects matching files after rendering, including files
left by an earlier run.

### Matrix jobs

Each render job needs a unique `variant` and the same `comment-key` across the matrix. For example,
`variant: ${{ matrix.os }}` distinguishes jobs whose `matrix.os` values are `linux` and `linux-arm`.
Each variant allows one render action invocation. One report job publishes all variants after the
workflow completes.

Partial reruns retain older galleries for jobs that did not rerun, with attempt labels. Rerunning
all jobs refreshes every preview together.

### A locally built Betamax CLI

`binary` selects an executable built or installed before the render step:

```yaml
- uses: joshka/betamax-action@46a3673d7a5dd7696b862848cb7e9902d797094d
  with:
    binary: target/debug/betamax
    tapes: demos/**/*.tape
    formats: gif,png
```

The path may be relative to `working-directory` or absolute within it. It must name an executable
file and contain no symlink components. Spaces are allowed; shell arguments, `~`, environment
variable expansion and `PATH` lookup are not. Invalid paths fail before dependency installation,
without falling back to a release.

The executable must accept `run --quiet -` and support the requested formats. It overrides `version`
and `sha256`. Fonts and ffmpeg are still installed unless `install-dependencies: false`. A PR-built
CLI can compromise its runner. Keep secrets out of every step of the render job and publish only
through the separate report workflow.

### Fonts and dependencies

The action installs ffmpeg and DejaVu, JetBrains Mono and Noto fonts by default. To choose fonts,
install them before the action and set `Set FontFamily` in the tape. Runner images can still produce
different rendering results. Set `install-dependencies: false` if earlier steps provide the fonts
and ffmpeg. The action does not cache installations.

### Inline attachments

Set `mode: attachments` on the report action to show media inline. This requires a repository-scoped
user token stored as an environment secret, with that environment restricted to your trusted default
branch. Keep `token` at its default and pass the user token only through `attachment-token`.

```yaml
with:
  workflow: betamax.yml
  mode: attachments
  attachment-token: ${{ secrets.BETAMAX_ATTACHMENT_TOKEN }}
```

The report job must also specify `environment: betamax-attachments`. The
[attachment guide](docs/attachments.md) covers token provisioning and environment branch rules. The
render job must not receive this token.

Attachments have a separate lifetime from Actions artifacts; updating a comment does not delete old
attachments. Public-repository attachments are visible without sign-in. Private-repository access
has not been verified by this project's live tests.

## Formats, limits and failures

### Formats and file discovery

`formats` accepts PNG, GIF, WebP, MP4 and WebM. JPEG is accepted only through `extra-outputs`. SVG
and HTML are not accepted as media. Betamax renders requested formats directly, without a GIF
conversion fallback. WebP requires Betamax 0.1.18 or a compatible local build. Older binaries must
support every requested format; unsupported or missing output fails the capture.

Tape and extra-output globs are relative to `working-directory`. Tape discovery excludes `.git`,
`.jj`, `node_modules`, `target`, `dist`, `vendor` and `.artifacts`; extra outputs can come from
those build directories. Matches are sorted and deduplicated. Paths outside the working directory
and symlinks are rejected.

Tape basenames become attachment captions: `input-and-keys.tape` becomes "Input and keys". Extra
outputs use their filename stem. Gallery captions show the full relative path. Use distinct,
descriptive basenames for distinct captions.

### Limits and diagnostics

Each render invocation accepts at most 20 tapes and 20 media files, with a limit of 10 MiB per file
and 40 MiB of media in total. Attachment mode applies the same file count and byte limits across all
selected matrix variants. Reduce `formats` or narrow `extra-outputs` if you exceed them.

After a tape fails or times out, the action runs the remaining tapes and uploads available media
before failing the step. Setup and discovery failures stop rendering. Diagnostics contain process
logs, capped at 1 MiB each. A timeout may prevent final animations from being written; checkpoint
screenshots can still be collected with `extra-outputs`. Keep a job-level `timeout-minutes` as well.

## Troubleshooting

| Problem                             | What to check                                                                                                                                                                                                                                            |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No PR comment                       | Put the report workflow on the default branch. Match its trigger to the render workflow's name and its `workflow` input to the filename. Check `actions: read`, `pull-requests: write`, and the report log. Closed PRs and superseded heads are skipped. |
| No tapes or media                   | Check globs, `working-directory`, excluded directories, and the preceding application build. Download the diagnostics artifact for command failures.                                                                                                     |
| Gallery link no longer works        | Sign in with repository access. If artifacts expired or were deleted, rerun rendering for the current PR head. Adjust `retention-days` within repository policy.                                                                                         |
| Some inline attachments are missing | Check report warnings, token permissions and media limits. Fix the problem and rerun the render workflow. Rerunning only the reporter does not retry an already published attempt.                                                                       |

A successful tape can still contain visual errors. Inspect recordings and keep application
assertions alongside them.

## Contributing and security

- [Local setup and checks](CONTRIBUTING.md)
- [Architecture and maintenance](docs/development.md)
- [Security model and vulnerability reporting](SECURITY.md)
