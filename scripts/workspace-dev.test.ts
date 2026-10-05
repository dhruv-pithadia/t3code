// @effect-diagnostics nodeBuiltinImport:off - Exercises the actual launcher against a disposable runner.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { expect, it } from "vite-plus/test";

function fixture() {
  const root = NodeFS.realpathSync(
    NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workspace-launcher-")),
  );
  NodeFS.mkdirSync(NodePath.join(root, "scripts"));
  NodeFS.copyFileSync(
    NodeURL.fileURLToPath(new URL("./workspace-dev.mjs", import.meta.url)),
    NodePath.join(root, "scripts/workspace-dev.mjs"),
  );
  NodeFS.writeFileSync(
    NodePath.join(root, "scripts/dev-runner.ts"),
    `import * as NodeFS from "node:fs";
NodeFS.writeFileSync("result.json", JSON.stringify({args:process.argv.slice(2), env:process.env}));`,
  );
  return root;
}

it("launches with checkout-owned state despite an inherited live Yantrix environment", () => {
  const root = fixture();
  const run = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(root, "scripts/workspace-dev.mjs"), "dev", "--dry-run"],
    {
      env: {
        PATH: process.env.PATH,
        T3CODE_HOME: "/live/upstream",
        T3CODE_DEV_AUTH_TOKEN: "upstream-secret",
        YANTRIX_HOME: "/live/yantrix",
        YANTRIX_PORT: "3773",
        YANTRIX_DEV_AUTH_TOKEN: "parent-secret",
        VITE_WS_URL: "ws://live",
        YANTRIX_DISABLE_AUTO_UPDATE: "false",
      },
      encoding: "utf8",
    },
  );
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(NodeFS.readFileSync(NodePath.join(root, "result.json"), "utf8"));
  expect(result.env.YANTRIX_HOME).toBe(NodePath.join(root, ".yantrix/workspace-runtime"));
  expect(result.env.YANTRIX_DESKTOP_APP_DATA_DIR).toBe(
    NodePath.join(root, ".yantrix/workspace-electron"),
  );
  expect(result.env.YANTRIX_DISABLE_AUTO_UPDATE).toBe("true");
  expect(result.env.YANTRIX_HOST).toBe("127.0.0.1");
  expect(result.env.YANTRIX_DEV_AUTH_TOKEN).toBeUndefined();
  expect(result.env.YANTRIX_PORT).toBeUndefined();
  expect(result.env.T3CODE_HOME).toBeUndefined();
  expect(result.env.T3CODE_DEV_AUTH_TOKEN).toBeUndefined();
  expect(result.env.VITE_WS_URL).toBeUndefined();
  expect(result.args).toContain(NodePath.join(root, ".yantrix/workspace-runtime"));
});

it("rejects a home override before starting a server", () => {
  const root = fixture();
  const run = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(root, "scripts/workspace-dev.mjs"), "dev", "--home-dir", "/live/yantrix"],
    { encoding: "utf8" },
  );
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("Usage:");
});

it("rejects a symlink to external application data", () => {
  const root = fixture();
  const outside = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "workspace-protected-"));
  NodeFS.symlinkSync(outside, NodePath.join(root, ".yantrix"), "dir");
  const run = NodeChildProcess.spawnSync(
    process.execPath,
    [NodePath.join(root, "scripts/workspace-dev.mjs"), "dev"],
    {
      encoding: "utf8",
    },
  );
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("outside this checkout");
});
