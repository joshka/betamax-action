import test from "node:test";
import assert from "node:assert/strict";
import { report, selectArtifacts } from "../src/report.js";
import { GitHub, boundedBody } from "../src/github.js";
import { digest } from "../src/common.js";

function scenario(overrides = {}) {
  const run = {
    id: 90,
    run_attempt: 2,
    run_number: 10,
    workflow_id: 7,
    path: ".github/workflows/betamax.yml",
    event: "pull_request",
    status: "completed",
    conclusion: "success",
    repository: { full_name: "owner/repo", id: 1 },
    head_repository: { id: 2 },
    head_sha: "a".repeat(40),
    pull_requests: [{ number: 3 }],
    ...overrides,
  };
  const pr = {
    number: 3,
    state: "open",
    head: { sha: run.head_sha, repo: { id: 2 } },
    base: { repo: { full_name: "owner/repo" } },
  };
  const state = {
    run,
    pr,
    comments: [],
    artifacts: [{ id: 10, name: "betamax-betamax-linux-r2.html", expired: false }],
    writes: [],
    downloads: 0,
    attachments: 0,
    pullsRead: 0,
    changeHead: false,
  };
  const api = {
    repo: "owner/repo",
    async request(route, method = "GET", body) {
      if (method !== "GET") {
        state.writes.push({ route, method, body });
        return { html_url: "https://github.com/owner/repo/pull/3#issuecomment-1" };
      }
      if (route.endsWith("/actions/runs/90")) return state.run;
      if (route.endsWith("/actions/workflows/betamax.yml")) return { id: 7 };
      if (route.endsWith("/pulls/3")) {
        state.pullsRead++;
        return state.changeHead && state.pullsRead > 1
          ? { ...pr, head: { ...pr.head, sha: "b".repeat(40) } }
          : pr;
      }
      throw new Error(`Unexpected route: ${route}`);
    },
    async pages(route) {
      if (route.endsWith("/artifacts")) return state.artifacts;
      if (route.endsWith("/comments")) return state.comments;
      if (route.includes("/commits/")) return [{ number: 3 }];
      throw new Error(`Unexpected route: ${route}`);
    },
    async downloadMedia() {
      state.downloads++;
      return { bytes: Buffer.from("GIF89a"), type: "image/gif" };
    },
    async attach() {
      state.attachments++;
      return "https://github.com/user-attachments/assets/aabb-ccdd";
    },
  };
  return {
    state,
    options: {
      api,
      event: { workflow_run: { id: 90, run_attempt: 2 } },
      workflow: "betamax.yml",
      key: "betamax",
      mode: "artifacts",
    },
  };
}

function bot(body) {
  return { id: 55, user: { login: "github-actions[bot]", type: "Bot" }, body };
}

test("creates a metadata-only comment with no artifact downloads", async () => {
  const { state, options } = scenario();
  await report(options);
  assert.equal(state.writes.length, 1);
  assert.equal(state.downloads, 0);
  assert.equal(state.writes[0].method, "POST");
  assert.match(state.writes[0].body.body, /linux gallery/);
  assert.match(state.writes[0].body.body, /expire/);
});

test("updates the identified comment, ignoring unrelated and forged markers", async () => {
  const { state, options } = scenario();
  state.comments = [
    { ...bot("<!-- betamax:betamax -->\nhello"), user: { login: "attacker", type: "User" } },
    bot("<!-- betamax:betamax -->\n<!-- betamax-run:89 attempt:9 -->"),
    { ...bot("unrelated last comment"), id: 999 },
  ];
  await report(options);
  assert.equal(state.writes[0].route, "/repos/owner/repo/issues/comments/55");
  assert.equal(state.writes[0].method, "PATCH");
});

test("duplicate deliveries do not write or re-upload attachments", async () => {
  const { state, options } = scenario();
  state.comments = [bot("<!-- betamax:betamax -->\n<!-- betamax-run:90 attempt:2 -->")];
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.equal(state.writes.length, 0);
  assert.equal(state.downloads, 0);
});

test("fork runs without event PR associations resolve through commit metadata", async () => {
  const { state, options } = scenario({ pull_requests: [] });
  await report(options);
  assert.equal(state.writes.length, 1);
});

