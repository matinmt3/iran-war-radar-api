import "dotenv/config";
import { z } from "zod";

const optionalNumber = z.preprocess((v) => (v === "" || v === undefined ? undefined : Number(v)), z.number().finite().optional());
const envSchema = z.object({
  PORT: optionalNumber.default(8787),
  HOST: z.string().default("127.0.0.1"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_PATH: z.string().default("./data/radar.sqlite"),
  PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),
  ADMIN_PASSWORD: z.string().default("change-me"),
  SESSION_SECRET: z.string().min(16).default("development-only-change-this-secret"),
  TELEGRAM_ADMIN_USER_IDS: z.string().default(""),
  TELEGRAM_BOT_TOKEN: z.string().default(""),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(""),
  TELEGRAM_BOT_POLLING: z.string().default("false"),
  TELEGRAM_API_ID: optionalNumber,
  TELEGRAM_API_HASH: z.string().default(""),
  TELEGRAM_SESSION: z.string().default(""),
  GUARDIAN_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),
  GEMINI_MODEL: z.string().default("gemini-2.0-flash"),
  ENABLE_BACKGROUND_POLLING: z.string().default("false"),
  POLL_INTERVAL_SECONDS: optionalNumber.default(300),
  STORE_FULL_TEXT: z.string().default("false")
});

const raw = envSchema.safeParse(process.env);
if (!raw.success) {
  throw new Error(`Invalid environment: ${raw.error.issues.map((i) => i.path.join(".") + " " + i.message).join(", ")}`);
}
if (raw.data.NODE_ENV === "production" && (raw.data.ADMIN_PASSWORD.length < 16 || raw.data.ADMIN_PASSWORD === "change-me" || raw.data.SESSION_SECRET === "development-only-change-this-secret" || raw.data.SESSION_SECRET === "replace-with-a-long-random-secret")) {
  throw new Error("Production requires non-default ADMIN_PASSWORD and SESSION_SECRET");
}

const bool = (v: string | undefined) => v?.toLowerCase() === "true";
const ids = (v: string) => new Set(v.split(",").map((x) => x.trim()).filter(Boolean).map(Number).filter(Number.isFinite));

export const config = {
  ...raw.data,
  port: raw.data.PORT,
  host: raw.data.HOST,
  isProduction: raw.data.NODE_ENV === "production",
  telegramBotPolling: bool(raw.data.TELEGRAM_BOT_POLLING),
  enableBackgroundPolling: bool(raw.data.ENABLE_BACKGROUND_POLLING),
  storeFullText: bool(raw.data.STORE_FULL_TEXT),
  telegramAdminUserIds: ids(raw.data.TELEGRAM_ADMIN_USER_IDS)
};

export type Config = typeof config;
