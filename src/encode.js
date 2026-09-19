import path from "node:path";
import { execute } from "./process.js";

// Betamax has no native WebP writer. Preserve GIF timing, including the last frame's hold.
export async function encodeWebp(directory, log, timeout) {
  const result = await execute(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path.join(directory, "preview.gif"),
      "-loop",
      "0",
      "-c:v",
      "libwebp_anim",
      "-vf",
      "fps=30",
      "-fps_mode",
      "cfr",
      path.join(directory, "preview.webp"),
    ],
    { timeout, log },
  );
  if (result.code !== 0)
    throw new Error("webp conversion failed; check ffmpeg and the conversion log");
}
