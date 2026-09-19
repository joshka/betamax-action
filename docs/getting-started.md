# Set up terminal previews

Start with tapes that run your application without interactive setup. Build the application in a
normal workflow step, then let Betamax capture its terminal session.

## Render pull requests

Create `.github/workflows/betamax.yml`. Replace `161ef25dd72448bfc93428e89a38b0af7163d515` with a
reviewed commit from this repository.

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
      - uses: joshka/betamax-action@161ef25dd72448bfc93428e89a38b0af7163d515
        with:
          tapes: demos/**/*.tape
          formats: gif,png,webp
```

No Rust or Zig installation is needed to install Betamax. The action downloads a release binary,
checks its SHA-256 digest, and installs fonts and ffmpeg through Ubuntu's package manager. Your
application may need its own toolchain.

Use fresh GitHub-hosted runners for untrusted pull requests. Tapes execute commands with the
rendering job's privileges. Do not put secrets or write permissions in that job.

## Update the PR comment

Create `.github/workflows/betamax-report.yml` using the same action commit:

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
    permissions:
      actions: read
      pull-requests: write
    steps:
      - uses: joshka/betamax-action/report@161ef25dd72448bfc93428e89a38b0af7163d515
        with:
          workflow: betamax.yml
```

The reporter must be on your default branch before GitHub will trigger it. The trigger uses the
render workflow's display name; the `workflow` input uses its filename. Keep the concurrency group:
it prevents simultaneous reporters from creating duplicate comments.

The reporter has no checkout step. It resolves the source run and PR through the GitHub API and
updates the comment identified by its Betamax marker and bot author. New commits replace the same
comment. Closed PRs, old heads and older run attempts are ignored.

Fork PRs can receive comments after their rendering workflow completes. Your repository's approval
policy may require a maintainer to approve a first-time contributor's workflow run. If GitHub denies
comment creation, check the job permissions and organization policy; do not give the rendering job
write access.

## Run application commands in the checkout

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

## Collect checkpoints and existing media

The action creates each requested preview format for each tape. Include tape-declared screenshots or
other media with `extra-outputs`:

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

Give every rendering job a unique `variant`, such as `linux` and `linux-arm`. All jobs share the
same `comment-key`, and one reporter publishes their galleries after the workflow finishes. Limit
each workflow to one rendering action invocation per variant.

On a partial rerun, variants that did not rerun retain their previous gallery with an explicit
attempt label. Rerun all jobs when you need every preview from the same attempt.
