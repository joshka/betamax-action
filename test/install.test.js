import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  realpath,
  rm,
  symlink,
  access,
} from "node:fs/promises";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { prepareBinary } from "../src/install.js";
import { render } from "../src/render.js";
import { digest } from "../src/common.js";

async function fixture(t) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "betamax-binary-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

function forbidDownloads(t) {
  return t.mock.method(globalThis, "fetch", () => {
    assert.fail("A supplied binary must not download a release");
  });
}

async function interceptSetup(t, root) {
  const log = path.join(root, "setup.jsonl");
  // Never invoke sudo or the host's package manager from these tests.
  await writeFile(
    path.join(root, "sudo"),
    `#!${process.execPath}
require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify(process.argv.slice(2))+'\\n');
`,
    { mode: 0o755 },
  );
  const previousPath = process.env.PATH;
  process.env.PATH = `${root}${path.delimiter}${previousPath}`;
  t.after(() => {
    process.env.PATH = previousPath;
  });
  return log;
}

test("local binary is invoked literally from working-directory and overrides release settings", async (t) => {
  const root = await fixture(t);
  const working = path.join(root, "project");
  await mkdir(path.join(working, "target"), { recursive: true });
  const candidate = "target/local cli;literal";
  await writeFile(
    path.join(working, candidate),
    `#!/usr/bin/env node
const fs = require('node:fs');
const source = fs.readFileSync(0, 'utf8');
fs.writeFileSync('invoked.json', JSON.stringify({args:process.argv.slice(2),cwd:process.cwd()}));
for (const line of source.split('\\n').filter(line => line.startsWith('Output '))) {
  fs.writeFileSync(JSON.parse(line.slice(7)), 'GIF89atest');
}
`,
    { mode: 0o755 },
  );
  await writeFile(path.join(working, "demo.tape"), "Sleep 1s");
  const fetch = forbidDownloads(t);
  const directory = path.join(root, "installation");
  const binary = await prepareBinary({
    root: working,
    directory,
    binary: candidate,
    version: "ignored-invalid-version",
    checksum: "ignored-invalid-checksum",
    dependencies: false,
  });
  assert.equal(binary, path.join(working, candidate));
  await assert.rejects(access(directory), { code: "ENOENT" });
  const result = await render({
    root: working,
    directory: path.join(root, "outputs"),
    binary,
    patterns: "*.tape",
    formats: ["gif"],
    timeout: 5000,
    extraOutputs: "",
    prefix: "betamax-test-local-r1",
  });
  assert.deepEqual(result.problems, []);
  assert.equal(result.results[0].status, "passed");
  assert.equal(result.media.length, 1);
  assert.deepEqual(JSON.parse(await readFile(path.join(working, "invoked.json"), "utf8")), {
    args: ["run", "--quiet", "-"],
    cwd: working,
  });
  assert.equal(fetch.mock.callCount(), 0);
});

test("local binary rejects missing, non-executable, non-file, escaped and symlink paths before setup", async (t) => {
  const root = await fixture(t);
  const working = path.join(root, "project");
  await mkdir(working);
  await writeFile(path.join(working, "not-executable"), "data", { mode: 0o644 });
  await writeFile(path.join(root, "outside"), "data", { mode: 0o755 });
  await writeFile(path.join(working, "cli"), "data", { mode: 0o755 });
  await symlink("cli", path.join(working, "link"));
  await symlink(working, path.join(working, "linked-directory"));
  const fetch = forbidDownloads(t);
  const setupLog = await interceptSetup(t, root);
  const directory = path.join(root, "installation");
  for (const candidate of [
    "missing",
    "not-executable",
    ".",
    "../outside",
    path.join(root, "outside"),
    "link",
    "linked-directory/cli",
    "cli --version",
  ]) {
    await assert.rejects(
      prepareBinary({
        root: working,
        directory,
        binary: candidate,
        dependencies: true,
      }),
      /Invalid binary input: provide an existing executable file inside working-directory/,
    );
  }
  assert.equal(fetch.mock.callCount(), 0);
  await assert.rejects(access(setupLog), { code: "ENOENT" });
  await assert.rejects(access(directory), { code: "ENOENT" });
  assert.equal(
    await prepareBinary({
      root: working,
      directory,
      binary: path.join(working, "cli"),
      dependencies: false,
    }),
    path.join(working, "cli"),
  );
});

test("local binary still installs dependencies when requested", async (t) => {
  const root = await fixture(t);
  const candidate = path.join(root, "cli");
  await writeFile(candidate, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const setupLog = await interceptSetup(t, root);
  const fetch = forbidDownloads(t);
  assert.equal(
    await prepareBinary({
      root,
      directory: path.join(root, "installation"),
      binary: "cli",
      dependencies: true,
    }),
    candidate,
  );
  const calls = (await readFile(setupLog, "utf8")).trim().split("\n").map(JSON.parse);
  assert.deepEqual(calls[0], ["-n", "apt-get", "update", "-qq"]);
  assert.deepEqual(calls[1].slice(0, 5), ["-n", "apt-get", "install", "-y", "-qq"]);
  assert.ok(calls[1].includes("ffmpeg"));
  assert.ok(calls[1].includes("fonts-dejavu-core"));
  assert.equal(fetch.mock.callCount(), 0);
});

test(
  "empty binary uses the checksum-verified release installer",
  { skip: process.platform !== "linux" },
  async (t) => {
    const root = await fixture(t);
    const source = path.join(root, "source");
    await mkdir(source);
    await writeFile(path.join(source, "betamax"), "#!/bin/sh\nexit 0\n");
    const archive = path.join(root, "release.tgz");
    execFileSync("tar", ["-czf", archive, "-C", source, "betamax"]);
    const bytes = await readFile(archive);
    const fetch = t.mock.method(globalThis, "fetch", async (url) => {
      assert.match(
        url,
        /releases\/download\/betamax-v1\.2\.3\/betamax-1\.2\.3-.*-unknown-linux-gnu\.tgz$/,
      );
      return new Response(bytes);
    });
    const options = {
      root,
      directory: path.join(root, "installation"),
      binary: "",
      version: "1.2.3",
      checksum: digest(bytes),
      dependencies: false,
    };
    assert.equal(await prepareBinary(options), path.join(options.directory, "betamax"));
    assert.equal(fetch.mock.callCount(), 1);
    await assert.rejects(
      prepareBinary({ ...options, checksum: "0".repeat(64) }),
      /checksum mismatch/,
    );
  },
);
