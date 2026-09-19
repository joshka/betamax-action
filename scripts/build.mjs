import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
for (const name of ["render", "report"]) {
  await mkdir(`dist/${name}`, { recursive: true });
  await build({
    entryPoints: [`src/${name}-entry.js`],
    outfile: `dist/${name}/index.js`,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    banner: {
      js: 'import { createRequire } from "node:module"; const require = createRequire(import.meta.url);',
    },
    legalComments: "linked",
  });
}
await writeFile("dist/package.json", JSON.stringify({ type: "module" }) + "\n");
