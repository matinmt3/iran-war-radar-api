import { config } from "../config.js";
import { database } from "../db.js";
import { canonicalUrl, sanitizeText } from "../security.js";
import type { IncomingItem, Source } from "../types.js";
import type { ClusteringService } from "../services/clustering.js";

type TelegramChat = { id: number; type?: string; username?: string; title?: string };
type TelegramMessage = { message_id: number; date?: number; text?: string; caption?: string; chat: TelegramChat; from?: { id?: number }; entities?: Array<{ type?: string; offset?: number; length?: number }> };
type TelegramUpdate = { update_id: number; message?: TelegramMessage; edited_message?: TelegramMessage; channel_post?: TelegramMessage; edited_channel_post?: TelegramMessage };

function normalizeHandle(handle: string | undefined): string { return (handle ?? "").replace(/^@/, "").trim().toLowerCase(); }
function messageLink(chat: TelegramChat, id: number): string | null { return chat.username ? `https://t.me/${chat.username}/${id}` : null; }

export class TelegramBotConnector {
  private offset = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  constructor(private readonly clustering: ClusteringService, private readonly syncHandler?: (sourceId?: string) => Promise<unknown>) {}

  get configured(): boolean { return Boolean(config.TELEGRAM_BOT_TOKEN); }
  private endpoint(method: string): string { return `https://api.telegram.org/bot${config.TELEGRAM_BOT_TOKEN}/${method}`; }
  async call<T = unknown>(method: string, body?: Record<string, unknown>): Promise<T> {
    if (!this.configured) throw new Error("TELEGRAM_BOT_TOKEN is not configured");
    const response = await fetch(this.endpoint(method), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}), signal: AbortSignal.timeout(30000) });
    const data = await response.json() as { ok?: boolean; result?: T; description?: string };
    if (!response.ok || !data.ok) throw new Error(`Telegram ${method} failed: ${data.description ?? response.status}`);
    return data.result as T;
  }
  async sendMessage(chatId: number | string, text: string): Promise<void> { await this.call("sendMessage", { chat_id: chatId, text: text.slice(0, 4096), disable_web_page_preview: true }); }

  async processChannelPost(message: TelegramMessage): Promise<{ accepted: boolean; reason?: string }> {
    const handle = normalizeHandle(message.chat.username); const numeric = String(message.chat.id);
    const source = database.getSourceByHandle(handle) ?? database.getSourceByHandle(numeric);
    if (!source || !source.enabled || !["telegram_bot", "telegram_mtproto"].includes(source.type)) return { accepted: false, reason: "channel is not configured" };
    const text = sanitizeText(message.text ?? message.caption ?? "", 20000); if (!text) return { accepted: false, reason: "empty message" };
    const title = text.split(/\n+/)[0].slice(0, 500);
    await this.clustering.ingest({ sourceId: source.id, externalId: String(message.message_id), originalUrl: messageLink(message.chat, message.message_id), originalLanguage: source.originalLanguage, originalTitle: title, originalText: text, publishedAt: message.date ? message.date * 1000 : Date.now() });
    database.updateSource(source.id, { lastFetchedAt: Date.now(), lastSuccessAt: Date.now(), lastError: null });
    return { accepted: true };
  }

  private isAdmin(userId: number | undefined): boolean { return userId != null && config.telegramAdminUserIds.has(userId); }
  private help(): string { return "دستورات رادار:\n/addsource @channel یا -100123456789 [A|B|C|UNRATED] [fa|en|ar]\n/sources\n/testsource @channel\n/pausesource @channel\n/removesource @channel\n/status\n/sync [@channel]\n/help"; }
  private async addChannel(handle: string, chatId: number, tier: Source["credibilityTier"] = "C", language = "fa", type: Source["type"] = "telegram_mtproto"): Promise<void> {
    const normalized = handle.startsWith("-") ? handle : (handle.startsWith("@") ? handle : `@${handle}`);
    const existing = database.getSourceByHandle(normalized);
    const source = existing ? database.updateSource(existing.id, { enabled: true, credibilityTier: tier, originalLanguage: language }) : database.createSource({ name: `کانال تلگرام ${normalized}`, type, url: normalized.startsWith("@") ? `https://t.me/${normalized.slice(1)}` : "", telegramHandle: normalized, originalLanguage: language, credibilityTier: tier, pollingIntervalMinutes: 5 });
    await this.sendMessage(chatId, `منبع ${source?.telegramHandle ?? normalized} ثبت شد. ${type === "telegram_bot" ? "ربات باید در کانال مدیر باشد." : "برای دریافت، حساب MTProto باید به کانال دسترسی داشته باشد."}`);
  }
  private async command(message: TelegramMessage): Promise<void> {
    const text = (message.text ?? "").trim();
    if (!this.isAdmin(message.from?.id)) { if (text.startsWith("/") || /^@?[A-Za-z0-9_]{5,64}$/.test(text) || /^-100\d{5,20}$/.test(text)) await this.sendMessage(message.chat.id, "دسترسی این دستور فقط برای مدیر مجاز است."); return; }
    // Sending a bare public channel handle is a convenient admin shortcut.
    if (!text.startsWith("/")) {
      if (/^@?[A-Za-z0-9_]{5,64}$/.test(text)) return this.addChannel(text, message.chat.id, "C", "fa", "telegram_mtproto");
      if (/^-100\d{5,20}$/.test(text)) {
        try { const resolved = await new TelegramMtprotoConnector().resolveChannel(text); return this.addChannel(resolved.identifier, message.chat.id, "UNRATED", resolved.language ?? "und", "telegram_mtproto"); }
        catch (error) { await this.sendMessage(message.chat.id, `کانال عددی قابل دسترسی نیست: ${error instanceof Error ? error.message : "مجوز MTProto لازم است"}`); return; }
      }
      return;
    }
    const parts = text.split(/\s+/); const command = parts[0].split("@")[0].toLowerCase();
    if (command === "/help" || command === "/start") return this.sendMessage(message.chat.id, this.help());
    if (command === "/sources") {
      const lines = database.listSources().map((s) => `${s.enabled ? "✅" : "⛔️"} ${s.telegramHandle ?? s.name} · ${s.credibilityTier} · ${s.type}`);
      return this.sendMessage(message.chat.id, lines.length ? lines.join("\n") : "هنوز منبع‌ای ثبت نشده است.");
    }
    if (command === "/status") {
      const stats = database.sourceStats();
      return this.sendMessage(message.chat.id, `وضعیت رادار:\nمنابع: ${stats.sources} (فعال: ${stats.enabledSources})\nخبرهای منتشرشده: ${stats.news}\nخوشه‌ها: ${stats.clusters}\nربات: ${this.configured ? "تنظیم‌شده" : "تنظیم‌نشده"}\nMTProto: ${config.TELEGRAM_API_ID && config.TELEGRAM_API_HASH && config.TELEGRAM_SESSION ? "تنظیم‌شده" : "تنظیم‌نشده"}`);
    }
    if (command === "/addsource") {
      const handle = parts[1]; if (!handle || !/^(?:@?[A-Za-z0-9_]{5,64}|-100\d{5,20})$/.test(handle)) return this.sendMessage(message.chat.id, "فرمت: /addsource @channel یا -100123456789 [A|B|C|UNRATED] [fa|en|ar]");
      const tier = ["A", "B", "C", "UNRATED"].includes(parts[2] ?? "") ? parts[2] as Source["credibilityTier"] : "C"; const language = /^[a-z]{2,3}$/i.test(parts[3] ?? "") ? parts[3].toLowerCase() : "fa";
      return this.addChannel(handle, message.chat.id, tier, language, "telegram_mtproto");
    }
    if (command === "/removesource") {
      const handle = parts[1]; const source = handle ? database.getSourceByHandle(handle) : null; if (!source) return this.sendMessage(message.chat.id, "منبع پیدا نشد.");
      database.updateSource(source.id, { enabled: false }); return this.sendMessage(message.chat.id, `منبع ${source.telegramHandle ?? source.name} غیرفعال شد.`);
    }
    if (command === "/pausesource") {
      const handle = parts[1]; const source = handle ? database.getSourceByHandle(handle) : null; if (!source) return this.sendMessage(message.chat.id, "منبع پیدا نشد.");
      database.updateSource(source.id, { enabled: false }); return this.sendMessage(message.chat.id, `پایش ${source.telegramHandle ?? source.name} متوقف شد.`);
    }
    if (command === "/testsource") {
      const handle = parts[1]; const source = handle ? database.getSourceByHandle(handle) : null; if (!source) return this.sendMessage(message.chat.id, "منبع پیدا نشد.");
      try {
        if (source.type === "telegram_bot") {
          const result = await this.testSource(source);
          return this.sendMessage(message.chat.id, result.ok ? `اتصال ${source.telegramHandle ?? source.name} موفق بود.` : `اتصال ناموفق: ${result.error ?? "خطا"}`);
        }
        if (source.type === "telegram_mtproto") {
          const result = await new TelegramMtprotoConnector().resolveChannel(source.telegramHandle ?? "");
          return this.sendMessage(message.chat.id, `کانال قابل دسترسی است: ${result.title ?? result.identifier}`);
        }
        return this.sendMessage(message.chat.id, "این دستور برای کانال تلگرام است؛ فیدهای وب را از پنل اپ تست کنید.");
      } catch (error) {
        return this.sendMessage(message.chat.id, `تست ناموفق: ${error instanceof Error ? error.message : "خطا"}`);
      }
    }
    if (command === "/sync") {
      // Actual ingestion is triggered by the HTTP service; the command acknowledges safely here.
      try { const result = await this.syncHandler?.(parts[1] ? database.getSourceByHandle(parts[1])?.id : undefined); return this.sendMessage(message.chat.id, `دریافت انجام شد: ${JSON.stringify(result ?? { queued: true }).slice(0, 3500)}`); } catch (error) { return this.sendMessage(message.chat.id, `دریافت ناموفق بود: ${error instanceof Error ? error.message : "خطا"}`); }
    }
    return this.sendMessage(message.chat.id, "دستور ناشناخته است. /help");
  }

  async handleUpdate(update: TelegramUpdate): Promise<{ ingested: number; command: boolean }> {
    const post = update.channel_post ?? update.edited_channel_post; if (post) { const result = await this.processChannelPost(post); return { ingested: result.accepted ? 1 : 0, command: false }; }
    const message = update.message ?? update.edited_message; if (message) { await this.command(message); return { ingested: 0, command: true }; }
    return { ingested: 0, command: false };
  }

  async pollOnce(): Promise<number> {
    const updates = await this.call<TelegramUpdate[]>("getUpdates", { offset: this.offset, timeout: 1, allowed_updates: ["message", "edited_message", "channel_post", "edited_channel_post"] });
    let count = 0; for (const update of updates ?? []) { this.offset = Math.max(this.offset, update.update_id + 1); try { count += (await this.handleUpdate(update)).ingested; } catch { /* one malformed update must not stop polling */ } }
    return count;
  }
  startPolling(): void {
    if (!this.configured || !config.telegramBotPolling || this.pollingTimer) return;
    const loop = async () => { try { await this.pollOnce(); } catch { /* retry on next tick */ } this.pollingTimer = setTimeout(loop, 2000); };
    this.pollingTimer = setTimeout(loop, 0);
  }
  stopPolling(): void { if (this.pollingTimer) clearTimeout(this.pollingTimer); this.pollingTimer = null; }
  async testSource(source: Source): Promise<{ ok: boolean; title?: string; error?: string }> {
    if (!source.telegramHandle) return { ok: false, error: "telegramHandle is required" };
    try { const chat = await this.call<TelegramChat>("getChat", { chat_id: source.telegramHandle }); return { ok: true, title: chat.title ?? chat.username }; } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  }
}

