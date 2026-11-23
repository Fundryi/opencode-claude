import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const root = join(import.meta.dir, "..");
const outDir = join(import.meta.dir, ".node-dist");

const script = (dist: string) => `
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";

assert.equal(typeof globalThis.Bun, "undefined", "must run without Bun");
const tmp = mkdtempSync(join(tmpdir(), "opencode-claude-node-"));
process.env.XDG_DATA_HOME = tmp;
process.env.OPENCODE_CLAUDE_STOP_GRACE_MS = "50";
process.env.OPENCODE_CLAUDE_RATE_LIMIT_STORE = join(tmp, "rate-limit.json");
process.env.OPENCODE_CLAUDE_SDK_UPDATE = "0";

const plugin = await import("${dist}/index.js");
assert.ok(plugin.default, "plugin entry exports the plugin");
const { setAuthStatusProbe } = await import("${dist}/detect.js");
setAuthStatusProbe(() => ({ loggedIn: true, detail: "auth-status-oauth" }));
const proxy = await import("${dist}/proxy.js");
const port = await proxy.startProxy();
const base = "http://127.0.0.1:" + port + "/v1";

const handle = (stream, onClose) => ({ stream, interrupt: async () => {}, close: () => onClose?.(), getPid: () => null });
const text = (t) => ({ type: "stream_event", event: { type: "content_block_delta", delta: { type: "text_delta", text: t } } });
const post = (session, body, signal) =>
  fetch(base + "/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", "x-opencode-claude-session": session },
    body: JSON.stringify({ model: "sonnet", messages: [{ role: "user", content: "hi" }], ...body }),
    signal,
  });

try {
  const models = await fetch(base + "/models");
  assert.equal(models.status, 200);
  assert.equal((await models.json()).object, "list");

  proxy.setClaudeQueryStarter(async () =>
    handle((async function* () {
      yield text("NODE_");
      yield text("OK");
      yield { type: "result", is_error: false, stop_reason: "end_turn", usage: {} };
    })()),
  );
  const streamed = await post("node-stream", { stream: true });
  assert.equal(streamed.status, 200);
  assert.match(streamed.headers.get("content-type") ?? "", /text\\/event-stream/);
  const sse = await streamed.text();
  const content = [...sse.matchAll(/"content":"([^"]*)"/g)].map((m) => m[1]).join("");
  assert.equal(content, "NODE_OK");
  assert.match(sse, /data: \\[DONE\\]/);

  const plain = await post("node-plain", { stream: false });
  assert.equal(plain.status, 200);
  assert.equal((await plain.json()).choices[0].message.content, "NODE_OK");

  let closed = false;
  proxy.setClaudeQueryStarter(async () =>
    handle((async function* () {
      yield text("FIRST_CHUNK");
      await new Promise(() => {});
    })(), () => { closed = true; }),
  );
  const abort = new AbortController();
  const live = await post("node-abort", { stream: true }, abort.signal);
  const reader = live.body.getReader();
  let seen = "";
  while (!seen.includes("FIRST_CHUNK")) seen += new TextDecoder().decode((await reader.read()).value);
  abort.abort();
  const deadline = Date.now() + 5000;
  while (!closed && Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
  assert.ok(closed, "a client abort must close the Claude turn");
} finally {
  proxy.setClaudeQueryStarter(null);
  await proxy.stopProxy();
}
console.log("node runtime ok");
process.exit(0);
`;

rmSync(outDir, { recursive: true, force: true });
try {
  const tsc = spawnSync(
    process.execPath,
    [join(root, "node_modules", "typescript", "bin", "tsc"), "-p", join(root, "tsconfig.json"), "--outDir", outDir, "--declaration", "false"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(tsc.status, 0, `build failed:\n${tsc.stdout}${tsc.stderr}`);

  mkdirSync(outDir, { recursive: true });
  const entry = join(outDir, "node-check.mjs");
  writeFileSync(entry, script(pathToFileURL(outDir).href));
  const env: Record<string, string | undefined> = { ...process.env, OPENCHAMBER_RUNTIME: "" };
  const node = spawnSync("node", [entry], { cwd: root, encoding: "utf8", env, timeout: 60_000 });
  assert.ifError(node.error);
  assert.equal(node.status, 0, `Node run failed:\n${node.stdout}${node.stderr}`);
  assert.match(node.stdout, /node runtime ok/);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}
