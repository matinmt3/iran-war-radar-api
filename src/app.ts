import crypto from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "./config.js";
import { database } from "./db.js";
import { assertSafeRemoteUrl, canonicalUrl, timingSafeEqualText } from "./security.js";
import { seedDemoData } from "./seed.js";
import { ingestion } from "./services/ingestion.js";
import { translator } from "./services/translation.js";
import { TelegramBotConnector, TelegramMtprotoConnector, telegramWebhookAuthorized } from "./connectors/telegram.js";
import { clustering } from "./services/clustering.js";
import type { NewsItem, Source } from "./types.js";

type Session = { tokenHash: string; expiresAt: number };
const sessions = new Map<string, Session>();
const app = express();
app.disable("x-powered-by"); app.set("trust proxy", 1);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({ origin: true, credentials: true, methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"] }));
app.use(express.json({ limit: "512kb", strict: true }));
app.use(rateLimit({ windowMs: 60_000, limit: 240, standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: "too_many_login_attempts" } });

function hashToken(value: string): string { return crypto.createHash("sha256").update(`${value}:${config.SESSION_SECRET}`).digest("hex"); }
function issueSession(): { token: string; expiresAt: number } { const token = crypto.randomBytes(32).toString("base64url"); const expiresAt = Date.now() + 7 * 24 * 60 * 60_000; sessions.set(hashToken(token), { tokenHash: hashToken(token), expiresAt }); return { token, expiresAt }; }
function extractToken(req: Request): string | null { const header = req.header("x-admin-token") ?? req.header("authorization")?.replace(/^Bearer\s+/i, ""); if (header) return header; const cookie = req.header("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith("radar_session=")); return cookie?.slice("radar_session=".length) || null; }
function isAuthenticated(req: Request): boolean { const token = extractToken(req); if (!token) return false; const session = sessions.get(hashToken(token)); if (!session || session.expiresAt < Date.now()) { if (session) sessions.delete(session.tokenHash); return false; } return true; }
function requireAdmin(req: Request, res: Response, next: NextFunction): void { if (!isAuthenticated(req)) { res.status(401).json({ error: "admin_auth_required" }); return; } next(); }
function parseError(error: unknown): string { return error instanceof Error ? error.message.slice(0, 500) : "Unexpected error"; }
function route(handler: (req: Request, res: Response) => Promise<void> | void) { return (req: Request, res: Response, next: NextFunction) => Promise.resolve(handler(req, res)).catch(next); }
function param(req: Request, key: string): string { const value = req.params[key]; return Array.isArray(value) ? value[0] : value; }

const sourceInput = z.object({
  id: z.string().trim().min(1).max(100).optional(), name: z.string().trim().min(1).max(200), type: z.enum(["rss", "telegram_bot", "telegram_mtproto", "guardian", "manual"]),
  url: z.string().trim().max(2000).optional().default(""), telegramHandle: z.string().trim().regex(/^(?:@?[A-Za-z0-9_]{3,64}|-100\d{5,20})$/).nullable().optional(), originalLanguage: z.string().trim().regex(/^[a-zA-Z]{2,12}$/).optional().default("und"), credibilityTier: z.enum(["A", "B", "C", "UNRATED"]).optional().default("UNRATED"), publisherGroup: z.string().trim().max(100).nullable().optional(), discoveryOnly: z.boolean().optional().default(false), enabled: z.boolean().optional().default(true), pollingIntervalMinutes: z.number().int().min(0).max(1440).optional().default(30)
});
const newsInput = z.object({ sourceId: z.string().min(1), externalId: z.string().max(200).nullable().optional(), originalUrl: z.string().max(2000).nullable().optional(), originalLanguage: z.string().regex(/^[a-zA-Z]{2,12}$/).default("und"), originalTitle: z.string().trim().min(1).max(1000), originalText: z.string().trim().min(1).max(20000), publishedAt: z.number().finite().optional(), category: z.string().max(50).optional(), urgency: z.enum(["normal", "important", "breaking"]).optional(), locationName: z.string().max(200).nullable().optional(), country: z.string().max(100).nullable().optional(), latitude: z.number().min(-90).max(90).nullable().optional(), longitude: z.number().min(-180).max(180).nullable().optional(), locationPrecision: z.enum(["unknown", "country", "region", "city"]).optional(), mediaUrl: z.string().max(2000).nullable().optional() });

app.get("/", (_req, res) => {
  res.type("html").send(`<!doctype html>
<html lang="fa" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>سرور رادار جنگ ایران</title><style>
body{margin:0;background:#071426;color:#eaf3ff;font-family:Tahoma,Arial,sans-serif;line-height:1.8}main{max-width:760px;margin:40px auto;padding:24px}.card{background:#10233b;border:1px solid #25445f;border-radius:16px;padding:24px;margin:16px 0}.ok{color:#52e0a5}.muted{color:#a9bdd0}a{color:#55d8ff;text-decoration:none}code{direction:ltr;display:inline-block;background:#071426;padding:2px 8px;border-radius:6px}ul{padding-right:22px}.links{display:flex;gap:10px;flex-wrap:wrap}.links a{background:#16324f;padding:8px 14px;border-radius:8px}</style></head>
<body><main><h1>رادار جنگ ایران</h1><div class="card"><h2 class="ok">✓ سرور در حال اجراست</h2>
<p>این آدرس، بک‌اند اپ اندروید است. برای دیدن خبرها از APK استفاده کنید؛ لینک‌های زیر خروجی خام API را نشان می‌دهند.</p>
<div class="links"><a href="/api/health">سلامت سرور</a><a href="/api/news?limit=20">خبرها</a><a href="/api/sources">منابع</a><a href="/api/stats">آمار</a></div></div>
<div class="card"><h2>راه‌اندازی اپ</h2><ul><li>امولاتور Android Studio: آدرس سرور <code>http://10.0.2.2:8787</code></li><li>خود لپ‌تاپ: <code>http://127.0.0.1:8787</code></li><li>در اپ وارد تب «مدیریت» شوید، آدرس سرور و رمز مدیریت را وارد کنید.</li><li>برای مدیریت منابع وارد تب «منابع» شوید.</li></ul></div>
<p class="muted">Telegram، Guardian و ترجمهٔ Gemini فقط پس از قرار دادن کلیدهای واقعی در فایل server/.env فعال می‌شوند.</p></main></body></html>`);
});

app.get("/api/health", (_req, res) => res.json({ ok: true, service: "iran-war-radar-server", now: Date.now(), storage: "sqlite" }));
app.get("/api/config/status", (_req, res) => res.json({ demoMode: true, telegramBotConfigured: Boolean(config.TELEGRAM_BOT_TOKEN), telegramMtprotoConfigured: Boolean(config.TELEGRAM_API_ID && config.TELEGRAM_API_HASH && config.TELEGRAM_SESSION), geminiConfigured: Boolean(config.GEMINI_API_KEY), guardianConfigured: Boolean(config.GUARDIAN_API_KEY), backgroundPolling: config.enableBackgroundPolling, fullTextStorage: config.storeFullText }));
app.get("/api/sources", route((_req, res) => { const sources = database.listSources(); res.json({ sources, total: sources.length }); }));
app.get("/api/news", route((req, res) => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined; const parsed = { limit: Number(req.query.limit ?? 50), offset: Number(req.query.offset ?? 0), q, sourceId: typeof req.query.sourceId === "string" ? req.query.sourceId : undefined, category: typeof req.query.category === "string" ? req.query.category : undefined, urgency: typeof req.query.urgency === "string" ? req.query.urgency : undefined, status: typeof req.query.status === "string" ? req.query.status : undefined, from: req.query.from ? Number(req.query.from) : undefined, to: req.query.to ? Number(req.query.to) : undefined }; const result = database.listNews(parsed); res.json({ ...result, limit: Math.min(Math.max(parsed.limit || 50, 1), 200), offset: Math.max(parsed.offset || 0, 0), items: result.items });
}));
app.get("/api/news/:id", route((req, res) => { const item = database.getNews(param(req, "id")); if (!item) { res.status(404).json({ error: "news_not_found" }); return; } res.json(item); }));
app.get("/api/clusters", route((req, res) => { const clusters = database.listClusters(Number(String(req.query.limit ?? 100))); res.json({ clusters, total: clusters.length }); }));
app.get("/api/clusters/:id", route((req, res) => { const cluster = database.getCluster(param(req, "id")); if (!cluster) { res.status(404).json({ error: "cluster_not_found" }); return; } const items = database.listNews({ limit: 200, status: "published" }).items.filter((n) => cluster.newsItemIds.includes(n.id)); res.json({ ...cluster, items }); }));
app.get("/api/stats", (_req, res) => res.json(database.sourceStats()));

app.post("/api/admin/login", loginLimiter, route((req, res) => { const password = typeof req.body?.password === "string" ? req.body.password : ""; if (!timingSafeEqualText(password, config.ADMIN_PASSWORD)) { res.status(401).json({ error: "invalid_credentials" }); return; } const session = issueSession(); res.setHeader("Set-Cookie", `radar_session=${session.token}; HttpOnly; SameSite=Lax; Max-Age=${7 * 24 * 60 * 60}${config.isProduction ? "; Secure" : ""}`); res.json({ authenticated: true, token: session.token, expiresAt: session.expiresAt }); }));
app.post("/api/admin/logout", requireAdmin, (_req, res) => { const token = extractToken(_req); if (token) sessions.delete(hashToken(token)); res.setHeader("Set-Cookie", "radar_session=; HttpOnly; SameSite=Lax; Max-Age=0"); res.json({ authenticated: false }); });
app.get("/api/admin/session", (req, res) => { if (!isAuthenticated(req)) { res.status(401).json({ authenticated: false }); return; } res.json({ authenticated: true }); });
app.get("/api/admin/sources", requireAdmin, (_req, res) => res.json({ sources: database.listSources(), total: database.listSources().length }));
app.post("/api/admin/sources", requireAdmin, route(async (req, res) => { const parsed = sourceInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "validation_error", details: parsed.error.flatten() }); return; } const body = parsed.data; if (["rss", "guardian"].includes(body.type)) { try { await assertSafeRemoteUrl(body.url); } catch (error) { res.status(400).json({ error: "unsafe_url", message: parseError(error) }); return; } } const handle = body.telegramHandle && !body.telegramHandle.startsWith("@") && !body.telegramHandle.startsWith("-100") ? `@${body.telegramHandle}` : body.telegramHandle ?? null; const source = database.createSource({ ...body, telegramHandle: handle }); database.addAuditLog({ timestamp: Date.now(), action: "source_created", adminMetadata: JSON.stringify({ sourceId: source.id }) }); res.status(201).json({ source }); }));
app.patch("/api/admin/sources/:id", requireAdmin, route(async (req, res) => { const id = param(req, "id"); const existing = database.getSource(id); if (!existing) { res.status(404).json({ error: "source_not_found" }); return; } const parsed = sourceInput.partial().safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "validation_error", details: parsed.error.flatten() }); return; } const patch = parsed.data; if (patch.url && ["rss", "guardian"].includes(patch.type ?? existing.type)) { try { await assertSafeRemoteUrl(patch.url); } catch (error) { res.status(400).json({ error: "unsafe_url", message: parseError(error) }); return; } } if (patch.telegramHandle && !patch.telegramHandle.startsWith("@") && !patch.telegramHandle.startsWith("-100")) patch.telegramHandle = `@${patch.telegramHandle}`; const source = database.updateSource(id, patch); database.addAuditLog({ timestamp: Date.now(), action: "source_updated", adminMetadata: JSON.stringify({ sourceId: id }) }); res.json({ source }); }));
app.delete("/api/admin/sources/:id", requireAdmin, (req, res) => { const id = param(req, "id"); if (!database.deleteSource(id)) { res.status(404).json({ error: "source_not_found" }); return; } database.addAuditLog({ timestamp: Date.now(), action: "source_deleted", adminMetadata: JSON.stringify({ sourceId: id }) }); res.json({ ok: true }); });
app.post("/api/admin/sources/:id/test", requireAdmin, route(async (req, res) => { const source = database.getSource(param(req, "id")); if (!source) { res.status(404).json({ error: "source_not_found" }); return; } if (source.type === "telegram_bot") { const result = await telegram.testSource(source); res.status(result.ok ? 200 : 502).json(result); return; } if (source.type === "telegram_mtproto") { try { const result = await new TelegramMtprotoConnector().resolveChannel(source.telegramHandle ?? ""); res.json({ ok: true, title: result.title, identifier: result.identifier }); } catch (error) { res.status(502).json({ ok: false, error: parseError(error) }); } return; } if (source.type === "rss" || source.type === "guardian") { try { const connector = await ingestion.connectorFor(source); const items = await connector.fetch(source); res.json({ ok: true, itemCount: items.length, sample: items.slice(0, 1) }); } catch (error) { res.status(502).json({ ok: false, error: parseError(error) }); } return; } res.json({ ok: true, message: "manual source does not require a network test" }); }));
app.post("/api/admin/ingestion/run", requireAdmin, route(async (req, res) => { const result = await ingestion.runAll(typeof req.body?.sourceId === "string" ? req.body.sourceId : undefined); res.json(result); }));
app.post("/api/admin/ingest", requireAdmin, route(async (req, res) => { const result = await ingestion.runAll(typeof req.body?.sourceId === "string" ? req.body.sourceId : undefined); res.json({ ok: true, ...result, itemCount: result.total }); }));
app.post("/api/admin/sources/:id/ingest", requireAdmin, route(async (req, res) => { const result = await ingestion.runSource(param(req, "id")); res.status(result.error ? 502 : 200).json({ ok: !result.error, message: result.error ?? "دریافت انجام شد", ...result }); }));
app.post("/api/admin/news", requireAdmin, route(async (req, res) => { const parsed = newsInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "validation_error", details: parsed.error.flatten() }); return; } if (!database.getSource(parsed.data.sourceId)) { res.status(400).json({ error: "source_not_found" }); return; } const result = await clustering.ingest(parsed.data); database.addAuditLog({ timestamp: Date.now(), action: "news_created", adminMetadata: JSON.stringify({ newsId: result.item.id }) }); res.status(result.duplicate ? 200 : 201).json({ ...result, item: result.item }); }));
app.patch("/api/admin/news/:id", requireAdmin, route((req, res) => { const patch = req.body as Partial<NewsItem>; const allowed: Partial<NewsItem> = {}; for (const key of ["translatedTitle", "translatedSummary", "category", "urgency", "verificationStatus", "locationName", "status", "isBookmarked"] as const) if (key in patch) allowed[key] = patch[key] as never; if (allowed.translatedTitle !== undefined || allowed.translatedSummary !== undefined) allowed.translationStatus = "manually_edited"; const item = database.updateNews(param(req, "id"), allowed); if (!item) { res.status(404).json({ error: "news_not_found" }); return; } res.json(item); }));
app.post("/api/admin/news/:id/translate", requireAdmin, route(async (req, res) => { const item = database.getNews(param(req, "id")); if (!item) { res.status(404).json({ error: "news_not_found" }); return; } const patch = await translator.translateItem(item); const updated = database.updateNews(item.id, patch); res.json({ item: updated, translationStatus: updated?.translationStatus }); }));
app.post("/api/news/:id/bookmark", route((req, res) => { const value = Boolean(req.body?.value); const item = database.setBookmark(param(req, "id"), value); if (!item) { res.status(404).json({ error: "news_not_found" }); return; } res.json(item); }));
app.get("/api/admin/logs", requireAdmin, (_req, res) => res.json({ ingestion: database.listIngestionLogs(), audit: database.listAuditLogs() }));

const telegram = new TelegramBotConnector(clustering, (sourceId) => ingestion.runAll(sourceId));
app.post(["/api/telegram/webhook", "/api/telegram/webhook/:secret"], route(async (req, res) => { const raw = req.header("x-telegram-bot-api-secret-token") ?? param(req, "secret"); const supplied = Array.isArray(raw) ? raw[0] : raw; if (!telegramWebhookAuthorized(config.TELEGRAM_WEBHOOK_SECRET, supplied)) { res.status(401).json({ error: "telegram_webhook_unauthorized" }); return; } const result = await telegram.handleUpdate(req.body); res.json({ ok: true, ...result }); }));

app.use((_req, res) => res.status(404).json({ error: "not_found" }));
app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => { const message = parseError(error); if (config.isProduction) res.status(500).json({ error: "internal_error" }); else res.status(500).json({ error: "internal_error", message }); });

seedDemoData();
if (config.enableBackgroundPolling) setInterval(() => { ingestion.runDue().catch(() => undefined); }, Math.max(30, config.POLL_INTERVAL_SECONDS) * 1000).unref();
telegram.startPolling();

export { app, telegram, sessions };
