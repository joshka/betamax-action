import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discover, parseFormats, render, galleryHtml } from "../src/render.js";
import { mediaType, regularPath } from "../src/common.js";
import { execute } from "../src/process.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "betamax-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return realpath(root);
}

test("discovery deduplicates paths, respects exclusions and ignores build directories", async (t) => {
  const root = await fixture(t);
  for (const dir of ["tapes", "node_modules", "target"]) await mkdir(path.join(root, dir));
  for (const file of [
    "tapes/a space.tape",
    "tapes/skip.tape",
    "node_modules/b.tape",
    "target/c.tape",
  ])
    await writeFile(path.join(root, file), "Sleep 1ms");
  const files = await discover(root, "**/*.tape\ntapes/*.tape\n!tapes/skip.tape");
  assert.deepEqual(files, [path.join(root, "tapes/a space.tape")]);
  await assert.rejects(discover(root, "../*.tape"), /inside/);
});

test("collection refuses symlinks, directories and escapes", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "a.png"), "data");
  await symlink(path.join(root, "a.png"), path.join(root, "b.png"));
  await assert.rejects(regularPath(root, "b.png"), /Symbolic/);
  await assert.rejects(regularPath(root, ".."), /inside/);
  await assert.rejects(regularPath(root, "."), /regular/);
});

test("formats are explicit and deduplicated", () => {
  assert.deepEqual(parseFormats("gif, png,gif,webp"), ["gif", "png", "webp"]);
  assert.throws(() => parseFormats("svg"), /formats/);
  assert.throws(() => parseFormats(""), /formats/);
});

test("media signatures reject HTML masquerading as media", () => {
  for (const extension of ["gif", "png", "webp", "jpg", "mp4", "webm", "svg"]) {
    assert.throws(
      () => mediaType(Buffer.from("<script>alert(1)</script>"), extension),
      /media type/,
    );
  }
  assert.equal(mediaType(Buffer.from("GIF89aabc"), "gif"), "image/gif");
  assert.equal(mediaType(Buffer.from("RIFF1234WEBPabc"), "webp"), "image/webp");
});

test("gallery escapes filenames and uses a script-free content policy", () => {
  const document = galleryHtml(
    { results: [{ tape: "<script>x</script>", status: "failed" }], problems: ['" onload="x'] },
    [],
  );
  assert.ok(document.includes("&lt;script&gt;"));
  assert.ok(document.includes("default-src 'none'"));
  assert.ok(document.includes("color-scheme:light dark"));
  assert.ok(!document.includes("<script>"));
});

test("subprocess output cannot emit workflow commands; timeout bounds execution", async (t) => {
  const root = await fixture(t);
  const log = path.join(root, "out.log");
  const result = await execute(
    process.execPath,
    ["-e", 'console.log("::error::fake"); setInterval(()=>{},1000)'],
    { log, timeout: 150 },
  );
  assert.equal(result.timedOut, true);
  assert.match(await readFile(log, "utf8"), /::error::fake/);
});

test("failed tapes do not prevent later previews or the gallery", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "a.tape"), "fail");
  await writeFile(path.join(root, "b.tape"), "pass");
  const binary = path.join(root, "fake-betamax");
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const tape = fs.readFileSync(0, 'utf8');
if (tape.includes('fail')) process.exit(1);
for (const line of tape.split('\\n').filter(line => line.startsWith('Output '))) {
  fs.writeFileSync(JSON.parse(line.slice(7)), 'GIF89atest');
}
`,
    { mode: 0o755 },
  );
  const result = await render({
    root,
    directory: path.join(root, "out"),
    binary,
    patterns: "*.tape",
    formats: ["gif"],
    timeout: 5000,
    extraOutputs: "",
    prefix: "betamax-test-default-r1",
  });
  assert.deepEqual(
    result.results.map((row) => row.status),
    ["failed", "passed"],
  );
  assert.equal(result.media.length, 1);
  assert.match(await readFile(result.gallery, "utf8"), /a.tape/);
});

test("an empty tape selection fails visibly", async (t) => {
  const root = await fixture(t);
  await assert.rejects(
    render({ root, directory: path.join(root, "out"), patterns: "*.tape" }),
    /No tapes/,
  );
});
