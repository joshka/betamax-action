# Betamax Action

Render [Betamax](https://github.com/joshka/betamax) terminal tapes in GitHub Actions and update one
pull request comment with the results.

The default comment links to an HTML gallery with GIF, PNG, WebP and video previews. Galleries
follow the reader's light or dark theme. Each media file is also available as an individual
artifact. Generated media stays out of your repository.

Native inline images and video are optional. GitHub currently requires a user token for those
uploads; the built-in Actions token can publish gallery links without an additional secret.

## Get started

Add the [render and report workflows](docs/getting-started.md) to your repository. Put your normal
application setup and build steps before the rendering action. The example in this repository builds
[a small Ratatui app](examples/ratatui/src/main.rs) and records it in an Ubuntu matrix.

```yaml
- uses: joshka/betamax-action@161ef25dd72448bfc93428e89a38b0af7163d515
  with:
    tapes: demos/**/*.tape
    formats: gif,png,webp
```

Pin both actions to the same reviewed commit. This project is being tested before its first stable
release; there is no `v1` tag yet.

## Documentation

- [Set up previews and PR comments](docs/getting-started.md)
- [Inputs, outputs and supported formats](docs/reference.md)
- [Enable native attachments](docs/attachments.md)
- [Permissions and untrusted tapes](SECURITY.md)
- [Develop and test the action](CONTRIBUTING.md)

Ubuntu 24.04 x64 and ARM64 are the supported rendering platforms. The reporter supports GitHub.com.
