/*
 * Generate a GramJS StringSession once on a trusted terminal. Never commit the
 * resulting session string or paste it into the Android client.
 */
import "dotenv/config";
import { createInterface } from "node:readline/promises";
import process from "node:process";
const apiId = Number(process.env.TELEGRAM_API_ID ?? 0); const apiHash = process.env.TELEGRAM_API_HASH ?? "";
if (!apiId || !apiHash) throw new Error("Set TELEGRAM_API_ID and TELEGRAM_API_HASH first");
const telegram = await import("telegram"); const { TelegramClient } = telegram; const { StringSession } = telegram.sessions;
const session = new StringSession(""); const client = new TelegramClient(session, apiId, apiHash, { connectionRetries: 5 });
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (question: string) => rl.question(question);
try {
  await client.start({ phoneNumber: () => ask("Telegram phone number: "), password: () => ask("2FA password (if any): "), phoneCode: () => ask("Code: "), onError: (error: Error) => console.error(error) });
  console.log("TELEGRAM_SESSION=" + client.session.save());
} finally {
  rl.close();
  await client.disconnect();
}