for (const [name, mutate] of [
  [
    "closed PR",
    (s) => {
      s.pr.state = "closed";
    },
  ],
  [
    "new PR head",
    (s) => {
      s.pr.head.sha = "b".repeat(40);
    },
  ],
  [
    "wrong head repository",
    (s) => {
      s.pr.head.repo.id = 100;
    },
  ],
  [
    "wrong base repository",
    (s) => {
      s.pr.base.repo.full_name = "elsewhere/repo";
    },
  ],
  [
    "a head changed during publication",
    (s) => {
      s.changeHead = true;
    },
  ],
  [
    "a newer published run",
    (s) => {
      s.comments = [bot("<!-- betamax:betamax -->\n<!-- betamax-run:91 attempt:1 -->")];
    },
  ],
]) {
  test(`does not comment on ${name}`, async () => {
    const { state, options } = scenario();
    mutate(state);
    await report(options);
    assert.equal(state.writes.length, 0);
  });
}

test("wrong workflows and privileged source events are rejected", async () => {
  for (const override of [
    { workflow_id: 8 },
    { event: "pull_request_target" },
    { path: ".github/workflows/other.yml" },
  ]) {
    const { options } = scenario(override);
    await assert.rejects(report(options), /does not match/);
  }
});

test("superseded run attempts and running jobs are ignored", async () => {
  for (const override of [{ run_attempt: 3 }, { status: "in_progress" }]) {
    const { state, options } = scenario(override);
    await report(options);
    assert.equal(state.writes.length, 0);
  }
});

test("matrix selection carries prior attempts explicitly and rejects arbitrary names", () => {
  const artifacts = [
    "betamax-betamax-linux-r1.html",
    "betamax-betamax-linux-r2.html",
    "betamax-betamax-arm-r1.html",
    "betamax-betamax-linux-r2-m1.webp",
    "betamax-betamax-linux-r2-m2.svg",
    "betamax-betamax-linux-r3.html",
    "<script>.html",
  ];
  const selected = selectArtifacts(
    artifacts.map((name, id) => ({ name, id })),
    "betamax",
    2,
  );
  assert.deepEqual(
    selected.map((a) => a.name),
    [artifacts[2], artifacts[1], artifacts[3]],
  );
});

test("missing and expired galleries are explicit", async () => {
  const { state, options } = scenario();
  state.artifacts[0].expired = true;
  await report(options);
  assert.match(state.writes[0].body.body, /expired/);
  state.artifacts = [];
  await report(options);
  assert.match(state.writes[1].body.body, /No gallery/);
});

test("native upload is opt-in and rejects installation tokens", async () => {
  const { options } = scenario();
  for (const token of ["", "ghs_installation", "ghu_user_to_server"]) {
    await assert.rejects(
      report({ ...options, mode: "attachments", attachmentToken: token }),
      /user PAT/,
    );
  }
});

