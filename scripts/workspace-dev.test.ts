// @effect-diagnostics nodeBuiltinImport:off - Exercises the actual launcher against a disposable runner.
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vite-plus/test";

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "workspace-launcher-")));
  mkdirSync(join(root, "scripts"));
  copyFileSync(
    fileURLToPath(new URL("./workspace-dev.mjs", import.meta.url)),
    join(root, "scripts/workspace-dev.mjs"),
  );
  writeFileSync(
    join(root, "scripts/dev-runner.ts"),
    `import { writeFileSync } from "node:fs";
writeFileSync("result.json", JSON.stringify({args:process.argv.slice(2), env:process.env}));`,
  );
  return root;
}

it("launches with checkout-owned state despite an inherited live T3 environment", () => {
  const root = fixture();
  const run = spawnSync(
    process.execPath,
    [join(root, "scripts/workspace-dev.mjs"), "dev", "--dry-run"],
    {
      env: {
        PATH: process.env.PATH,
        T3CODE_HOME: "/live/t3",
        T3CODE_PORT: "3773",
        T3CODE_DEV_AUTH_TOKEN: "parent-secret",
        VITE_WS_URL: "ws://live",
        T3CODE_DISABLE_AUTO_UPDATE: "false",
      },
      encoding: "utf8",
    },
  );
  expect(run.status, run.stderr).toBe(0);
  const result = JSON.parse(readFileSync(join(root, "result.json"), "utf8"));
  expect(result.env.T3CODE_HOME).toBe(join(root, ".t3/workspace-runtime"));
  expect(result.env.T3CODE_DESKTOP_APP_DATA_DIR).toBe(join(root, ".t3/workspace-electron"));
  expect(result.env.T3CODE_DISABLE_AUTO_UPDATE).toBe("true");
  expect(result.env.T3CODE_HOST).toBe("127.0.0.1");
  expect(result.env.T3CODE_DEV_AUTH_TOKEN).toBeUndefined();
  expect(result.env.T3CODE_PORT).toBeUndefined();
  expect(result.env.VITE_WS_URL).toBeUndefined();
  expect(result.args).toContain(join(root, ".t3/workspace-runtime"));
});

it("rejects a home override before starting a server", () => {
  const root = fixture();
  const run = spawnSync(
    process.execPath,
    [join(root, "scripts/workspace-dev.mjs"), "dev", "--home-dir", "/live/t3"],
    { encoding: "utf8" },
  );
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("Usage:");
});

it("rejects a symlink to external application data", () => {
  const root = fixture();
  const outside = mkdtempSync(join(tmpdir(), "workspace-protected-"));
  symlinkSync(outside, join(root, ".t3"), "dir");
  const run = spawnSync(process.execPath, [join(root, "scripts/workspace-dev.mjs"), "dev"], {
    encoding: "utf8",
  });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toContain("outside this checkout");
});
