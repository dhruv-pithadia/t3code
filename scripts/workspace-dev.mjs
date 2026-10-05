#!/usr/bin/env node
// Local fork entry point. Never inherit the host Yantrix session's runtime configuration.
import * as NodeChildProcess from "node:child_process";
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeOS from "node:os";

const root = NodeFS.realpathSync(
  NodePath.join(NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)), ".."),
);
const [mode = "dev", ...args] = process.argv.slice(2);
if (
  !["dev", "dev:desktop"].includes(mode) ||
  args.some((arg) => !["--dry-run", "--browser"].includes(arg))
) {
  throw new Error(
    "Usage: node scripts/workspace-dev.mjs [dev|dev:desktop] [--dry-run] [--browser]",
  );
}

// oxlint-disable-next-line yantrix/no-global-process-runtime -- Standalone launcher runs before an Effect runtime exists.
const hostPlatform = NodeOS.platform();
if (mode === "dev:desktop" && hostPlatform !== "darwin") {
  throw new Error(
    "The isolated desktop launcher currently supports macOS. Use dev for the web app.",
  );
}

function isolatedDirectory(...parts) {
  const target = NodePath.join(root, ...parts);
  NodeFS.mkdirSync(target, { recursive: true, mode: 0o700 });
  const resolved = NodeFS.realpathSync(target);
  const rel = NodePath.relative(root, resolved);
  if (rel === ".." || rel.startsWith("../") || rel.startsWith("..\\") || NodePath.isAbsolute(rel)) {
    throw new Error(`Refusing a workspace data directory outside this checkout: ${target}`);
  }
  return resolved;
}

// Validate each parent before creating children, including when .yantrix is a symlink.
isolatedDirectory(".yantrix");
const runtime = isolatedDirectory(".yantrix", "workspace-runtime");
const electron = isolatedDirectory(".yantrix", "workspace-electron");
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(T3CODE_|YANTRIX_|VITE_|EXPO_PUBLIC_|ELECTRON_)/.test(key),
  ),
);
Object.assign(env, {
  YANTRIX_HOME: runtime,
  YANTRIX_DESKTOP_APP_DATA_DIR: electron,
  YANTRIX_DESKTOP_APP_NAME: "Yantrix",
  YANTRIX_DESKTOP_APP_USER_MODEL_ID: "dev.dhruvpithadia.yantrix",
  YANTRIX_DISABLE_AUTO_UPDATE: "true",
  YANTRIX_DESKTOP_SKIP_PROTOCOL_REGISTRATION: "1",
  YANTRIX_DEV_INSTANCE: `yantrix:${root}`,
  YANTRIX_HOST: "127.0.0.1",
  YANTRIX_AUTO_BOOTSTRAP_PROJECT_FROM_CWD: "false",
});
console.log(`[workspace] data=${runtime} electron=${electron} updates=disabled`);
const child = NodeChildProcess.spawn(
  process.execPath,
  [
    NodePath.join(root, "scripts/dev-runner.ts"),
    mode,
    "--home-dir",
    runtime,
    "--host",
    "127.0.0.1",
    ...args,
  ],
  { cwd: root, env, stdio: "inherit" },
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => child.kill(signal));
}
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal === "SIGINT" ? 130 : 1);
});
