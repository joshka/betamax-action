# Develop and test

For architecture, artifact compatibility, change procedures and debugging, read the
[maintainer guide](docs/development.md). This page is the local setup and checks entry point.

Use Node.js 24 or newer and Rust stable. The action uses JavaScript for the Actions runtime and a
Rust Ratatui app as its integration fixture. Betamax itself is downloaded as a verified binary.

```sh
npm ci --ignore-scripts
npm test
npm run lint
npm run format:check
npm run build
node scripts/check-dist.mjs
cargo fmt --manifest-path examples/ratatui/Cargo.toml --check
cargo clippy --locked --manifest-path examples/ratatui/Cargo.toml -- -D warnings
npm run lint:md
uvx zizmor==1.30.1 --no-progress .
actionlint -ignore 'specifying action "\$/" in invalid format'
```

Install `uv` and `actionlint` separately for the workflow checks above. CI pins Rust 1.98.1 and
Node.js 24; use those versions when reproducing a CI-only failure.

Actionlint 1.7.12 does not recognize GitHub's new `$/` self-repository action syntax. The command
above excludes that one diagnostic; zizmor 1.30.1 and live CI validate the reference.

Commit `dist/` and dependency lockfiles with source changes. Consumers execute the checked-in
bundle; they do not install npm dependencies. CI compares a fresh bundle with the committed files.
Legal notices for bundled dependencies are next to each entry point.

The Markdown linter pins a vulnerable TOML parser transitively. The package override selects
`smol-toml` 1.8.0 until the linter updates its dependency. `npm audit` checks all dependencies.

## Test layers

Use the [test-layer comparison](docs/development.md#choose-the-right-test) to choose between local
behavioral tests, real rendering and trusted reporter acceptance. Local tests need no PAT. Native
upload acceptance uses a separate, maintainer-configured environment secret and reviewed reporter
code; a PR cannot safely test arbitrary publisher code with write credentials.

Read [artifact compatibility](docs/development.md#change-the-artifact-contract) before changing
names or adding formats. Deploy a compatible reporter before a renderer that requires it. Record
live results and remaining gaps in [validation notes](docs/validation.md).

## Documentation

Keep setup instructions, input reference, security guidance and validation evidence separate. These
pages are plain Markdown so they can later move into the Betamax website. Describe implemented
behavior, include working examples, and update the reference when inputs or failure behavior change.
