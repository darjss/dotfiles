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

import { $, file, exists, mkdir, rm, spawn } from "bun";
import { statSync } from "fs";

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
  await mkdir(TMP, { recursive: true });
  const date = new Date().toISOString().split("T")[0];
  console.log("Backing up to R2 bucket: " + BUCKET + " (" + date + ")\n");

  for (const agent of AGENTS) {
    console.log("-- " + agent.name + " --");
    for (const p of agent.paths) {
      if (!(await exists(p.local))) {
        console.log("  skip (missing): " + p.local);
        continue;
      }

      const stat = await file(p.local).stat();
      const sizeMB = (stat.size / 1024 / 1024).toFixed(1);

      if (isDir(p.local)) {
        const archive = TMP + "/" + p.r2.split("/").pop();
        await mkdir(archive.split("/").slice(0, -1).join("/"), { recursive: true });
        console.log("  compressing " + p.local + " (" + sizeMB + "MB)...");
        await compressDir(p.local, archive);
        const compressedSize = (await file(archive).stat()).size / 1024 / 1024;
        console.log("  -> " + compressedSize.toFixed(1) + "MB, uploading to " + p.r2 + "...");
        await upload(archive, p.r2);
        await rm(archive);
      } else {
        console.log("  uploading " + p.local + " (" + sizeMB + "MB) -> " + p.r2 + "...");
        await upload(p.local, p.r2);
      }
    }
    console.log();
  }

  // Write a manifest
  const manifest = {
    date: new Date().toISOString(),
    machine: await run(["hostname"], { silent: true }).then((s) => s.trim()),
    agents: AGENTS.map((a) => ({ name: a.name, paths: a.paths.map((p) => p.r2) })),
  };
  await Bun.write(TMP + "/manifest.json", JSON.stringify(manifest, null, 2));
  await upload(TMP + "/manifest.json", "manifest.json");
  await rm(TMP + "/manifest.json");

  console.log("Done. Manifest uploaded to manifest.json");
}

async function restore(): Promise<void> {
  await mkdir(TMP, { recursive: true });
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
        await mkdir(destParent, { recursive: true });
        console.log("  decompressing -> " + p.local + "...");
        await decompressDir(tmpFile, destParent);
        await rm(tmpFile);
      } else {
        const destParent = p.local.split("/").slice(0, -1).join("/");
        await mkdir(destParent, { recursive: true });
        await Bun.write(p.local, await file(tmpFile).text());
        await rm(tmpFile);
        console.log("  -> " + p.local);
      }
    }
    console.log();
  }

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