export class TelegramMtprotoConnector {
  async resolveChannel(identifier: string): Promise<{ identifier: string; title?: string; language?: string }> {
    if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH || !config.TELEGRAM_SESSION) throw new Error("TELEGRAM_API_ID/HASH/SESSION تنظیم نشده است");
    let telegramModule: any; try { telegramModule = await import("telegram"); } catch { throw new Error("پکیج telegram نصب نشده است"); }
    const { TelegramClient } = telegramModule; const { StringSession } = telegramModule.sessions;
    const client = new TelegramClient(new StringSession(config.TELEGRAM_SESSION), config.TELEGRAM_API_ID, config.TELEGRAM_API_HASH, { connectionRetries: 2 }); await client.connect();
    try {
      const entity = await client.getEntity(identifier);
      const username = entity?.username ? `@${entity.username}` : String(entity?.id ?? identifier);
      return { identifier: username, title: entity?.title ?? entity?.username, language: "und" };
    } finally { await client.disconnect(); }
  }
  async fetch(source: Source): Promise<IncomingItem[]> {
    if (!config.TELEGRAM_API_ID || !config.TELEGRAM_API_HASH || !config.TELEGRAM_SESSION) throw new Error("Telegram MTProto credentials are not configured");
    if (!source.telegramHandle) throw new Error("telegramHandle is required");
    let telegramModule: any;
    try { telegramModule = await import("telegram"); } catch { throw new Error("Optional package 'telegram' is not installed"); }
    const { TelegramClient } = telegramModule; const { StringSession } = telegramModule.sessions;
    const client = new TelegramClient(new StringSession(config.TELEGRAM_SESSION), config.TELEGRAM_API_ID, config.TELEGRAM_API_HASH, { connectionRetries: 2 });
    await client.connect();
    try {
      const messages = await client.getMessages(source.telegramHandle, { limit: 50 });
      return (messages as any[]).filter((m) => (m.message ?? "").trim()).map((m) => ({ sourceId: source.id, externalId: String(m.id), originalUrl: `https://t.me/${source.telegramHandle!.replace(/^@/, "")}/${m.id}`, originalLanguage: source.originalLanguage, originalTitle: sanitizeText(String(m.message).split(/\n+/)[0]), originalText: sanitizeText(String(m.message), 20000), publishedAt: m.date instanceof Date ? m.date.getTime() : Number(m.date ?? Date.now()) }));
    } finally { await client.disconnect(); }
  }
}

export function telegramWebhookAuthorized(secret: string | undefined, header: string | undefined): boolean { return Boolean(secret && header && secret === header); }
