import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm, realpath } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { discover, parseFormats, render, galleryHtml, scenarioSlug } from "../src/render.js";
import { mediaType, regularPath } from "../src/common.js";
import { execute } from "../src/process.js";
import { selectArtifacts } from "../src/report.js";

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

test("video-only rendering requests native outputs without a GIF intermediate", async (t) => {
  const root = await fixture(t);
  await writeFile(path.join(root, "video.tape"), "Sleep 1s");
  const binary = path.join(root, "fake-betamax");
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
const tape = fs.readFileSync(0, 'utf8');
const outputs = tape.split('\\n').filter(line => line.startsWith('Output '));
if (outputs.length !== 2 || tape.includes('.gif')) process.exit(1);
for (const line of outputs) {
  const file = JSON.parse(line.slice(7));
  const bytes = file.endsWith('.mp4')
    ? Buffer.from('00000018667479706d703432', 'hex')
    : Buffer.from('1a45dfa300000000', 'hex');
  fs.writeFileSync(file, bytes);
}
`,
    { mode: 0o755 },
  );
  const result = await render({
    root,
    directory: path.join(root, "out"),
    binary,
    patterns: "*.tape",
    formats: ["mp4", "webm"],
    timeout: 5000,
    extraOutputs: "",
    prefix: "betamax-test-video-r1",
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.media.length, 2);
  assert.equal(result.results[0].status, "passed");
});

for (const behavior of ["native", "unsupported", "missing"]) {
  test(`WebP-only rendering: ${behavior} output stays native and failures remain visible`, async (t) => {
    const root = await fixture(t);
    await writeFile(path.join(root, "webp.tape"), "Sleep 1s");
    const binary = path.join(root, "fake-betamax");
    await writeFile(
      binary,
      `#!/usr/bin/env node
const fs = require('node:fs');
const tape = fs.readFileSync(0, 'utf8');
const outputs = tape.split('\\n').filter(line => line.startsWith('Output '));
fs.appendFileSync('invocations', 'run\\n');
if (outputs.length !== 1 || !outputs[0].endsWith('.webp"')) process.exit(2);
if (${JSON.stringify(behavior)} === 'unsupported') {
  console.error('unsupported output format: webp');
  process.exit(1);
}
if (${JSON.stringify(behavior)} === 'native') {
  fs.writeFileSync(JSON.parse(outputs[0].slice(7)), 'RIFF1234WEBPnative');
}
`,
      { mode: 0o755 },
    );
    const result = await render({
      root,
      directory: path.join(root, "out"),
      binary,
      patterns: "*.tape",
      formats: ["webp"],
      timeout: 5000,
      extraOutputs: "",
      prefix: "betamax-test-webp-r1",
    });
    assert.equal(await readFile(path.join(root, "invocations"), "utf8"), "run\n");
    assert.equal(result.results[0].status, behavior === "unsupported" ? "failed" : "passed");
    assert.equal(result.media.length, behavior === "native" ? 1 : 0);
    if (behavior === "native") {
      assert.deepEqual(result.problems, []);
      assert.equal(result.media[0].bytes.toString(), "RIFF1234WEBPnative");
      assert.match(await readFile(result.gallery, "utf8"), /data:image\/webp;base64,/);
    } else if (behavior === "missing") {
      assert.match(result.problems[0], /requested webp preview was not produced/);
    } else {
      assert.match(
        await readFile(path.join(root, "out", "tape-1.log"), "utf8"),
        /unsupported output/,
      );
    }
  });
}

test("scenario slugs use bounded basenames, normalize text and never carry markup", () => {
  assert.equal(scenarioSlug("examples/features/input-and-keys.tape"), "input-and-keys");
  assert.equal(scenarioSlug(".artifacts/Caption Étude.PNG"), "caption-etude");
  assert.equal(scenarioSlug("tapes/<script>[Click](https:evil).tape"), "script-click-https-evil");
  assert.equal(scenarioSlug("tapes/日本語.tape"), "scenario");
  assert.equal(scenarioSlug(`tapes/${"a".repeat(59)} b.tape`), "a".repeat(59));
  assert.equal(scenarioSlug(`tapes/${"a".repeat(100)}.tape`), "a".repeat(60));
});

test("colliding scenario slugs keep every tape, format and extra output distinct", async (t) => {
  const root = await fixture(t);
  await mkdir(path.join(root, "nested"));
  for (const tape of ["Input & keys.tape", "input-keys.tape", "nested/input-keys.tape"])
    await writeFile(path.join(root, tape), "Sleep 1s");
  await writeFile(path.join(root, "input-keys.gif"), "GIF89aextra");
  const binary = path.join(root, "fake-betamax");
  await writeFile(
    binary,
    `#!/usr/bin/env node
const fs = require('node:fs');
for (const line of fs.readFileSync(0, 'utf8').split('\\n').filter(line => line.startsWith('Output '))) {
  const file = JSON.parse(line.slice(7));
  fs.writeFileSync(file, file.endsWith('.gif') ? 'GIF89atest' : 'RIFF1234WEBPtest');
}
`,
    { mode: 0o755 },
  );
  const result = await render({
    root,
    directory: path.join(root, "out"),
    binary,
    patterns: "**/*.tape",
    formats: ["gif", "webp"],
    timeout: 5000,
    extraOutputs: "input-keys.gif",
    prefix: "betamax-test-default-r1",
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.media.length, 7);
  assert.equal(new Set(result.media.map((item) => item.name)).size, 7);
  const selected = selectArtifacts(result.media, "test", 1);
  assert.equal(selected.length, 7);
  assert.ok(selected.every((item) => item.title === "Input keys"));
  for (const [index, item] of result.media.entries()) {
    assert.match(item.name, new RegExp(`-m${index + 1}\\.input-keys\\.(gif|webp)$`));
    assert.deepEqual(await readFile(item.path), item.bytes);
  }
  assert.match(await readFile(result.gallery, "utf8"), /nested\/input-keys\.tape/);
  assert.match(await readFile(result.gallery, "utf8"), /Input &amp; keys/);
});
