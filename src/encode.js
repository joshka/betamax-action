import path from "node:path";
import { execute } from "./process.js";

// Betamax 0.1.15 drops captured frame durations in its direct video writer.
// GIF retains those durations; use it as the animation source until that writer is fixed.
export async function encodeAnimation(format, directory, log, timeout) {
  const codecs = {
    webp: ["-loop", "0", "-c:v", "libwebp_anim", "-vf", "fps=30"],
    mp4: [
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2",
      "-movflags",
      "+faststart",
    ],
    webm: [
      "-c:v",
      "libvpx-vp9",
      "-pix_fmt",
      "yuv420p",
      "-vf",
      "fps=30,pad=ceil(iw/2)*2:ceil(ih/2)*2",
    ],
  };
  const result = await execute(
    "ffmpeg",
    [
      "-nostdin",
      "-v",
      "error",
      "-i",
      path.join(directory, "preview.gif"),
      "-fps_mode",
      "cfr",
      ...codecs[format],
      path.join(directory, `preview.${format}`),
    ],
    { timeout, log },
  );
  if (result.code !== 0)
    throw new Error(`${format} conversion failed; check ffmpeg and the conversion log`);
}
