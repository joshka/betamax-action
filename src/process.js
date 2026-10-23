import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";

// Tape output goes to a bounded file, never to the Actions command interpreter.
// After the timeout, the promise settles within `grace` even if the process group cannot be
// signalled (for example a root-owned sudo child) or a descendant keeps the output pipes open.
export function execute(
  program,
  args,
  { cwd, input, log, timeout = 120_000, grace = 5_000, env = process.env } = {},
) {
  return new Promise((resolve, reject) => {
    const stream = log ? createWriteStream(log, { flags: "a" }) : null;
    stream?.on("error", reject);
    let retained = 0;
    let timedOut = false;
    let abandon;
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
      } catch {
        // The process may have exited, or belong to another user, before the signal arrived.
      }
      abandon = setTimeout(() => {
        child.stdout.destroy();
        child.stderr.destroy();
        child.unref();
        finish(null, "SIGKILL");
      }, grace);
    }, timeout);
    let settled = false;
    const finish = (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(abandon);
      if (stream) stream.end(() => resolve({ code, signal, timedOut }));
      else resolve({ code, signal, timedOut });
    };
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(abandon);
      stream?.end();
      reject(error);
    });
    child.once("close", finish);
  });
}
