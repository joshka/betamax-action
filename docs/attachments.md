# Enable native attachments

Native attachments place images and video directly in the PR comment. Gallery mode works without
extra secrets and remains the default.

Before enabling this mode, set up the [render and report workflows](getting-started.md). The
examples below modify the report job on your default branch. GitHub requires a user token for native
uploads; increasing `GITHUB_TOKEN` permissions does not enable them.

## Configure a user token

For the existing [report job](getting-started.md#update-the-pr-comment), configure a separate token
for uploads. Leave the comment API token at its default, `${{ github.token }}`.

1. Create a dedicated user token restricted to the target repository. The account must have write
   access to that repository. For a fine-grained PAT, begin with repository Contents write
   permission. This configuration passed the live test in `joshka/betamax-action`; it is not a
   proven minimum. Organization policies may impose additional approval requirements. The endpoint
   is not a stable, separately documented REST API.
1. Create a dedicated environment named `betamax-attachments`. Under **Deployment branches and
   tags**, select **Selected branches and tags**, then add a **Branch** rule for your exact trusted
   default branch (`main` in this repository). Do not add wildcard or tag rules. Selecting
   **Protected branches only** is not equivalent to restricting access to the default branch.
1. Save the token only as an environment secret named `BETAMAX_ATTACHMENT_TOKEN`. Set
   `environment: betamax-attachments` on the trusted `workflow_run` report job. Keep that workflow
   on the default branch and pin the reporter to a reviewed commit. Required reviewers are an
   optional additional gate before publishing untrusted media.
1. If migrating a repository secret, enter its value directly in GitHub's environment settings;
   GitHub cannot reveal the existing value. Verify the environment secret exists, then remove the
   repository copy. A same-named environment secret overrides a repository secret, so a successful
   upload alone does not prove the repository copy is gone. Never put the token in chat or logs.
1. Add these inputs to the report step on the default branch:

   ```yaml
   with:
     workflow: betamax.yml
     mode: attachments
     attachment-token: ${{ secrets.BETAMAX_ATTACHMENT_TOKEN }}
   ```

Keep `token` at its default. The Actions bot owns and updates the comment; the user token is sent
only to GitHub's native upload endpoint. Never provide this secret to the render job or a
`pull_request_target` workflow that executes PR code.

## Verify isolation

In this repository, `.github/workflows/betamax-report.yml` uses `betamax-attachments` and checks
`github.ref == 'refs/heads/main'`. The environment must independently allow only the `main` branch:
workflow conditions alone cannot protect a repository-level secret from a modified PR workflow.
GitHub runs `workflow_run` using default-branch workflow configuration. The environment restriction
is not a workflow allowlist; trusted default-branch workflows and administrators remain trusted.

After merging the workflow change and confirming the environment secret exists, remove the
repository-level copy before running the live check. Rerun the render workflow for a current PR head
and check that **Betamax report** creates native attachment URLs without upload warnings. Confirm
the comment author is `github-actions[bot]`. The render and build jobs must have no environment or
user secrets, read-only permissions, and checkout `persist-credentials: false`. Never reuse a token
scoped to another repository.

## Compare both modes on one PR

First [configure the upload secret](#configure-a-user-token). Replace the steps in your existing
[report job](getting-started.md#update-the-pr-comment) with the following two steps, keeping that
job's permissions and workflow concurrency group.

Use two report steps to keep a gallery-link comment and a native-attachment comment. Both read the
same rendered artifacts. `comment-key` identifies the comment; `artifact-key` selects the render
job's `comment-key` and defaults to the report's own key when omitted.

```yaml
steps:
  - name: Gallery links
    uses: joshka/betamax-action/report@46a3673d7a5dd7696b862848cb7e9902d797094d
    with:
      workflow: betamax.yml
      comment-key: betamax
  - name: Native attachments
    uses: joshka/betamax-action/report@46a3673d7a5dd7696b862848cb7e9902d797094d
    with:
      workflow: betamax.yml
      comment-key: betamax-native
      artifact-key: betamax
      mode: attachments
      attachment-token: ${{ secrets.BETAMAX_ATTACHMENT_TOKEN }}
```

Each reporter updates only its own bot comment, including on later commits and partial reruns. The
render job runs once and receives no PAT.

## Supported files and limits

Native mode accepts PNG, GIF, WebP, JPEG, MP4 and WebM from the render action's media artifacts.
Each file is limited to 10 MiB, including video. A report accepts at most 20 files and 40 MiB across
all selected matrix variants. Narrow `formats` or `extra-outputs` in the render job if you exceed
these limits.

## Attachment access and lifetime

Public-repository attachments can be viewed without authentication. Attachments on private or
internal repositories require repository access. Unlike Actions artifacts, attachment URLs are not
tied to workflow artifact retention. Updating a comment does not delete its old attachments.

The built-in Actions bot owns the comment. The upload token is used only to send media to GitHub;
[security guidance](../SECURITY.md#optional-native-uploads) describes credential and download
checks.

## Failures and retries

When an individual native upload fails, the reporter leaves an artifact link in the comment and
writes a warning to its job log. The report step can therefore succeed even when some files were not
attached. Check the comment and warnings when testing a new token.

For authorization errors, check token expiration, selected repository, repository write permission,
and organization approval policy. For media errors, check the file type and size against the
[upload limits](#supported-files-and-limits).

After correcting the problem, rerun the **render workflow** for the current PR head. Rerunning only
the report workflow does not retry an already published run attempt. A new rendering attempt creates
new attachments and updates the same comment.

## Verified configuration

A fine-grained PAT limited to `joshka/betamax-action` with Contents read/write successfully uploaded
GIF, PNG, WebP, MP4 and WebM in the [live test](validation.md#native-attachments). GitHub rendered
the images and video inline in a separate comment. This establishes one working configuration, not
the minimum permissions or private-repository behavior.

The upload endpoint is the one used by GitHub CLI, rather than a stable, separately documented REST
API. Test your own account and repository configuration before relying on it.

## Sources

- [GitHub CLI uploader](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client.go)
- [GitHub CLI token rejection tests](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client_test.go)
- [Environment branch restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments)
- [GITHUB_TOKEN identity](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHub attachment access and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)

<!-- Temporary smoke test for environment-isolated native uploads; do not merge. -->
