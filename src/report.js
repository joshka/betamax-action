import { identifier, integer, MAX_MEDIA, MAX_TOTAL_BYTES } from "./common.js";

export function selectArtifacts(artifacts, key, attempt) {
  identifier(key, "comment-key");
  const pattern = new RegExp(
    `^betamax-${key}-([a-z0-9][a-z0-9-]{0,39})-r([0-9]+)(?:\\.html|-m([0-9]+)\\.(png|gif|webp|jpg|jpeg|mp4|webm))$`,
  );
  const variants = new Map();
  for (const artifact of artifacts) {
    const match = artifact.name.match(pattern);
    if (!match || Number(match[2]) > attempt) continue;
    const [, variant, recordedAttempt, index, extension] = match;
    const item = {
      ...artifact,
      variant,
      attempt: Number(recordedAttempt),
      index: Number(index || 0),
      extension,
    };
    const current = variants.get(variant);
    if (!current || current.attempt < item.attempt)
      variants.set(variant, { attempt: item.attempt, items: [item] });
    else if (current.attempt === item.attempt) current.items.push(item);
  }
  return [...variants.values()]
    .flatMap((value) => value.items)
    .sort((a, b) => a.variant.localeCompare(b.variant) || a.index - b.index || b.id - a.id);
}

export function previousStamp(body, key) {
  if (!body?.startsWith(`<!-- betamax:${key} -->\n`)) return null;
  const match = body.match(/<!-- betamax-run:(\d+) attempt:(\d+) -->/);
  return match ? { id: Number(match[1]), attempt: Number(match[2]) } : null;
}

export function isStale(body, key, run) {
  const previous = previousStamp(body, key);
  return (
    previous &&
    (previous.id > run.id || (previous.id === run.id && previous.attempt >= run.run_attempt))
  );
}

export async function report({
  api,
  event,
  workflow,
  key,
  mode,
  attachmentToken,
  warn = () => {},
}) {
  identifier(key, "comment-key");
  if (!/^[A-Za-z0-9_-]+\.ya?ml$/.test(workflow))
    throw new Error("workflow must be a workflow filename");
  if (!["artifacts", "attachments"].includes(mode))
    throw new Error("mode must be artifacts or attachments");
  if (mode === "attachments" && !/^(github_pat_|ghp_|gho_)/.test(attachmentToken ?? "")) {
    throw new Error(
      "Native attachments require a user PAT or OAuth token; GITHUB_TOKEN and GitHub App tokens cannot upload",
    );
  }
  const id = integer(event.workflow_run?.id, "workflow run ID", 1, Number.MAX_SAFE_INTEGER);
  const base = `/repos/${api.repo}`;
  const run = await api.request(`${base}/actions/runs/${id}`);
  const expected = await api.request(`${base}/actions/workflows/${workflow}`);
  if (
    run.repository.full_name !== api.repo ||
    run.workflow_id !== expected.id ||
    run.path !== `.github/workflows/${workflow}` ||
    run.event !== "pull_request"
  ) {
    throw new Error("Source run does not match the configured pull request workflow");
  }
  if (run.status !== "completed" || run.run_attempt !== event.workflow_run.run_attempt) return [];
  const pulls = run.pull_requests?.length
    ? run.pull_requests
    : await api.pages(`${base}/commits/${run.head_sha}/pulls`);
  const artifacts = await api.pages(`${base}/actions/runs/${run.id}/artifacts`, "artifacts");
  const selected = selectArtifacts(artifacts, key, run.run_attempt);
  const links = [];
  for (const candidate of pulls) {
    const pr = await api.request(`${base}/pulls/${candidate.number}`);
    if (
      pr.state !== "open" ||
      pr.head.sha !== run.head_sha ||
      pr.head.repo?.id !== run.head_repository.id ||
      pr.base.repo.full_name !== api.repo
    )
      continue;
    const comments = await api.pages(`${base}/issues/${pr.number}/comments`);
    const matching = comments.filter(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.user?.type === "Bot" &&
        comment.body?.startsWith(`<!-- betamax:${key} -->\n`),
    );
    if (matching.length > 1)
      throw new Error("Multiple Betamax comments found; remove the duplicate before retrying");
    const existing = matching[0];
    if (isStale(existing?.body, key, run)) continue;

    const body = await commentBody({ api, run, selected, key, mode, attachmentToken, warn });
    // Uploads can take time. Recheck PR head and run attempt immediately before mutation.
    const currentPr = await api.request(`${base}/pulls/${pr.number}`);
    const currentRun = await api.request(`${base}/actions/runs/${run.id}`);
    if (
      currentPr.state !== "open" ||
      currentPr.head.sha !== run.head_sha ||
      currentRun.run_attempt !== run.run_attempt
    )
      continue;
    const route = existing
      ? `${base}/issues/comments/${existing.id}`
      : `${base}/issues/${pr.number}/comments`;
    const saved = await api.request(route, existing ? "PATCH" : "POST", { body });
    links.push(saved.html_url);
  }
  return links;
}

async function commentBody({ api, run, selected, key, mode, attachmentToken, warn }) {
  const runUrl = `https://github.com/${api.repo}/actions/runs/${run.id}`;
  const body = [
    `<!-- betamax:${key} -->`,
    "### Terminal previews",
    "",
    `[Run ${run.run_number}, attempt ${run.run_attempt}](${runUrl}) · **${run.conclusion}** · commit \`${run.head_sha.slice(0, 12)}\``,
    "",
  ];
  const galleries = selected.filter((item) => !item.extension);
  for (const item of galleries) {
    const label = `${item.variant}${item.attempt < run.run_attempt ? ` (from attempt ${item.attempt})` : ""}`;
    body.push(
      item.expired
        ? `- ${label}: gallery expired.`
        : `- [${label} gallery](${runUrl}/artifacts/${item.id})`,
    );
  }
  if (!galleries.length)
    body.push("No gallery was uploaded. Check the rendering job for setup errors or cancellation.");
  body.push(
    "",
    "Failed or cancelled runs may contain partial output. Artifacts require GitHub sign-in and expire with repository retention.",
  );
  if (mode === "attachments") {
    const files = selected.filter((item) => item.extension && !item.expired);
    if (
      files.length > MAX_MEDIA ||
      files.reduce((sum, item) => sum + item.size_in_bytes, 0) > MAX_TOTAL_BYTES
    ) {
      throw new Error(
        "Native report exceeds 20 media files or 40 MiB; narrow formats or the matrix",
      );
    }
    for (const item of files) {
      try {
        const media = await api.downloadMedia(item, item.extension);
        const url = await api.attach(item, media, run.repository.id, attachmentToken);
        body.push(
          "",
          `**${item.variant} · preview ${item.index} · ${item.extension} · attempt ${item.attempt}**`,
          "",
          media.type.startsWith("video/")
            ? url
            : `![${item.variant} terminal preview ${item.index}](${url})`,
        );
      } catch (error) {
        warn(error.message);
        body.push(
          "",
          `Preview ${item.index} (${item.variant}) could not be attached. [Open the artifact](${runUrl}/artifacts/${item.id}).`,
        );
      }
    }
  }
  body.push("", `<!-- betamax-run:${run.id} attempt:${run.run_attempt} -->`);
  return body.join("\n");
}
