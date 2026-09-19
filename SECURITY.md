# Security

## Report a vulnerability

Use GitHub's private vulnerability reporting for this repository when available. Avoid posting token
values, signed artifact URLs, or exploit payloads in public issues.

## Execution boundary

PR-controlled tapes, action code, build scripts and local executables are executable code. Even a
released Betamax binary does not make the rendering runner trusted. Run it on an ephemeral
GitHub-hosted runner using the `pull_request` event, `contents: read`, no secrets, and checkout with
`persist-credentials: false`. Do not run untrusted tapes on a persistent self-hosted runner. The
rendering action rejects `workflow_run` and `pull_request_target` events.

The reporter runs separately on `workflow_run` with `actions: read` and `pull-requests: write`. Its
action code must be pinned to a reviewed commit. It must never check out PR code, restore a PR
cache, execute a build script, or load modules from the PR workspace. This also applies to extra
steps you add around the action.

The default reporter reads API metadata only. It verifies the source repository, workflow, event,
run attempt, PR head and head repository. It locates its comment by marker and bot author. Artifact
names cannot specify a PR number, comment body or destination URL.

A PR-built executable can compromise every step on its runner, including later steps, and forge
media or validation results. Path checks and a successful build do not make it trusted. Neither
reporting mode accepts a render manifest as authorization or proof that an artifact is safe.

## Attachment uploads

Attachment mode introduces a user token and untrusted media bytes into the reporter. The token is
sent only to `uploads.github.com`; comment API calls continue to use the Actions token. The reporter
follows artifact redirects only to approved GitHub/Azure storage hosts, without forwarding a token,
and rejects further redirects. It verifies the artifact digest, enforces byte limits and checks
media signatures. It never extracts archives.

A matching digest confirms that the downloaded bytes match the uploaded artifact. The artifact can
still contain malicious media. Signature checks inspect only magic bytes; they do not decode or
sanitize the file. Polyglots, malformed payloads and decoder vulnerabilities remain possible. PR
code can also forge validation results on the render runner, so the reporter performs its own
checks.

Store the repository-scoped attachment PAT only in a dedicated environment restricted explicitly to
the trusted default branch, with no wildcard or tag rules. Remove any repository-level copy after
confirming the environment secret exists. Only the pinned reporter on a fresh runner receives it;
comments continue to use `GITHUB_TOKEN`. Environment restrictions do not isolate workflows from
other trusted default-branch workflows or repository administrators. Add required reviewers if your
repository requires approval before publishing fork media. See
[inline attachment setup](docs/attachments.md).

## Dependency and release policy

Workflow dependencies use full commit SHAs. Downloaded Betamax releases have a checked archive
digest; local executables bypass that check. The action's runtime JavaScript is bundled in `dist/`;
CI rebuilds it and rejects drift from source.

Repository administrators should require reviewed changes to actions, workflows, dependencies and
bundles before moving a stable action tag. CODEOWNERS identifies the maintainer; enforcement
requires a branch rule or ruleset.

## References

- [GitHub secure use reference](https://docs.github.com/en/actions/reference/security/secure-use)
- [Workflow run permissions and risks](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run)
