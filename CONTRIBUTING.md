# Contributing

Use Node.js 24 or newer. The integration fixture also needs Rust; CI pins Rust 1.98.1 and
Node.js 24. The [maintainer guide](docs/development.md) describes the architecture and integration
tests.

## Install and check

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run format:check
npm run lint:md
```

Local tests need no GitHub token. The release-installer test runs only on Linux.

After changing the Ratatui fixture, also run:

```sh
cargo fmt --manifest-path examples/ratatui/Cargo.toml --check
cargo clippy --locked --manifest-path examples/ratatui/Cargo.toml -- -D warnings
```

For workflow changes, install `uv` and `actionlint`, then run:

```sh
uvx zizmor==1.30.1 --no-progress .
actionlint -ignore 'specifying action "\$/" in invalid format'
```

Actionlint 1.7.12 does not recognize GitHub's `$/` self-repository action syntax. The command
suppresses that diagnostic; zizmor 1.30.1 and live CI check the reference.

## Rebuild runtime changes

Consumers execute the committed `dist/` bundles without installing npm dependencies. After changing
runtime JavaScript or dependencies, rebuild and include the bundles, adjacent legal notices and
changed lockfiles:

```sh
npm run build
node scripts/check-dist.mjs
```

Never edit bundles directly. `check-dist.mjs` rebuilds and compares bytes. Run it before an
intentional build to detect stale committed files; after a build, it checks reproducibility.

## Choose integration checks

Changes to formats, installation or artifact uploads need
[live rendering tests](docs/development.md#testing). Reporter changes need local tests first, then
review and deployment before testing with write credentials. Keep those credentials out of PR jobs.

Update the README when inputs, outputs or user-visible behavior change. Run Markdown lint and
formatting checks for documentation edits. Record version-specific results and run links in the PR
or release record, including checks you could not run.
