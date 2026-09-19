# Set up terminal previews

A render workflow records your application with read-only repository access. A separate report
workflow updates the PR comment with write access, without executing the PR's code. This separation
allows previews from fork PRs without giving those PRs a write token.

The default setup links to downloadable HTML galleries and needs no extra secret. To place media
inline in comments, first get this setup working, then [enable native attachments](attachments.md).

## Before you start

Use GitHub.com and Ubuntu 24.04 GitHub-hosted runners (x64 or ARM64). You need a command that builds
your application and a tape that runs it without interactive setup. A tape is a Betamax script that
types commands, waits for output and records the terminal.

Follow these steps:

1. [Prepare a tape](#run-application-commands-in-the-checkout).
1. [Add the render workflow](#render-pull-requests).
1. [Add the report workflow](#update-the-pr-comment).
1. [Verify the first preview](#verify-the-first-preview).

## Run application commands in the checkout

Create or adapt a tape that starts your application and waits for a visible ready state. For
example, save this as `demos/preview.tape`, replacing the executable and `Ready` text with your
application's command and expected output. The render workflow below must build that executable
first.

The action sets `BETAMAX_WORKING_DIRECTORY` to the selected working directory. Betamax 0.1.15 starts
its shell in the user's home directory, so change directory in the tape before running relative
commands:

```text
Set Shell "bash"
Hide
Type@0ms "cd \"$BETAMAX_WORKING_DIRECTORY\""
Enter
Type "./target/debug/my-app"
Enter
Wait+Screen "Ready"
Show
Sleep 2s
```

Keep `Require`, `Env` and `Set` commands before runtime commands. The action adds preview output
commands in memory; it does not rewrite your checked-in tape. Tape-declared output and checkpoint
paths remain relative to `working-directory`. Programs installed on `PATH` do not need the directory
change unless they read relative files.

## Render pull requests

Create `.github/workflows/betamax.yml`. Add your application's setup and build steps at the marked
location, and change `tapes` to match your tape files. The example pins a tested action commit.

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
      - uses: joshka/betamax-action@23bc495e75ddd3c0997cf7a1bf80db1c22bbb53b
        with:
          tapes: demos/**/*.tape
          formats: gif,png,webp
```

The action installs a checksum-verified Betamax binary, fonts and ffmpeg. You only need to provide
your application's toolchain and build steps.

Use fresh GitHub-hosted runners for untrusted pull requests. Tapes execute commands with the
rendering job's privileges. Do not put secrets or write permissions in that job.

## Update the PR comment

Create `.github/workflows/betamax-report.yml` using the same action commit. **This workflow must be
on your default branch before GitHub will run it.** It publishes comments without checking out or
executing PR code. Keep its permissions and concurrency group as shown.

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
      - uses: joshka/betamax-action/report@23bc495e75ddd3c0997cf7a1bf80db1c22bbb53b
        with:
          workflow: betamax.yml
```

The trigger's `workflows: [Betamax]` matches the render workflow's `name`. The action's
`workflow: betamax.yml` matches its filename. If you rename either, update the corresponding value.
The concurrency group prevents simultaneous reporters from creating duplicate comments.

New commits update the same bot comment. Closed PRs, superseded PR heads and older run attempts are
ignored. Fork PRs can receive comments after their rendering workflow completes; repository policy
may require approval before a contributor's render job can run.

## Verify the first preview

Once both workflows are configured:

1. Merge the report workflow into your default branch so GitHub can trigger it.
1. Open a PR or push a new commit to an existing PR. Approve the render run if repository policy
   requires it.
1. Wait for the **Betamax** render workflow and **Betamax report** workflow to finish.
1. Find the **Terminal previews** bot comment. Follow its gallery link, download the HTML file and
   open it in your browser. Artifact downloads require GitHub sign-in and repository access.
1. Push another commit to confirm that the same comment updates.

The render job also links the gallery in its job summary. Galleries embed their media and need no
separate server. They expire with the workflow artifacts; [native attachments](attachments.md) have
a different lifetime. For an example of the output, see the
[demo PR comment](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738617709).

## Collect checkpoints and existing media

After [setting up rendering](#render-pull-requests), add `extra-outputs` to the render action's
`with` block to collect tape-declared checkpoints or existing media. These files are included
alongside the previews generated by `formats`:

```yaml
with:
  tapes: demos/**/*.tape
  formats: gif,webp
  extra-outputs: |
    target/review/**/*.png
    target/review/**/*.jpg
```

Use a fresh output directory in CI. Extra files are collected as they exist after rendering; the
action does not infer whether a file came from an earlier local run.

## Add a matrix

For a [render workflow](#render-pull-requests) with a job matrix, give every rendering job a unique
`variant`, such as `linux` and `linux-arm`. All jobs share the same `comment-key`, and one reporter
publishes their galleries after the workflow finishes. Limit each workflow to one rendering action
invocation per variant.

On a partial rerun, variants that did not rerun retain their previous gallery with an explicit
attempt label. Rerun all jobs when you need every preview from the same attempt.

See the [repository's matrix workflow](../.github/workflows/betamax.yml) for x64 and ARM64 examples.

## Troubleshoot previews

### No PR comment appears

Check that the report workflow is on the default branch and that its trigger name and `workflow`
filename match the render workflow. Then check the report run's log. An old PR head or closed PR is
intentionally skipped. For permission errors, check the report job's `actions: read` and
`pull-requests: write` permissions and organization policy; keep the render job read-only.

### No tapes or preview files are found

Tape globs are relative to `working-directory`, which defaults to the checkout root. Tape discovery
excludes build directories such as `target`; `extra-outputs` can collect media from them. Check the
[discovery rules](reference.md#file-discovery-and-paths), the job log and any diagnostics artifact
from the failing run. If a command cannot find the application, check the tape's
[working-directory setup](#run-application-commands-in-the-checkout) and the preceding build step.

### A gallery link no longer works

Sign in to GitHub with access to the repository. If its artifacts have expired or been deleted,
rerun the render workflow for the current PR head to publish fresh links. Configure the render input
`retention-days` within your repository's allowed retention period.

For native upload failures, see
[attachment failures and retries](attachments.md#failures-and-retries).
