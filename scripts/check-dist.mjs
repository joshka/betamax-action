import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
async function hashes() {
  const files = await readdir("dist", { recursive: true, withFileTypes: true });
  const result = {};
  for (const file of files.filter((file) => file.isFile())) {
    const path = `${file.parentPath}/${file.name}`;
    result[path] = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  }
  return JSON.stringify(Object.entries(result).sort());
}
const before = await hashes();
execFileSync(process.execPath, ["scripts/build.mjs"], { stdio: "inherit" });
if (before !== (await hashes()))
  throw new Error("Run npm run build and commit dist/ with the source changes");
