# Enable native attachments

Native attachments place images and video directly in the PR comment. Gallery mode works without
extra secrets and remains the default.

GitHub's Actions token cannot upload native attachments. GitHub CLI's current uploader accepts user
OAuth tokens, classic PATs and fine-grained PATs, and rejects GitHub App tokens. Giving
`GITHUB_TOKEN` more permissions does not change its token type.

## Configure a user token

1. Create a dedicated user token restricted to the target repository. The account must have write
   access to that repository. For a fine-grained PAT, begin with repository Contents write
   permission and confirm upload access with your organization's token policy. The upload endpoint
   is not a stable, separately documented REST API; its exact minimum permissions need verification
   in your repository.
1. Save it as an Actions secret named `BETAMAX_ATTACHMENT_TOKEN`, preferably in an environment with
   required reviewers. Set that environment on the report job if used.
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

## Compare both modes on one PR

Use two report steps to keep a gallery-link comment and a native-attachment comment. Both read the
same rendered artifacts. `comment-key` identifies the comment; `artifact-key` selects the render
job's `comment-key` and defaults to the report's own key when omitted.

```yaml
steps:
  - name: Gallery links
    uses: joshka/betamax-action/report@REPORT_COMMIT_SHA
    with:
      workflow: betamax.yml
      comment-key: betamax
  - name: Native attachments
    uses: joshka/betamax-action/report@REPORT_COMMIT_SHA
    with:
      workflow: betamax.yml
      comment-key: betamax-native
      artifact-key: betamax
      mode: attachments
      attachment-token: ${{ secrets.BETAMAX_ATTACHMENT_TOKEN }}
```

Replace `REPORT_COMMIT_SHA` with a reviewed commit that includes `artifact-key`. Keep both steps in
one trusted report job with the permissions and concurrency group from the
[setup guide](getting-started.md#update-the-pr-comment). Do not rerun the application or give the
render job a PAT. Each reporter updates only its own bot comment, including on later commits and
partial reruns.

## Upload behavior

The reporter downloads individual raw media artifacts into memory, checks their recorded SHA-256
digests and file signatures, and uploads them to the same endpoint used by GitHub CLI 2.101.0. It
never extracts ZIP files or executes downloaded content. It updates the exact comment ID selected by
marker and bot author; it does not use `gh --edit-last`.

PNG, GIF, WebP, JPEG, MP4 and WebM are accepted. Every file is limited to 10 MiB, including video,
to work with free GitHub plans. Total limits are 20 files and 40 MiB per report. Files that fail to
upload retain a link to the Actions artifact. GitHub can reject uploads because of token access,
organization policy, media validation or rate limits.

Public-repository attachments can be viewed without authentication. Attachments on private or
internal repositories require repository access. Unlike Actions artifacts, these URLs are not tied
to the workflow artifact retention period. The action does not delete old attachments when it
updates a comment.

This mode needs a live test with your configured secret before relying on it. Automated tests cover
credential routing, digest validation, size limits, media filtering and comment updates. They cannot
prove that GitHub will accept a particular account's token.

## Sources

- [GitHub CLI uploader](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client.go)
- [GitHub CLI token rejection tests](https://github.com/cli/cli/blob/v2.101.0/internal/attachments/client_test.go)
- [GITHUB_TOKEN identity](https://docs.github.com/en/actions/concepts/security/github_token)
- [GitHub attachment access and limits](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files)
