# Security

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Avoid posting token
values, signed artifact URLs, or exploit payloads in public issues.

## Execution boundary

A tape is executable code. Run it on an ephemeral GitHub-hosted runner using the `pull_request`
event, `contents: read`, no secrets, and checkout with `persist-credentials: false`. Do not run
untrusted tapes on a persistent self-hosted runner. The rendering action rejects `workflow_run` and
`pull_request_target` events.

The reporter runs separately on `workflow_run` with `actions: read` and `pull-requests: write`. Its
action code must be pinned to a reviewed commit. It must never check out PR code, restore a PR
cache, execute a build script, or load modules from the PR workspace. This also applies to extra
steps you add around the action.

The default reporter reads API metadata only. It verifies the source repository, workflow, event,
run attempt, PR head and head repository. It locates its comment by marker and bot author. Artifact
names cannot specify a PR number, comment body or destination URL.

## PR-built executables

A local `binary` is fully untrusted, including when it came from a successful build or a path inside
the checkout. Path and executable-bit checks catch configuration mistakes; they are not a sandbox or
a provenance check. The build or executable can compromise every step and process on its runner,
modify the action's code, forge media, or replace validation results.

Build and execute PR code only in a no-secrets, read-only `pull_request` job on an ephemeral runner.
Never expose a PAT in that job, including in a later step. Publishing must use a separate
`workflow_run` job on a fresh runner with pinned reporter code, no PR checkout, no PR executable
download or execution, and no restored PR cache.

Gallery reporting independently validates API metadata and does not download media. Native reporting
independently checks the downloaded bytes as described below. Neither mode trusts a manifest or
validation result from the build/render runner as proof that its artifacts are safe.

## Optional native uploads

Native mode introduces a user token and untrusted media bytes into the reporter. The token is sent
only to `uploads.github.com`; comment API calls continue to use the Actions token. The reporter
follows artifact redirects only to approved GitHub/Azure storage hosts, without forwarding a token,
and rejects further redirects. It verifies the artifact digest, enforces byte limits and checks
media signatures. It never extracts archives. These checks constrain the upload path; they do not
establish that attacker-controlled media is harmless to every downstream decoder.

Use an environment approval gate if your repository requires review before media from a fork is
published with a user credential. See [native attachment setup](docs/attachments.md).

## Dependency and release policy

Workflow dependencies use full commit SHAs. Dependabot groups routine updates and waits seven days
before proposing new versions. Downloaded Betamax releases have a checked archive digest; local
executables bypass that check. The action's runtime JavaScript is bundled in `dist/`; CI rebuilds it
and rejects drift from source.

The repository runs actionlint and zizmor during development. CI runs zizmor and tests the
reporter's permission boundaries with mocked API responses. The live demo workflow exercises
rendering and artifact uploads. Passing a capture test does not establish visual correctness or
sandbox a tape.

Repository administrators should require reviewed changes to actions, workflows, dependencies and
bundles before moving a stable action tag. CODEOWNERS identifies the maintainer; enforcement
requires a branch rule or ruleset.

## References

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Workflow run permissions and risks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
