# Betamax Action

Render [Betamax](https://github.com/joshka/betamax) terminal tapes in GitHub Actions and update one
pull request comment with the results.

The default comment links to a downloadable HTML gallery with GIF, PNG, WebP and video previews.
Galleries follow the reader's light or dark theme. Each media file is also available as an
individual artifact. Generated media stays out of your repository.

Native inline images and video are optional. GitHub currently requires a user token for those
uploads; the built-in Actions token can publish gallery links without an additional secret.

## How it works

One workflow records the application with read-only access. A second workflow updates the PR comment
with write access, without checking out or running PR code. New commits update the same comment.

Use Ubuntu 24.04 GitHub-hosted runners (x64 or ARM64) and GitHub.com. Gallery downloads require
GitHub sign-in and repository access.

## Get started

Add the [render and report workflows](docs/getting-started.md) to your repository. Put your normal
application setup and build steps before the rendering action. The example in this repository builds
[a small Ratatui app](examples/ratatui/src/main.rs) and records it in an Ubuntu matrix.

The rendering step looks like this; the setup guide includes both complete workflows.

```yaml
- uses: joshka/betamax-action@176d2fa74fe3247bdb4dddf834a5f519ecf28c9b
  with:
    tapes: demos/**/*.tape
    formats: gif,png,webp
```

Pin both actions to the same reviewed commit. This project is being tested before its first stable
release; there is no `v1` tag yet.

## Documentation

- [Set up previews and PR comments](docs/getting-started.md)
- [Inputs, outputs and supported formats](docs/reference.md)
- [Troubleshoot previews](docs/getting-started.md#troubleshoot-previews)
- [Enable native attachments](docs/attachments.md)
- [Permissions and untrusted tapes](SECURITY.md)
- [Develop and test the action](CONTRIBUTING.md)
