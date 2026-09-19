import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { digest, regularPath } from "./common.js";
import { execute } from "./process.js";

const CHECKSUMS = {
  "0.1.19-aarch64-unknown-linux-gnu":
    "1694c35935675d9eac567818cee226fdb8fe8cc75035fc68229b396b99ca6b68",
  "0.1.19-x86_64-unknown-linux-gnu":
    "db65ba4b6b57239e0ee26b96970a9277ccba6c8eef2b29c90c829ba9721a944a",
  "0.1.18-x86_64-unknown-linux-gnu":
    "c04bc6716963d7d5158fa0504049776bb0acab693335fbfbd9e393b87a297143",
  "0.1.18-aarch64-unknown-linux-gnu":
    "beb6abcd40a400fbad14b8ee418efa790710ce7fdc4093614044d009669e7f56",
  "0.1.17-x86_64-unknown-linux-gnu":
    "dc41ea5d5f572d2abf10913461734383f00080a67e123c036a6fd497e34c0773",
  "0.1.17-aarch64-unknown-linux-gnu":
    "ced28786becb89606d2912be7a8894abc006535e3f18050e29bc20ea0c30cd52",
};

export async function prepareBinary({ root, directory, binary, version, checksum, dependencies }) {
  const executable = binary
    ? await localBinary(root, binary)
    : await installRelease(directory, version, checksum);
  if (dependencies) await installDependencies(directory);
  return executable;
}

async function localBinary(root, candidate) {
  try {
    const executable = await regularPath(root, candidate);
    await access(executable, constants.X_OK);
    return executable;
  } catch (error) {
    throw new Error(
      `Invalid binary input: provide an existing executable file inside working-directory, without symlinks (${error.message})`,
      { cause: error },
    );
  }
}

async function installRelease(directory, version, checksum) {
  if (process.platform !== "linux" || !["x64", "arm64"].includes(process.arch)) {
    throw new Error("The action supports Ubuntu x64 and ARM64 runners");
  }
  if (!/^\d+\.\d+\.\d+$/.test(version))
    throw new Error("version must be an exact release such as 0.1.18");
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
  return binary;
}

async function installDependencies(directory) {
  await mkdir(directory, { recursive: true });
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
