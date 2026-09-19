import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { mediaType } from "../src/common.js";

// Real fixture assertions: readable media, visible frames, and preserved elapsed time.
const directory = process.env.BETAMAX_OUTPUT_DIRECTORY;
assert.ok(directory, "BETAMAX_OUTPUT_DIRECTORY must point to the render action output");
const manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8"));
assert.deepEqual(manifest.problems, []);
assert.ok(manifest.results.every((result) => result.status === "passed"));
const expected = process.env.BETAMAX_EXPECTED_FORMATS?.split(",").sort();
if (expected) {
  for (const [index, result] of manifest.results.entries()) {
    const produced = manifest.media
      .filter((item) => item.label.startsWith(`${result.tape} (`))
      .map((item) => path.extname(item.name).slice(1))
      .sort();
    assert.deepEqual(produced, expected, "Requested native formats must all be collected");
    const previews = (await readdir(path.join(directory, `tape-${index + 1}`))).sort();
    assert.deepEqual(
      previews,
      expected.map((format) => `preview.${format}`),
    );
  }
}
const files = (await readdir(directory)).filter((name) =>
  /-m\d+\.[a-z0-9][a-z0-9-]{0,59}\.(gif|png|webp|mp4|webm)$/.test(name),
);
assert.ok(files.length > 0, "No preview files were generated");
for (const file of files) {
  const fullPath = path.join(directory, file);
  const bytes = await readFile(fullPath);
  const extension = path.extname(file).slice(1);
  mediaType(bytes, extension);
  if (extension === "webp") {
    let frames = 0;
    let duration = 0;
    const durations = [];
    for (let offset = 12; offset + 8 <= bytes.length;) {
      const kind = bytes.toString("ascii", offset, offset + 4);
      const size = bytes.readUInt32LE(offset + 4);
      assert.ok(offset + 8 + size <= bytes.length, "Truncated WebP chunk");
      if (kind === "ANMF") {
        frames++;
        const hold = bytes.readUIntLE(offset + 8 + 12, 3);
        assert.ok(hold > 0, "WebP frame has no hold");
        durations.push(hold);
        duration += hold;
      }
      offset += 8 + size + (size % 2);
    }
    assert.ok(
      frames >= 3 && duration >= 2400 && duration <= 2700,
      `WebP lost animation timing: ${frames} frames, ${duration}ms`,
    );
    execFileSync("python3", ["scripts/verify-webp.py", fullPath, JSON.stringify(durations)], {
      stdio: "inherit",
    });
  } else if (extension !== "png") {
    const metadata = JSON.parse(
      execFileSync(
        "ffprobe",
        [
          "-v",
          "error",
          "-show_entries",
          "format=duration",
          "-show_entries",
          "stream=width,height",
          "-of",
          "json",
          fullPath,
        ],
        { encoding: "utf8" },
      ),
    );
    assert.ok(Number(metadata.format.duration) >= 2.4, `${file} plays too quickly`);
    assert.ok(Number(metadata.format.duration) <= 2.7, `${file} unexpectedly long`);
    assert.equal(metadata.streams[0].width, 780);
    assert.equal(metadata.streams[0].height, 350);
  } else {
    assert.equal(bytes.readUInt32BE(16), 780);
    assert.equal(bytes.readUInt32BE(20), 350);
  }
  console.log(`Verified ${file}`);
}
