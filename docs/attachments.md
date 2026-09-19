# Enable inline attachments

Inline attachments display images and video directly in the PR comment. Set up the
[render and report workflows](../README.md#workflow-configuration) first. Only the report workflow
needs changes.

Uploads require a user token; increasing `GITHUB_TOKEN` permissions does not enable them. The action
uses the
[GitHub CLI upload endpoint](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client.go),
which is not a stable, separately documented REST API. Test the configuration with your repository
before relying on it.

## Create the token and environment

1. Create a dedicated user token restricted to your repository. Its account must have write access.
   A fine-grained PAT with Contents read/write worked in this project's
   [public-repository test](https://github.com/joshka/betamax-action/pull/1#issuecomment-5738717951).
   Minimum permissions and private-repository access have not been tested. Your organization may
   require approval.
1. Create an environment named `betamax-attachments`. Under **Deployment branches and tags**, choose
   **Selected branches and tags**, then add a **Branch** rule for your exact default branch. Do not
   add wildcard or tag rules. **Protected branches only** does not restrict access to one branch.
1. Save the token in that environment as `BETAMAX_ATTACHMENT_TOKEN`. Do not save a repository-level
   copy or provide it to the render job. Add required reviewers if you want approval before uploads.

Environment restrictions still trust other workflows on the default branch and repository
administrators. A workflow `if` condition alone cannot protect a repository-level secret from a
modified PR workflow. See
[GitHub's environment restrictions](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

If migrating an existing repository secret, enter its value directly in the environment settings.
GitHub cannot reveal the saved value. Confirm the environment secret exists, then delete the
repository copy. Successful uploads alone cannot confirm deletion because an environment secret with
the same name takes precedence. Never put the token in logs or chat.

## Update the report workflow

Use this as `.github/workflows/betamax-report.yml` on your default branch. If you renamed the render
workflow, adjust `workflows` and `workflow` to match its name and filename. Keep this job on a fresh
runner, with no PR checkout, build steps or restored PR caches.

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
    environment: betamax-attachments
    permissions:
      actions: read
      pull-requests: write
    steps:
      - uses: joshka/betamax-action/report@46a3673d7a5dd7696b862848cb7e9902d797094d
        with:
          workflow: betamax.yml
          mode: attachments
          attachment-token: ${{ secrets.BETAMAX_ATTACHMENT_TOKEN }}
```

Leave `token` at its default. The Actions bot owns the comment, and the user token goes only to the
upload endpoint. Keep the render job read-only and free of secrets, including in later steps.

## Verify the comment

1. Check that the environment allows only your exact default branch and that no repository-level
   copy of the token remains.
1. Merge the report workflow, then rerun rendering for a current PR head.
1. Check that `github-actions[bot]` posts the images or video inline and that the report log has no
   upload warnings. An artifact-link fallback can leave the report step green even when uploads
   fail.

Public-repository attachments are visible without sign-in. Their URLs are independent of Actions
artifact retention, and updating a comment does not delete old attachments. Validate access with
your intended readers when using a private repository.

## Failures and retries

For authorization failures, check token expiration, the selected repository, write permission and
organization approval. For media failures, check the
[formats and limits](../README.md#formats-limits-and-failures): PNG, GIF, WebP, JPEG, MP4 and WebM
are accepted, with at most 20 files and 40 MiB across the matrix and 10 MiB per file.

An individual upload failure leaves an artifact link and a warning. After fixing the problem, rerun
the render workflow for the current PR head. Rerunning only the report workflow does not retry an
already published attempt. Each new rendering attempt creates new attachments.
