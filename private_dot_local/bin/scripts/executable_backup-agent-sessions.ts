#!/usr/bin/env bun
/**
 * backup-agent-sessions.ts
 *
 * Backs up coding agent session history to Cloudflare R2.
 * Uses wrangler under the hood (already authed on this machine).
 *
 * Usage:
 *   bun ~/.local/bin/scripts/backup-agent-sessions.ts          # backup all
 *   bun ~/.local/bin/scripts/backup-agent-sessions.ts restore   # restore all
 *   bun ~/.local/bin/scripts/backup-agent-sessions.ts status     # show R2 contents
 *
 * Agents backed up:
 *   - Claude Code  (~/.claude/projects/, ~/.claude/history.jsonl)
 *   - Codex CLI    (~/.codex/sessions/, ~/.codex/archived_sessions/, ~/.codex/history.jsonl)
 *   - Pi           (~/.pi/agent/sessions/, ~/.pi/sessions/)
 *
 * Session dirs are tarballed + zstd compressed before upload.
 * Auth/config is NOT backed up here -- that's in chezmoi (encrypted with age).
 */

import { $, file, spawn } from "bun";
import { statSync, mkdirSync, rmSync, existsSync } from "fs";

const BUCKET = "agent-sessions-backup";
const TMP = "/tmp/agent-sessions-backup";
const HOME = process.env.HOME || "/home/darjs";

interface Agent {
  name: string;
  paths: { local: string; r2: string }[];
}

const AGENTS: Agent[] = [
  {
    name: "claude-code",
    paths: [
      { local: HOME + "/.claude/projects", r2: "claude-code/projects.tar.zst" },
      { local: HOME + "/.claude/history.jsonl", r2: "claude-code/history.jsonl" },
    ],
  },
  {
    name: "codex",
    paths: [
      { local: HOME + "/.codex/sessions", r2: "codex/sessions.tar.zst" },
      { local: HOME + "/.codex/archived_sessions", r2: "codex/archived_sessions.tar.zst" },
      { local: HOME + "/.codex/history.jsonl", r2: "codex/history.jsonl" },
      { local: HOME + "/.codex/session_index.jsonl", r2: "codex/session_index.jsonl" },
    ],
  },
  {
    name: "pi",
    paths: [
      { local: HOME + "/.pi/agent/sessions", r2: "pi/agent-sessions.tar.zst" },
      { local: HOME + "/.pi/sessions", r2: "pi/sessions.tar.zst" },
    ],
  },
];

// Browsers: selectively pick profile files (skip caches)
// Each entry: { dir, files, r2 } — tar the selected files from dir
interface BrowserBackup {
  name: string;
  dir: string;
  files: string[];
  r2: string;
}

const ZEN_PROFILE = HOME + "/.zen/yj1u2lgy.Default (release)";
const HELIUM_PROFILE = HOME + "/.config/net.imput.helium/Default";

const BROWSERS: BrowserBackup[] = [
  {
    name: "zen-browser",
    dir: ZEN_PROFILE,
    files: [
      "places.sqlite", "logins.json", "key4.db", "cert9.db",
      "prefs.js", "extensions.json", "extension-settings.json",
      "containers.json", "search.json.mozlz4", "formhistory.sqlite",
      "permissions.sqlite", "content-prefs.sqlite",
    ],
    r2: "zen-browser/profile.tar.zst",
  },
  {
    name: "zen-extensions",
    dir: ZEN_PROFILE + "/extensions",
    files: [], // empty = all files in dir
    r2: "zen-browser/extensions.tar.zst",
  },
  {
    name: "zen-chrome",
    dir: ZEN_PROFILE + "/chrome",
    files: [],
    r2: "zen-browser/chrome.tar.zst",
  },
  {
    name: "helium-browser",
    dir: HELIUM_PROFILE,
    files: [
      "Bookmarks", "Login Data", "Login Data For Account",
      "Preferences", "Secure Preferences", "History", "Web Data",
    ],
    r2: "helium-browser/profile.tar.zst",
  },
  {
    name: "helium-local-state",
    dir: HOME + "/.config/net.imput.helium",
    files: ["Local State"],
    r2: "helium-browser/local-state.tar.zst",
  },
  {
    name: "helium-extensions",
    dir: HELIUM_PROFILE + "/Extensions",
    files: [],
    r2: "helium-browser/extensions.tar.zst",
  },
];

