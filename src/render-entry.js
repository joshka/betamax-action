import * as core from "@actions/core";
import { DefaultArtifactClient } from "@actions/artifact";
import { mkdtemp, readdir } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { identifier, integer, regularPath } from "./common.js";
import { install } from "./install.js";
import { parseFormats, render } from "./render.js";

try {
  if (["workflow_run", "pull_request_target"].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error(
      "Run tapes in a pull_request job with read-only permissions, never in a privileged event",
    );
  }
  const key = identifier(core.getInput("comment-key") || "betamax", "comment-key");
  const variant = identifier(core.getInput("variant") || "default", "variant");
  const attempt = integer(process.env.GITHUB_RUN_ATTEMPT || "1", "run attempt", 1, 10000);
  const prefix = `betamax-${key}-${variant}-r${attempt}`;
  const directory = await mkdtemp(path.join(process.env.RUNNER_TEMP || os.tmpdir(), "betamax-"));
  const root = await regularPath(
    process.env.GITHUB_WORKSPACE,
    core.getInput("working-directory") || ".",
    true,
  );
  const formats = parseFormats(core.getInput("formats") || "gif,png");
  const timeout =
    integer(core.getInput("timeout-seconds") || "120", "timeout-seconds", 1, 1800) * 1000;
  const retentionDays = integer(core.getInput("retention-days") || "14", "retention-days", 1, 90);
  core.info("Installing a verified Betamax release and rendering terminal tapes");
  const binary = await install(
    path.join(directory, "bin"),
    core.getInput("version") || "0.1.15",
    core.getInput("sha256"),
    core.getBooleanInput("install-dependencies"),
  );
  let result;
  try {
    result = await render({
      root,
      directory,
      binary,
      patterns: core.getInput("tapes") || "**/*.tape",
      formats,
      timeout,
      extraOutputs: core.getInput("extra-outputs"),
      prefix,
    });
    const client = new DefaultArtifactClient();
    const gallery = await client.uploadArtifact(
      path.basename(result.gallery),
      [result.gallery],
      directory,
      { retentionDays, skipArchive: true },
    );
    const url = `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/artifacts/${gallery.id}`;
    core.setOutput("artifact-url", url);
    core.setOutput("artifact-id", gallery.id);
    for (const item of result.media) {
      await client.uploadArtifact(item.name, [item.path], directory, {
        retentionDays,
        skipArchive: true,
      });
    }
    const passed = result.results.filter((row) => row.status === "passed").length;
    core.setOutput("tapes-passed", passed);
    core.setOutput("tapes-failed", result.results.length - passed);
    await core.summary
      .addHeading("Terminal previews")
      .addLink("Open gallery", url)
      .addRaw(
        `\n\n${passed}/${result.results.length} tapes passed. Artifacts require GitHub sign-in and expire after retention.\n`,
      )
      .write();
    if (passed !== result.results.length || result.problems.length)
      core.setFailed("Some tapes or media outputs failed. Open the gallery and diagnostics.");
  } finally {
    const logs = (await readdir(directory))
      .filter((name) => name.endsWith(".log") || name === "manifest.json")
      .map((name) => path.join(directory, name));
    if (logs.length) {
      await new DefaultArtifactClient().uploadArtifact(`${prefix}-diagnostics`, logs, directory, {
        retentionDays,
      });
    }
  }
} catch (error) {
  core.setFailed(error.message);
}
