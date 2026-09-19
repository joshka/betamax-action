# Validation notes

The action is in its initial integration phase. This page records live evidence separately from the
supported interface.

## Local checks

- Reporter and rendering tests use temporary files and mocked API responses.
- The Ratatui fixture builds against Ratatui 0.30.2.
- Workflow configuration is checked with actionlint and zizmor.
- Bundles are rebuilt and compared with their checked-in copies.

## Live checks

Live Actions run and PR comment links will be recorded here after the initial repository setup.
Native uploads require a separately configured user-token secret and have not been verified live.
