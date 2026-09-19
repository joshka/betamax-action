import * as core from "@actions/core";
import { readFile } from "node:fs/promises";
import { GitHub } from "./github.js";
import { report } from "./report.js";

try {
  if (
    process.env.GITHUB_EVENT_NAME !== "workflow_run" ||
    process.env.GITHUB_SERVER_URL !== "https://github.com"
  ) {
    throw new Error(
      "Run the reporter on GitHub.com using workflow_run; do not execute it in the rendering job",
    );
  }
  const token = core.getInput("token", { required: true });
  const attachmentToken = core.getInput("attachment-token");
  core.setSecret(token);
  if (attachmentToken) core.setSecret(attachmentToken);
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, "utf8"));
  const urls = await report({
    api: new GitHub(token, process.env.GITHUB_REPOSITORY),
    event,
    workflow: core.getInput("workflow", { required: true }),
    key: core.getInput("comment-key") || "betamax",
    artifactKey: core.getInput("artifact-key") || undefined,
    mode: core.getInput("mode") || "artifacts",
    attachmentToken,
    warn: core.warning,
  });
  if (urls.length) core.setOutput("comment-url", urls[0]);
  core.info(
    urls.length
      ? "Updated the terminal preview comment"
      : "No current pull request needs an update",
  );
} catch (error) {
  core.setFailed(error.message);
}
