import { createHash } from "node:crypto";
import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 40 * 1024 * 1024;
export const MAX_MEDIA = 20;

export function identifier(value, label) {
  if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(value)) {
    throw new Error(`${label} must contain 1–40 lowercase letters, numbers or hyphens`);
  }
  return value;
}

export function integer(value, label, min, max) {
  if (
    !/^\d+$/.test(String(value)) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < min ||
    Number(value) > max
  ) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return Number(value);
}

export function html(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );
}

export function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

// Reject every symlink component, including links that happen to point inside the root.
export async function regularPath(root, candidate, directory = false) {
  const base = await realpath(root);
  const relative = path.relative(path.resolve(root), path.resolve(root, candidate));
  const absolute = path.resolve(base, relative);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Path must stay inside the working directory");
  }
  let part = base;
  for (const component of relative.split(path.sep).filter(Boolean)) {
    part = path.join(part, component);
    if ((await lstat(part)).isSymbolicLink()) throw new Error("Symbolic links are not accepted");
  }
  const stat = await lstat(absolute);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error("Expected a regular path");
  return absolute;
}

export function mediaType(bytes, extension) {
  const ext = extension.toLowerCase();
  const ascii = (start, end) => bytes.subarray(start, end).toString("ascii");
  const matches = {
    png: bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    gif: ["GIF87a", "GIF89a"].includes(ascii(0, 6)),
    webp: ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP",
    jpg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    jpeg: bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    mp4: ascii(4, 8) === "ftyp",
    webm: bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])),
  };
  if (!matches[ext]) throw new Error(`File does not match an accepted media type: ${ext}`);
  return {
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    mp4: "video/mp4",
    webm: "video/webm",
  }[ext];
}

export async function readMedia(root, file) {
  const safe = await regularPath(root, file);
  const stat = await lstat(safe);
  if (stat.size > MAX_FILE_BYTES) throw new Error("Media exceeds the 10 MiB per-file limit");
  const bytes = await readFile(safe);
  const extension = path.extname(safe).slice(1).toLowerCase();
  return { bytes, extension, type: mediaType(bytes, extension) };
}