test("native media uses verified file bytes and never gh edit-last", async () => {
  const { state, options } = scenario();
  state.artifacts.push({ id: 11, name: "betamax-betamax-linux-r2-m1.gif", size_in_bytes: 6 });
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.equal(state.downloads, 1);
  assert.equal(state.attachments, 1);
  assert.match(
    state.writes[0].body.body,
    /!\[linux terminal preview 1\]\(https:\/\/github.com\/user-attachments/,
  );
});

test("download credentials never reach blob storage and digest is verified", async () => {
  const bytes = Buffer.from("GIF89adata");
  const calls = [];
  const api = new GitHub("secret", "owner/repo", async (url, options) => {
    calls.push({ url: String(url), options });
    return calls.length === 1
      ? new Response(null, {
          status: 302,
          headers: { location: "https://example.blob.core.windows.net/artifact" },
        })
      : new Response(bytes);
  });
  const media = await api.downloadMedia(
    { id: 1, size_in_bytes: bytes.length, digest: `sha256:${digest(bytes)}` },
    "gif",
  );
  assert.deepEqual(media.bytes, bytes);
  assert.equal(calls[0].options.headers.Authorization, "Bearer secret");
  assert.equal(calls[1].options.headers, undefined);
});

test("artifact redirects cannot target arbitrary hosts", async () => {
  const api = new GitHub(
    "secret",
    "owner/repo",
    async () =>
      new Response(null, { status: 302, headers: { location: "https://attacker.test/secret" } }),
  );
  await assert.rejects(api.downloadMedia({ id: 1, size_in_bytes: 1 }, "png"), /host/);
});

test("oversized responses are bounded even without content-length", async () => {
  await assert.rejects(boundedBody(new Response(Buffer.alloc(20)), 10), /size limit/);
});

test("artifact digest mismatches and ZIP payloads are rejected", async () => {
  for (const [bytes, expected] of [
    [Buffer.from("GIF89adata"), "0".repeat(64)],
    [Buffer.from("PKzip"), digest(Buffer.from("PKzip"))],
  ]) {
    let requests = 0;
    const api = new GitHub("secret", "owner/repo", async () =>
      ++requests === 1
        ? new Response(null, {
            status: 302,
            headers: { location: "https://example.blob.core.windows.net/file" },
          })
        : new Response(bytes),
    );
    await assert.rejects(
      api.downloadMedia(
        { id: 1, size_in_bytes: bytes.length, digest: `sha256:${expected}` },
        "gif",
      ),
    );
  }
});

test("API pagination preserves all pages and refuses an incomplete result", async () => {
  const urls = [];
  const api = new GitHub("secret", "owner/repo", async (url) => {
    urls.push(new URL(url));
    return Response.json({ items: urls.length === 1 ? Array(100).fill(1) : [2] });
  });
  assert.equal((await api.pages("/items?state=open", "items")).length, 101);
  assert.equal(urls[1].searchParams.get("state"), "open");
  assert.equal(urls[1].searchParams.get("page"), "2");
  const endless = new GitHub("secret", "owner/repo", async () => Response.json(Array(100).fill(1)));
  await assert.rejects(endless.pages("/items"), /incomplete report/);
});

test("two report modes update separate comments from the same artifacts", async () => {
  const { state, options } = scenario();
  state.artifacts.push({ id: 11, name: "betamax-betamax-linux-r2-m1.gif", size_in_bytes: 6 });
  state.comments = [
    bot("<!-- betamax:betamax -->\n<!-- betamax-run:89 attempt:1 -->"),
    { ...bot("<!-- betamax:native -->\n<!-- betamax-run:89 attempt:1 -->"), id: 56 },
  ];
  await report(options);
  assert.equal(state.downloads, 0);
  await report({
    ...options,
    key: "native",
    artifactKey: "betamax",
    mode: "attachments",
    attachmentToken: "github_pat_example",
  });
  assert.deepEqual(
    state.writes.map(({ route }) => route),
    ["/repos/owner/repo/issues/comments/55", "/repos/owner/repo/issues/comments/56"],
  );
  assert.match(state.writes[0].body.body, /linux gallery/);
  assert.doesNotMatch(state.writes[0].body.body, /user-attachments/);
  assert.match(state.writes[1].body.body, /linux gallery/);
  assert.match(state.writes[1].body.body, /user-attachments/);
  assert.equal(state.attachments, 1);
});

test("named and legacy artifacts share variant attempt selection and media ordering", () => {
  const names = [
    "betamax-betamax-linux-r1-m1.old-scene.gif",
    "betamax-betamax-linux-r2.html",
    "betamax-betamax-linux-r2-m2.input-and-keys.webp",
    "betamax-betamax-linux-r2-m1.gif",
    "betamax-betamax-arm-r1-m1.captions-and-overlays.png",
    "betamax-betamax-linux-r3-m1.future.png",
  ];
  const selected = selectArtifacts(
    names.map((name, id) => ({ name, id })),
    "betamax",
    2,
  );
  assert.deepEqual(
    selected.map((item) => item.name),
    [names[4], names[1], names[3], names[2]],
  );
  assert.equal(selected[0].title, "Captions and overlays");
  assert.equal(selected[2].title, undefined);
  assert.equal(selected[3].title, "Input and keys");
});

test("malformed scenario names are rejected before display or download", async () => {
  const { state, options } = scenario();
  const invalid = [
    "",
    "-start",
    "end-",
    "two--words",
    "UPPER",
    "a_b",
    "a/b",
    "é",
    "a".repeat(61),
    "[click](https://evil)",
    "<script>",
    "a\n",
    "a.html",
    "a<!-- betamax-run:999 attempt:9 -->",
  ];
  state.artifacts.push(
    ...invalid.map((slug, id) => ({
      id: id + 20,
      name: `betamax-betamax-linux-r2-m1.${slug}.gif`,
      size_in_bytes: 6,
    })),
  );
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.equal(state.downloads, 0);
  assert.equal(state.attachments, 0);
  assert.doesNotMatch(state.writes[0].body.body, /<script>|evil|UPPER/);
  assert.equal(
    selectArtifacts([{ name: `betamax-betamax-linux-r2-m1.${"a".repeat(60)}.gif` }], "betamax", 2)
      .length,
    1,
  );
});

test("scenario titles appear in native captions, alt text and upload failure links", async () => {
  const { state, options } = scenario();
  state.artifacts.push({
    id: 11,
    name: "betamax-betamax-linux-r2-m1.input-and-keys.gif",
    size_in_bytes: 6,
  });
  await report(options);
  assert.equal(state.downloads, 0);
  assert.doesNotMatch(state.writes[0].body.body, /Input and keys/);
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.match(state.writes[1].body.body, /\*\*linux · Input and keys · gif · attempt 2\*\*/);
  assert.match(state.writes[1].body.body, /!\[Input and keys \(linux\)\]/);
  options.api.attach = async () => {
    throw new Error("upload failed");
  };
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.match(state.writes[2].body.body, /Input and keys \(linux\) could not be attached/);
});

test("named media retains byte/count limits and cannot authorize a different PR", async () => {
  for (const size of [6, 40 * 1024 * 1024 + 1]) {
    const { state, options } = scenario();
    state.artifacts.push(
      ...Array.from({ length: size === 6 ? 21 : 1 }, (_, index) => ({
        id: 20 + index,
        name: `betamax-betamax-linux-r2-m${index + 1}.input-and-keys.gif`,
        size_in_bytes: size,
      })),
    );
    await assert.rejects(
      report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" }),
      /exceeds/,
    );
    assert.equal(state.downloads, 0);
  }
  const { state, options } = scenario();
  state.artifacts.push({
    id: 11,
    name: "betamax-betamax-linux-r2-m1.trusted-main.gif",
    size_in_bytes: 6,
  });
  state.pr.head.sha = "b".repeat(40);
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.equal(state.downloads, 0);
  assert.equal(state.writes.length, 0);
});

test("scenario words cannot become variant or attempt metadata", () => {
  const artifact = { name: "betamax-betamax-linux-r2-m1.input-r9-m8.png", id: 10 };
  const [item] = selectArtifacts([artifact], "betamax", 2);
  assert.equal(item.variant, "linux");
  assert.equal(item.attempt, 2);
  assert.equal(item.index, 1);
  assert.equal(item.title, "Input r9 m8");
  for (const suffix of ["\n", "\r", "\r\n", ".html"])
    assert.deepEqual(
      selectArtifacts([{ ...artifact, name: artifact.name + suffix }], "betamax", 2),
      [],
    );
});

test("named videos use scenario captions and preserve native video links", async () => {
  const { state, options } = scenario();
  state.artifacts.push({
    id: 11,
    name: "betamax-betamax-linux-r2-m1.captions-and-overlays.mp4",
    size_in_bytes: 6,
  });
  options.api.downloadMedia = async () => ({ type: "video/mp4", bytes: Buffer.alloc(6) });
  await report({ ...options, mode: "attachments", attachmentToken: "github_pat_example" });
  assert.match(state.writes[0].body.body, /linux · Captions and overlays · mp4 · attempt 2/);
  assert.match(state.writes[0].body.body, /\nhttps:\/\/github.com\/user-attachments\/assets\//);
  assert.doesNotMatch(state.writes[0].body.body, /!\[/);
});
