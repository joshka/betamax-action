import * as glob from "@actions/glob";
import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import { MAX_MEDIA, MAX_TOTAL_BYTES, html, readMedia, regularPath } from "./common.js";
import { encodeAnimation } from "./encode.js";
import { execute } from "./process.js";

const EXCLUDED = new Set([".git", ".jj", "node_modules", "target", "dist", "vendor", ".artifacts"]);

export async function discover(root, patterns, excludeBuild = true) {
  const inputs = patterns
    .split(/\r?\n/)
    .map((p) => p.trim())
    .filter(Boolean);
  if (!inputs.length) return [];
  const absolutePatterns = inputs.map((pattern) => {
    const negative = pattern.startsWith("!");
    const value = negative ? pattern.slice(1) : pattern;
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes(".."))
      throw new Error("Globs must stay inside working-directory");
    return `${negative ? "!" : ""}${path.join(root, value)}`;
  });
  const matcher = await glob.create(absolutePatterns.join("\n"), {
    followSymbolicLinks: false,
    matchDirectories: false,
    implicitDescendants: false,
  });
  const files = [];
  for await (const file of matcher.globGenerator()) {
    const parts = path.relative(root, file).split(path.sep);
    if (
      parts.some(
        (part) => part === ".git" || part === ".jj" || (excludeBuild && EXCLUDED.has(part)),
      )
    )
      continue;
    files.push(await regularPath(root, file));
  }
  return [...new Set(files)].sort();
}

export function parseFormats(input) {
  const formats = [...new Set(input.split(",").map((value) => value.trim()))];
  if (
    !formats.length ||
    formats.some((value) => !["gif", "png", "webp", "mp4", "webm"].includes(value))
  ) {
    throw new Error("formats must be a comma-separated list of gif, png, webp, mp4, webm");
  }
  return formats;
}

export async function render({
  root,
  directory,
  binary,
  patterns,
  formats,
  timeout,
  extraOutputs,
  prefix,
}) {
  await mkdir(directory, { recursive: true });
  const tapes = await discover(root, patterns);
  if (!tapes.length) throw new Error("No tapes matched. Check tapes and working-directory.");
  if (tapes.length > 20)
    throw new Error("At most 20 tapes may run in one job; narrow tapes or use a matrix");
  const results = [];
  const media = [];
  const problems = [];
  let totalBytes = 0;

  const collect = async (base, file, label) => {
    try {
      const item = await readMedia(base, file);
      if (media.length >= MAX_MEDIA || totalBytes + item.bytes.length > MAX_TOTAL_BYTES) {
        throw new Error(
          "Gallery limit exceeded (20 files / 40 MiB total); narrow formats or extra-outputs",
        );
      }
      const name = `${prefix}-m${media.length + 1}.${item.extension}`;
      const destination = path.join(directory, name);
      await writeFile(destination, item.bytes);
      media.push({ name, path: destination, label, type: item.type, bytes: item.bytes });
      totalBytes += item.bytes.length;
    } catch (error) {
      problems.push(`${label}: ${error.message}`);
    }
  };

  for (const [index, tape] of tapes.entries()) {
    const label = path.relative(root, tape);
    const tapeDir = path.join(directory, `tape-${index + 1}`);
    await mkdir(tapeDir);
    if ((await lstat(tape)).size > 1024 * 1024) throw new Error("Tape exceeds the 1 MiB limit");
    const requested = [...new Set(formats.map((format) => (format === "png" ? "png" : "gif")))];
    const outputs = requested.map((format) => path.join(tapeDir, `preview.${format}`));
    const source = await readFile(tape, "utf8");
    const augmented = `${source}\n${outputs.map((file) => `Output ${JSON.stringify(file)}`).join("\n")}\n`;
    let outcome;
    try {
      outcome = await execute(binary, ["run", "--quiet", "-"], {
        cwd: root,
        input: augmented,
        env: { ...process.env, BETAMAX_WORKING_DIRECTORY: root },
        timeout,
        log: path.join(directory, `tape-${index + 1}.log`),
      });
    } catch (error) {
      outcome = { code: -1, timedOut: false };
      problems.push(`${label}: ${error.message}`);
    }
    const status = outcome.timedOut ? "timed out" : outcome.code === 0 ? "passed" : "failed";
    results.push({ tape: label, status });
    if (outcome.code === 0) {
      for (const format of formats.filter((value) => !["gif", "png"].includes(value))) {
        try {
          await encodeAnimation(
            format,
            tapeDir,
            path.join(directory, `${format}-${index + 1}.log`),
            timeout,
          );
        } catch (error) {
          problems.push(`${label}: ${error.message}`);
        }
      }
    }
    for (const format of formats) {
      const file = path.join(tapeDir, `preview.${format}`);
      try {
        await lstat(file);
      } catch {
        if (outcome.code === 0)
          problems.push(`${label}: requested ${format} preview was not produced`);
        continue;
      }
      await collect(tapeDir, file, `${label} (${format})`);
    }
  }

  const extras = await discover(root, extraOutputs, false);
  if (extraOutputs.trim() && !extras.length) problems.push("No files matched extra-outputs");
  for (const file of extras) {
    await collect(root, file, path.relative(root, file));
  }
  const manifest = {
    schema: 1,
    results,
    problems,
    media: media.map(({ name, label, type }) => ({ name, label, type })),
  };
  await writeFile(path.join(directory, "manifest.json"), JSON.stringify(manifest, null, 2));
  const gallery = path.join(directory, `${prefix}.html`);
  await writeFile(gallery, galleryHtml(manifest, media));
  return { ...manifest, media, gallery, directory };
}

export function galleryHtml(manifest, media) {
  const rows = manifest.results
    .map((row) => `<li><code>${html(row.tape)}</code>: ${html(row.status)}</li>`)
    .join("");
  const problems = manifest.problems.map((problem) => `<li>${html(problem)}</li>`).join("");
  const cards = media
    .map((item) => {
      const data = `data:${item.type};base64,${item.bytes.toString("base64")}`;
      const content = item.type.startsWith("video/")
        ? `<video controls preload="metadata" src="${data}"></video>`
        : `<img loading="lazy" alt="${html(item.label)}" src="${data}">`;
      return `<figure>${content}<figcaption>${html(item.label)}</figcaption></figure>`;
    })
    .join("");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; media-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Betamax terminal previews</title>
<style>
:root{color-scheme:light dark;font:16px/1.5 system-ui,sans-serif}
body{max-width:1100px;margin:auto;padding:24px;background:light-dark(#f7f8fc,#141721);color:light-dark(#202635,#e2e6ef)}
h1{font-size:1.8rem}code,figcaption{overflow-wrap:anywhere}
main{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,440px),1fr));gap:20px}
figure{margin:0;padding:16px;border:1px solid light-dark(#b6bfd0,#47536b);border-radius:8px}
img,video{display:block;max-width:100%;height:auto}figcaption{margin-top:12px}
</style></head><body><h1>Terminal previews</h1>
<p>Captured output from this run. Failed tapes may have incomplete previews.</p>
<ul>${rows}</ul>${problems ? `<h2>Could not collect all outputs</h2><ul>${problems}</ul>` : ""}
<main>${cards}</main></body></html>\n`;
}
