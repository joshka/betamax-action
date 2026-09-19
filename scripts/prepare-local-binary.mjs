import { writeFile } from "node:fs/promises";
import { prepareBinary } from "../src/install.js";

// Exercise local selection with a real CLI and an invocation marker. The consumer repository
// separately builds its PR's CLI; this fixture uses a verified release to keep action CI small.
await prepareBinary({
  directory: ".artifacts/local-cli/release",
  version: "0.1.20",
  dependencies: false,
});
await writeFile(
  ".artifacts/local-cli/betamax",
  `#!/bin/sh
set -eu
printf 'invoked\\n' > "$GITHUB_WORKSPACE/.artifacts/local-binary-used"
exec "$GITHUB_WORKSPACE/.artifacts/local-cli/release/betamax" "$@"
`,
  { mode: 0o755 },
);
