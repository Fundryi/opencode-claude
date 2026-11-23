import { spawn } from "node:child_process";
import { closeSync, openSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./log.js";

const SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";
const STALE_LOCK_MS = 10 * 60_000;
let checked = false;

function installedVersion(root: string): string | undefined {
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, "node_modules", SDK_PACKAGE, "package.json"), "utf8"),
    );
    return typeof pkg?.version === "string" ? pkg.version : undefined;
  } catch {
    return undefined;
  }
}

function takeLock(path: string): boolean {
  try {
    closeSync(openSync(path, "wx"));
    return true;
  } catch {}
  try {
    if (Date.now() - statSync(path).mtimeMs < STALE_LOCK_MS) return false;
    unlinkSync(path);
    closeSync(openSync(path, "wx"));
    return true;
  } catch {
    return false;
  }
}

function releaseLock(path: string): void {
  try {
    unlinkSync(path);
  } catch {}
}

export async function updateAgentSdk(
  moduleFile: string = fileURLToPath(import.meta.url),
): Promise<void> {
  if (checked || process.env.OPENCODE_CLAUDE_SDK_UPDATE === "0") return;
  checked = true;
  if (basename(dirname(moduleFile)) !== "dist") return;
  const root = dirname(dirname(moduleFile));
  const installed = installedVersion(root);
  if (!installed) return;
  const lock = join(root, "node_modules", ".sdk-update.lock");
  let locked = false;
  try {
    const res = await fetch(`https://registry.npmjs.org/${SDK_PACKAGE}/latest`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return;
    const latest = ((await res.json()) as { version?: unknown }).version;
    if (typeof latest !== "string" || latest === installed) return;
    if (!takeLock(lock)) return;
    locked = true;
    if (installedVersion(root) === latest) {
      releaseLock(lock);
      return;
    }
    await import(SDK_PACKAGE);
    const child = spawn("bun", ["add", `${SDK_PACKAGE}@^${latest}`, "--omit=optional"], {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    child.on("error", (err) => {
      releaseLock(lock);
      log.warn("[opencode-claude] could not update the Claude Agent SDK", err.message);
    });
    child.on("exit", (code) => {
      releaseLock(lock);
      if (code === 0) {
        log.warn("[opencode-claude] Claude Agent SDK updated; used after the next restart", {
          from: installed,
          to: installedVersion(root),
        });
      } else {
        log.warn("[opencode-claude] Claude Agent SDK update failed", { to: latest, code });
      }
    });
    child.unref();
  } catch (err) {
    if (locked) releaseLock(lock);
    log.warn(
      "[opencode-claude] could not check for a newer Claude Agent SDK",
      err instanceof Error ? err.message : err,
    );
  }
}
