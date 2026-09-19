# Action reference

Configure `joshka/betamax-action` to render tapes and `joshka/betamax-action/report` to publish
comments. For complete workflows, follow the [setup guide](getting-started.md).

## Rendering inputs

| Input                  | Default            | Behavior                                                              |
| ---------------------- | ------------------ | --------------------------------------------------------------------- |
| `tapes`                | `**/*.tape`        | Newline-separated paths or globs; `!` excludes matches.               |
| `working-directory`    | `.`                | Directory inside the checkout for CLI execution and relative paths.   |
| `formats`              | `gif,png`          | Comma-separated preview formats: `gif`, `png`, `webp`, `mp4`, `webm`. |
| `extra-outputs`        | Empty              | Globs for additional media, relative to the working directory.        |
| `binary`               | Empty              | Local executable path; overrides release version and checksum.        |
| `version`              | `0.1.17`           | Release version; ignored when `binary` is set.                        |
| `sha256`               | Bundled for 0.1.17 | Release archive digest; ignored when `binary` is set.                 |
| `install-dependencies` | `true`             | Install ffmpeg and DejaVu, JetBrains Mono and Noto fonts with apt.    |
| `timeout-seconds`      | `120`              | Time limit for each tape and each animation conversion; 1–1800.       |
| `retention-days`       | `14`               | Requested retention, 1–90 days, capped by repository policy.          |
| `comment-key`          | `betamax`          | Shared identifier for rendering and reporting.                        |
| `variant`              | `default`          | Unique matrix job identifier.                                         |

Rendering identifiers (`comment-key` and `variant`) contain 1–40 lowercase letters, digits or
hyphens and begin with a letter or digit.

## Local executable selection

Use `binary` to exercise changes to Betamax itself before they are released. Leaving it unset uses a
verified release to record your application. See [the local-CLI guide](local-binary.md) for a worked
PR build and the resulting review workflow.

Set the render input `binary` to an executable file relative to `working-directory`, or an absolute
path inside that directory. The file must exist and be executable; directories, paths outside the
working directory and symlinks in any path component are rejected. Build the CLI before the action
runs. Invalid paths fail before dependency installation, without falling back to a release.

This is one literal path: spaces are allowed, but arguments, `~`, environment-variable expansion and
`PATH` lookup are not supported. Use Actions expressions to construct a path when needed. `version`
and `sha256` are ignored when `binary` is nonempty. The `install-dependencies` input still controls
apt installation of ffmpeg and fonts in either mode.

Path checks do not sandbox or verify the executable. A PR-built CLI can compromise the entire
runner; use the [isolated build/render example](local-binary.md) and publish from a separate trusted
job. With no `binary` input, the action downloads and verifies the selected release as before.

## File discovery and paths

The render action resolves tape and extra-output globs relative to `working-directory`. Discovery
sorts and deduplicates matches. It excludes `.git`, `.jj`, `node_modules`, `target`, `dist`,
`vendor` and `.artifacts` when finding tapes. Extra outputs can come from build directories. Paths
outside the working directory and symbolic links are rejected.

## Supported formats and conversion

Betamax renders PNG, GIF, MP4 and WebM directly. MP4 and WebM use the captured frames and their hold
times, with transitions rounded to the tape's output frame rate. They do not pass through GIF or
inherit its palette limitations.

WebP is converted from a GIF capture with ffmpeg because Betamax has no native WebP writer. It
inherits GIF's color palette and uses 30 FPS, rounding frame delays to that cadence. JPEG is
accepted through `extra-outputs`; it is not a generated preview format. SVG and arbitrary HTML are
not accepted as media.

## Fonts and dependencies

The default font installation improves coverage, including CJK fallback, but does not guarantee
identical rendering across runner images. Install your preferred fonts before the action and choose
`Set FontFamily` in the tape. Set `install-dependencies: false` when you manage ffmpeg and fonts
elsewhere. The action does not persist an installation cache. Application caches belong in earlier
consumer workflow steps and must never be restored by the privileged reporter.

## Rendering outputs

| Output             | Meaning                                           |
| ------------------ | ------------------------------------------------- |
| `output-directory` | Local directory containing media and diagnostics. |
| `artifact-url`     | HTML gallery artifact link.                       |
| `artifact-id`      | Numeric gallery artifact ID.                      |
| `tapes-passed`     | Number of tapes that exited successfully.         |
| `tapes-failed`     | Number of tapes that failed or timed out.         |

## Failed captures and diagnostics

The rendering action runs remaining tapes after an execution failure, uploads available evidence,
then fails the step. Setup and discovery failures stop rendering. The job's timeout is the final
limit if a process cannot be stopped or a runner is cancelled. Keep `timeout-minutes` in the
consumer job.

A successful capture proves the tape completed. It does not prove that every rendered pixel is
correct. Final animations may be missing after a timeout; checkpoint screenshots can still be
collected with `extra-outputs`.

## File and log limits

Limits per rendering job: 20 tapes, 20 media files, 10 MiB per file and 40 MiB of media in total.
Use a matrix or fewer formats for larger suites. Logs retain at most 1 MiB per process and are
stored as artifacts rather than printed as workflow commands.

## Gallery access and retention

Each rendering run uploads an unzipped HTML gallery, individual unzipped media files, and a ZIP of
diagnostics. The gallery embeds media as data URLs and needs no external scripts or media server.
GitHub artifact access still requires sign-in and expires under the repository's retention policy.

## Reporting inputs

| Input              | Default               | Behavior                                                             |
| ------------------ | --------------------- | -------------------------------------------------------------------- |
| `workflow`         | Required              | Source workflow filename, for example `betamax.yml`.                 |
| `comment-key`      | `betamax`             | Identifies the comment to create or update.                          |
| `artifact-key`     | Same as `comment-key` | Render action key whose artifacts are selected.                      |
| `mode`             | `artifacts`           | `artifacts` links galleries; `attachments` adds native inline media. |
| `token`            | `${{ github.token }}` | Built-in token with Actions read and PR write permissions.           |
| `attachment-token` | Empty                 | User token for native uploads only.                                  |

## Comment ownership and update behavior

The reporter outputs `comment-url` when it creates or updates a comment. It requires the
`workflow_run` event on GitHub.com and the built-in Actions bot identity for comment ownership. Use
separate comment keys for separate source workflows. Share a key among matrix jobs in one workflow,
not among independent workflows.

## Native upload limits and retries

In the report action, `mode: attachments` requires a separately configured
[user token](attachments.md#configure-a-user-token). Native mode permits at most 20 media files and
40 MiB across the selected matrix variants. A repeated notification for an already published run
attempt does not upload again. A new rendering attempt creates new attachments. Partial native
upload failures leave gallery/artifact links in the comment and warnings in the reporter log. Rerun
the rendering workflow to retry those uploads.
