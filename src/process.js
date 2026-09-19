import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

// Tape output goes to a bounded file, never to the Actions command interpreter.
export function execute(
  program,
  args,
  { cwd, input, log, timeout = 120_000, env = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const stream = log ? createWriteStream(log) : null;
    stream?.on("error", reject);
    let retained = 0;
    let timedOut = false;
    const child = spawn(program, args, {
      cwd,
      env,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const capture = (chunk) => {
      const rest = Math.max(0, 1024 * 1024 - retained);
      if (stream && rest) stream.write(chunk.subarray(0, rest));
      retained += chunk.length;
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.stdin.on("error", () => {});
    child.stdin.end(input);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {}
    }, timeout);
    child.once("error", (error) => {
      clearTimeout(timer);
      stream?.end();
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (stream) stream.end(() => resolve({ code, timedOut }));
      else resolve({ code, timedOut });
    });
  });
}
