# Develop and test

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
markdownlint-cli2
zizmor --no-progress .
actionlint -ignore 'specifying action "\$/" in invalid format'
```

Actionlint 1.7.12 does not recognize GitHub's new `$/` self-repository action syntax. The command
above excludes that one diagnostic; zizmor 1.30.1 and live CI validate the reference.

Commit `dist/` and dependency lockfiles with source changes. Consumers execute the checked-in
bundle; they do not install npm dependencies. CI compares a fresh bundle with the committed files.
Legal notices for bundled dependencies are next to each entry point.

The Markdown linter pins a vulnerable TOML parser transitively. The package override selects
`smol-toml` 1.8.0 until the linter updates its dependency. `npm audit` checks all dependencies.

## Test layers

Unit and integration tests cover tape discovery, paths, subprocess timeouts, HTML escaping, media
signatures, byte limits, API pagination, bot comment ownership, fork association, stale heads, run
attempts and credential routing. Tests use temporary files and injected HTTP responses.

The Betamax workflow builds the Ratatui fixture and renders GIF/PNG/WebP and MP4/WebM in separate
matrix jobs. It uploads actual media and galleries. A local-executable variant uses an invocation
marker and an invalid release version to prove that `binary` runs and bypasses release selection. A
report workflow pinned to a reviewed commit on the default branch exercises PR comment creation and
updates.

For a live reporter change, first test source behavior locally. Publish a reviewed action commit,
then update the default-branch reporter pin to that commit. A PR cannot safely test arbitrary new
publisher code with write credentials. Keep render changes in the unprivileged PR workflow.

Do not add a PAT just to run the test suite. Native upload acceptance is a separate test requiring a
maintainer-configured secret. Record what was tested in [validation notes](docs/validation.md).

## Documentation

Keep setup instructions, input reference, security guidance and validation evidence separate. These
pages are plain Markdown so they can later move into the Betamax website. Describe implemented
behavior, include working examples, and update the reference when inputs or failure behavior change.