async function run(cmd: string[], opts?: { silent?: boolean }): Promise<string> {
  const proc = spawn({
    cmd,
    stdout: opts?.silent ? "pipe" : "inherit",
    stderr: opts?.silent ? "pipe" : "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    const stderr = opts?.silent ? await new Response(proc.stderr).text() : "";
    throw new Error("Command failed (" + exitCode + "): " + cmd.join(" ") + "\n" + stderr);
  }
  if (opts?.silent) {
    return await new Response(proc.stdout).text();
  }
  return "";
}

function isDir(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

async function compressDir(dir: string, outPath: string): Promise<void> {
  const parts = dir.split("/");
  const name = parts[parts.length - 1];
  const parent = parts.slice(0, -1).join("/");
  await $`tar -cf - -C ${parent} ${name} | zstd -19 -o ${outPath}`.quiet();
}

async function compressFiles(dir: string, files: string[], outPath: string): Promise<void> {
  // tar specific files from a dir (not the whole dir)
  if (files.length === 0) {
    // empty file list = compress whole dir
    await compressDir(dir, outPath);
    return;
  }
  // Use -C to cd into dir, then list files explicitly
  const fileArgs = files.map((f) => '"' + f + '"').join(" ");
  await $`tar -cf - -C ${dir} ${files} | zstd -19 -o ${outPath}`.quiet();
}

async function decompressDir(archive: string, destParent: string): Promise<void> {
  await $`zstd -d -c ${archive} | tar -xf - -C ${destParent}`.quiet();
}

async function upload(local: string, r2Key: string): Promise<void> {
  await run(["wrangler", "r2", "object", "put", BUCKET + "/" + r2Key, "--file", local], { silent: true });
}

async function download(r2Key: string, local: string): Promise<void> {
  await run(["wrangler", "r2", "object", "get", BUCKET + "/" + r2Key, "--file", local], { silent: true });
}

async function listR2(): Promise<string[]> {
  // wrangler 4.60 has no `r2 object list` — use Cloudflare API directly
  const token = await run(["wrangler", "secret:bulk"] as string[], { silent: true }).catch(() => "");
  // Read the OAuth token from wrangler config
  const wranglerConfig = await file(process.env.HOME + "/.config/.wrangler/config/default.toml").text().catch(() => "");
  const tokenMatch = wranglerConfig.match(/oauth_token = "([^"]+)"/);
  if (!tokenMatch) {
    console.log("  (could not read wrangler token, skipping list)");
    return [];
  }
  const oauthToken = tokenMatch[1];
  const accountId = "8752869fa1eec4bbfc9c6f4f64fd3bfe";

  const resp = await fetch(
    "https://api.cloudflare.com/client/v4/accounts/" + accountId + "/r2/buckets/" + BUCKET + "/objects",
    { headers: { Authorization: "Bearer " + oauthToken } }
  );
  if (!resp.ok) {
    console.log("  (API error: " + resp.status + ")");
    return [];
  }
  const data = await resp.json() as any;
  const result = data.result || [];
  return result.map((r: any) => r.key).filter(Boolean);
}

async function backup(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  console.log("Backing up to R2 bucket: " + BUCKET + " (" + date + ")\n");

  for (const agent of AGENTS) {
    console.log("-- " + agent.name + " --");
    for (const p of agent.paths) {
      if (!(existsSync(p.local))) {
        console.log("  skip (missing): " + p.local);
        continue;
      }

      const stat = await file(p.local).stat();
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

      if (isDir(p.local)) {
        const archive = TMP + "/" + p.r2.split("/").pop();
        mkdirSync(archive.split("/").slice(0, -1).join("/"), { recursive: true });
        console.log("  compressing " + p.local + " (" + sizeMB + "MB)...");
        await compressDir(p.local, archive);
        const compressedSize = (await file(archive).stat()).size / 1024 / 1024;
        console.log("  -> " + compressedSize.toFixed(1) + "MB, uploading to " + p.r2 + "...");
        await upload(archive, p.r2);
        rmSync(archive);
      } else {
        console.log("  uploading " + p.local + " (" + sizeMB + "MB) -> " + p.r2 + "...");
        await upload(p.local, p.r2);
      }
    }
    console.log();
  }

  // Back up browsers
  console.log("-- browsers --");
  for (const b of BROWSERS) {
    if (!existsSync(b.dir)) {
      console.log("  skip (missing): " + b.dir);
      continue;
    }
    const archive = TMP + "/" + b.r2.split("/").pop();
    mkdirSync(archive.split("/").slice(0, -1).join("/"), { recursive: true });
    console.log("  compressing " + b.name + "...");
    await compressFiles(b.dir, b.files, archive);
    const compressedSize = (await file(archive).stat()).size / 1024 / 1024;
    console.log("  -> " + compressedSize.toFixed(1) + "MB, uploading to " + b.r2 + "...");
    await upload(archive, b.r2);
    rmSync(archive);
  }
  console.log();

  // Write a manifest
  const manifest = {
    date: new Date().toISOString(),
    machine: process.env.HOSTNAME || "unknown",
    agents: AGENTS.map((a) => ({ name: a.name, paths: a.paths.map((p) => p.r2) })),
    browsers: BROWSERS.map((b) => ({ name: b.name, r2: b.r2 })),
  };
  await Bun.write(TMP + "/manifest.json", JSON.stringify(manifest, null, 2));
  await upload(TMP + "/manifest.json", "manifest.json");
  rmSync(TMP + "/manifest.json");

  console.log("Done. Manifest uploaded to manifest.json");
}

async function restore(): Promise<void> {
  mkdirSync(TMP, { recursive: true });
  console.log("Restoring from R2 bucket: " + BUCKET + "\n");

  for (const agent of AGENTS) {
    console.log("-- " + agent.name + " --");
    for (const p of agent.paths) {
      console.log("  downloading " + p.r2 + "...");
      const tmpFile = TMP + "/" + p.r2.split("/").pop();

      try {
        await download(p.r2, tmpFile);
      } catch {
        console.log("  skip (not in R2): " + p.r2);
        continue;
      }

      if (p.r2.endsWith(".tar.zst")) {
        const destParent = p.local.split("/").slice(0, -1).join("/");
        mkdirSync(destParent, { recursive: true });
        console.log("  decompressing -> " + p.local + "...");
        await decompressDir(tmpFile, destParent);
        rmSync(tmpFile);
      } else {
        const destParent = p.local.split("/").slice(0, -1).join("/");
        mkdirSync(destParent, { recursive: true });
        await Bun.write(p.local, await file(tmpFile).text());
        rmSync(tmpFile);
        console.log("  -> " + p.local);
      }
    }
    console.log();
  }

  // Restore browsers
  console.log("-- browsers --");
  for (const b of BROWSERS) {
    console.log("  downloading " + b.r2 + "...");
    const tmpFile = TMP + "/" + b.r2.split("/").pop();

    try {
      await download(b.r2, tmpFile);
    } catch {
      console.log("  skip (not in R2): " + b.r2);
      continue;
    }

    // Extract directly into the target dir (files are at tar root level)
    mkdirSync(b.dir, { recursive: true });
    console.log("  decompressing -> " + b.dir + "...");
    await $`zstd -d -c ${tmpFile} | tar -xf - -C ${b.dir}`.quiet();
    rmSync(tmpFile);
  }
  console.log();

  console.log("Restore complete.");
}

async function status(): Promise<void> {
  console.log("R2 bucket: " + BUCKET + "\n");
  const keys = await listR2();
  if (keys.length === 0) {
    console.log("  (empty)");
    return;
  }
  for (const key of keys.sort()) {
    console.log("  " + key);
  }
  console.log("\n" + keys.length + " objects");
}

const cmd = process.argv[2] ?? "backup";

switch (cmd) {
  case "backup":
    await backup();
    break;
  case "restore":
    await restore();
    break;
  case "status":
    await status();
    break;
  default:
    console.log("Usage: backup-agent-sessions.ts [backup|restore|status]");
    process.exit(1);
}
