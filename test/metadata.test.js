import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { load } from "js-yaml";

for (const file of ["action.yml", "report/action.yml"]) {
  test(`${file} has valid input metadata and a bundled Node entry point`, async () => {
    // Strict YAML loading catches duplicate fields that formatters can preserve.
    const action = load(await readFile(file, "utf8"));
    assert.equal(action.runs.using, "node24");
    assert.ok((await stat(path.join(path.dirname(file), action.runs.main))).isFile());
    for (const [name, input] of Object.entries(action.inputs)) {
      assert.ok(input && typeof input.description === "string", `${name} needs a description`);
      if (input.default !== undefined) assert.equal(typeof input.default, "string");
    }
    for (const output of Object.values(action.outputs))
      assert.equal(typeof output.description, "string");
  });
}
