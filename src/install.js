import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { digest } from "./common.js";
import { execute } from "./process.js";

const CHECKSUMS = {
  "0.1.15-x86_64-unknown-linux-gnu":
    "e91f61d5da5835ce1520e9a9d6b5096a5b913ad5b33f7d552ebe54a13b214e3c",
  "0.1.15-aarch64-unknown-linux-gnu":
    "3c1f5e3fa7a05f0fbd5e8a7cb65361e15ee44576e40f106ba92b0d00b75bcc44",
};

export async function install(directory, version, checksum, dependencies) {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
    throw new Error("The action supports Ubuntu x64 and ARM64 runners");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("version must be an exact release such as 0.1.15");
  const target = `${process.arch === "x64" ? "x86_64" : "aarch64"}-unknown-linux-gnu`;
  const expected = checksum || CHECKSUMS[`${version}-${target}`];
  if (!/^[a-f0-9]{64}$/.test(expected ?? ""))
    throw new Error("This version requires an explicit sha256 archive checksum");
  const name = `betamax-${version}-${target}.tgz`;
  const url = `https://github.com/joshka/betamax/releases/download/betamax-v${version}/${name}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Betamax download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== expected) throw new Error("Betamax archive checksum mismatch");
  await mkdir(directory, { recursive: true });
  const archive = path.join(directory, name);
  await writeFile(archive, bytes);
  const result = await execute("tar", ["-xzf", archive, "-C", directory, "betamax"]);
  if (result.code !== 0) throw new Error("Could not extract verified Betamax archive");
  const binary = path.join(directory, "betamax");
  await chmod(binary, 0o755);
  if (dependencies) {
    for (const args of [
      ["apt-get", "update", "-qq"],
      [
        "apt-get",
        "install",
        "-y",
        "-qq",
        "ffmpeg",
        "fonts-dejavu-core",
        "fonts-jetbrains-mono",
        "fonts-noto-core",
        "fonts-noto-cjk",
      ],
    ]) {
      const setup = await execute("sudo", ["-n", ...args], {
        timeout: 300_000,
        log: path.join(directory, "dependencies.log"),
      });
      if (setup.code !== 0)
        throw new Error(
          "Dependency installation failed; install dependencies in an earlier step and set install-dependencies: false",
        );
    }
  }
  return binary;
}
