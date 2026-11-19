import { access, chmod, cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import { constants } from "node:fs";
import path from "node:path";
import { digest, regularPath } from "./common.js";
import { execute } from "./process.js";

const CHECKSUMS = {
  "0.4.0-aarch64-unknown-linux-gnu":
    "c681f900e70f87705c067c7af5f6e256996783d5b281c71797e1fcffe2a84035",
  "0.4.0-x86_64-unknown-linux-gnu":
    "88ee8421247912b91c05da1231d2316afb01ae39d486f28ecd3bf1a441cd640a",
  "0.1.22-aarch64-unknown-linux-gnu":
    "da7fc6dacb2db9ae12034698422ed1f8b0467f5b46d79fdb889689b61cfc97fd",
  "0.1.22-x86_64-unknown-linux-gnu":
    "497c0bbf6da724e90be49e48ade317d99567e4b03e4e86f03c0dac691ec6358f",
  "0.1.20-aarch64-unknown-linux-gnu":
    "c5b0729b60a407df397cb62a897cc4315cb603220d845e86b92bf5fa2b74b397",
  "0.1.20-x86_64-unknown-linux-gnu":
    "389e890509117fca4aee65192dbc92c4691fdd479140c57e5a295b4bf27d3d69",
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

export async function prepareBinary({
  root,
  directory,
  binary,
  version,
  checksum,
  dependencies,
  formats = [],
  fonts = FONTS,
  fontDirectory = path.join(os.homedir(), ".local/share/fonts/betamax"),
  ffmpeg,
  addPath = prependPath,
  info = () => {},
}) {
  const executable = binary
    ? await localBinary(root, binary)
    : await installRelease(directory, version, checksum);
  if (dependencies) {
    await installFfmpeg(directory, formats, info, addPath, ffmpeg);
    await installFonts(fontDirectory, fonts, info);
  }
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

// Betamax bundles JetBrains Mono and writes GIF, PNG and WebP itself; only MP4 and WebM need
// ffmpeg. It comes from a pinned FFmpeg-Builds static release instead of apt, because Ubuntu's
// archives on hosted runners can take minutes to serve packages or stall entirely. Month-end
// autobuilds are kept long term upstream; daily ones are pruned after a few weeks.
const FFMPEG_RELEASE =
  "https://github.com/FFmpeg-Builds/FFmpeg-Builds/releases/download/autobuild-2026-10-31-12-59";
const FFMPEG = {
  x64: {
    name: "ffmpeg-n8.1.3-27-g8dca1586f4-linux64-gpl-8.1",
    sha256: "41e9c565594c390622cf968d82fa4135d9e9a11d06c1515644288cbc844e3380",
  },
  arm64: {
    name: "ffmpeg-n8.1.3-27-g8dca1586f4-linuxarm64-gpl-8.1",
    sha256: "a08c0ee6e1c4e02139344b303002dcc7c37cf125d639f1fbd15dabee40fcb525",
  },
};

export function needsFfmpeg(formats) {
  return formats.some((format) => ["mp4", "webm"].includes(format));
}

// Fallback fonts come from fast CDNs with pinned digests instead of apt: Ubuntu's archives can take
// minutes to serve them. Noto Sans CJK (which also contains Noto Sans Mono CJK) is the upstream
// Sans2.004 release. DejaVu and Noto core are Debian's builds of the same versions Ubuntu 24.04
// ships; the Noto files are byte-identical to Ubuntu's. fontdb and fontconfig both scan
// ~/.local/share/fonts, so nothing needs root.
const CJK = "https://raw.githubusercontent.com/notofonts/noto-cjk/Sans2.004/Sans/OTC";
const DEBIAN = "https://deb.debian.org/debian/pool/main/f";
const FONTS = {
  "NotoSansCJK-Regular.ttc": {
    url: `${CJK}/NotoSansCJK-Regular.ttc`,
    sha256: "b76b0433203017ca80401b2ee0dd69350349871c4b19d504c34dbdd80541690a",
  },
  "NotoSansCJK-Bold.ttc": {
    url: `${CJK}/NotoSansCJK-Bold.ttc`,
    sha256: "faa5f3656a78b2e2d450d27fe8382c778bc2b6bb5ea29c986664a6a435056ceb",
  },
  "fonts-dejavu-core": {
    url: `${DEBIAN}/fonts-dejavu/fonts-dejavu-core_2.37-8_all.deb`,
    sha256: "86635b3d25b3655fc11cb3ecc3af59f0bf19643b02b94f2de48bd10253cdba12",
    deb: true,
  },
  "fonts-dejavu-mono": {
    url: `${DEBIAN}/fonts-dejavu/fonts-dejavu-mono_2.37-8_all.deb`,
    sha256: "3003e98a5debfdeadc7040a7f715fe9fe6fb67f68deacf6049b54e30f07fc014",
    deb: true,
  },
  "fonts-noto-core": {
    url: `${DEBIAN}/fonts-noto/fonts-noto-core_20201225-2_all.deb`,
    sha256: "97978d09b68445fcf85342b106cd2e812d7813e3d5626f9884a5f344c3a55973",
    deb: true,
  },
  "fonts-noto-mono": {
    url: `${DEBIAN}/fonts-noto/fonts-noto-mono_20201225-2_all.deb`,
    sha256: "7636f002caeb4a4082f69e2d9b8eb89da6c50b9c67f55db84e68638049b06006",
    deb: true,
  },
};

async function installFonts(directory, fonts, info) {
  await mkdir(directory, { recursive: true });
  for (const [name, { url, sha256, deb }] of Object.entries(fonts)) {
    const target = path.join(directory, name);
    // A package unpacks to a directory, so a marker records which verified archive it came from.
    const marker = deb ? path.join(target, ".sha256") : target;
    try {
      const installed = await readFile(marker);
      if ((deb ? installed.toString() : digest(installed)) === sha256) continue;
    } catch {
      // Not installed yet.
    }
    info(`Downloading ${name}`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Font download failed for ${name} (HTTP ${response.status})`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (digest(bytes) !== sha256) throw new Error(`Font checksum mismatch for ${name}`);
    if (!deb) {
      await writeFile(target, bytes);
      continue;
    }
    const scratch = await mkdtemp(path.join(os.tmpdir(), "betamax-fonts-"));
    try {
      const archive = path.join(scratch, `${name}.deb`);
      await writeFile(archive, bytes);
      const result = await execute("dpkg-deb", ["-x", archive, path.join(scratch, "root")]);
      if (result.code !== 0) throw new Error(`Could not unpack verified font package ${name}`);
      await rm(target, { recursive: true, force: true });
      await cp(path.join(scratch, "root/usr/share/fonts"), target, { recursive: true });
      await writeFile(marker, sha256);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }
}

async function installFfmpeg(directory, formats, info, addPath, build = FFMPEG[process.arch]) {
  if (!needsFfmpeg(formats)) return;
  if (!build) throw new Error("ffmpeg is available only for x64 and ARM64 runners");
  const { name, sha256, url = `${FFMPEG_RELEASE}/${name}.tar.xz` } = build;
  info(`Downloading ${name}`);
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`ffmpeg download failed (HTTP ${response.status})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (digest(bytes) !== sha256) throw new Error("ffmpeg archive checksum mismatch");
  await mkdir(directory, { recursive: true });
  const archive = path.join(directory, `${name}.tar.xz`);
  await writeFile(archive, bytes);
  const members = ["ffmpeg", "ffprobe"].map((tool) => `${name}/bin/${tool}`);
  const result = await execute("tar", ["-xJf", archive, "-C", directory, ...members]);
  await rm(archive, { force: true });
  if (result.code !== 0) throw new Error("Could not extract verified ffmpeg archive");
  addPath(path.join(directory, name, "bin"));
}

function prependPath(directory) {
  process.env.PATH = `${directory}${path.delimiter}${process.env.PATH ?? ""}`;
}
