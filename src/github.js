import { MAX_FILE_BYTES, digest, mediaType } from "./common.js";

export class GitHub {
  constructor(token, repo, transport = fetch) {
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) throw new Error("Invalid repository");
    this.token = token;
    this.repo = repo;
    this.transport = transport;
  }

  async request(route, method = "GET", body) {
    if (!route.startsWith("/")) throw new Error("Expected an API path");
    const response = await this.transport(`https://api.github.com${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub API ${method} failed (HTTP ${response.status})`);
    return response.json();
  }

  async pages(route, field) {
    const all = [];
    for (let page = 1; page <= 30; page++) {
      const data = await this.request(
        `${route}${route.includes("?") ? "&" : "?"}per_page=100&page=${page}`,
      );
      const items = field ? data[field] : data;
      if (!Array.isArray(items)) throw new Error("Invalid GitHub API response");
      all.push(...items);
      if (items.length < 100) return all;
    }
    throw new Error("Too many API results; refusing to publish an incomplete report");
  }

  async downloadMedia(artifact, extension) {
    if (artifact.size_in_bytes > MAX_FILE_BYTES) throw new Error("Artifact exceeds 10 MiB");
    const response = await this.transport(
      `https://api.github.com/repos/${this.repo}/actions/artifacts/${artifact.id}/zip`,
      {
        headers: { Authorization: `Bearer ${this.token}`, Accept: "application/vnd.github+json" },
        redirect: "manual",
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (response.status !== 302) throw new Error("Expected a signed artifact download");
    const url = new URL(response.headers.get("location"));
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !(
        url.hostname.endsWith(".blob.core.windows.net") ||
        url.hostname.endsWith(".actions.githubusercontent.com")
      )
    ) {
      throw new Error("Unexpected artifact download host");
    }
    // Never forward the GitHub token to blob storage. Never extract archives.
    const download = await this.transport(url, {
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (!download.ok) throw new Error("Artifact download failed");
    const bytes = await boundedBody(download, MAX_FILE_BYTES);
    if (
      !/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? "") ||
      `sha256:${digest(bytes)}` !== artifact.digest
    ) {
      throw new Error("Artifact digest mismatch or missing digest");
    }
    return { bytes, type: mediaType(bytes, extension) };
  }

  async attach(artifact, media, repositoryId, token) {
    const url = new URL("https://uploads.github.com/user-attachments/assets");
    url.searchParams.set("name", artifact.name);
    url.searchParams.set("content_type", media.type);
    url.searchParams.set("repository_id", String(repositoryId));
    const response = await this.transport(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(60_000),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/octet-stream",
      },
      body: media.bytes,
    });
    if (!response.ok)
      throw new Error(
        `Native upload failed (HTTP ${response.status}); check the user token and repository write access`,
      );
    const data = await response.json();
    if (!/^https:\/\/github\.com\/user-attachments\/assets\/[a-f0-9-]+$/.test(data.url ?? "")) {
      throw new Error("Unexpected attachment URL");
    }
    return data.url;
  }
}

export async function boundedBody(response, limit) {
  if (Number(response.headers.get("content-length")) > limit)
    throw new Error("Media response exceeds size limit");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > limit) throw new Error("Media response exceeds size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
