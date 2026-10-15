import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const bin = process.platform === "win32"
  ? path.resolve("node_modules/.bin/vitest.cmd")
  : path.resolve("node_modules/.bin/vitest");
const env = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_PATH: path.join(os.tmpdir(), `iran-war-radar-test-${crypto.randomUUID()}.sqlite`),
  ADMIN_PASSWORD: "test-password-only",
  SESSION_SECRET: "test-session-secret-please-change",
  ENABLE_BACKGROUND_POLLING: "false"
};
const result = spawnSync(bin, ["run"], { env, stdio: "inherit", shell: process.platform === "win32" });
process.exit(result.status ?? 1);
