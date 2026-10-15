import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { config } from "./config.js";
import { randomId } from "./security.js";
import type { AuditLog, IngestionLog, NewsItem, Source, StoryCluster } from "./types.js";

type SourceRow = Record<string, unknown>;
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as { DatabaseSync: new (filename: string) => any };

function sourceFromRow(row: SourceRow): Source {
  return {
    id: String(row.id), name: String(row.name), type: row.type as Source["type"], url: String(row.url ?? ""),
    telegramHandle: row.telegram_handle ? String(row.telegram_handle) : null, originalLanguage: String(row.original_language ?? "und"),
    credibilityTier: (row.credibility_tier ?? "UNRATED") as Source["credibilityTier"], publisherGroup: row.publisher_group ? String(row.publisher_group) : null, discoveryOnly: Boolean(row.discovery_only), enabled: Boolean(row.enabled),
    pollingIntervalMinutes: Number(row.polling_interval_minutes ?? 30), lastFetchedAt: row.last_fetched_at == null ? null : Number(row.last_fetched_at),
    lastSuccessAt: row.last_success_at == null ? null : Number(row.last_success_at), lastError: row.last_error ? String(row.last_error) : null,
    createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

function newsFromRow(row: SourceRow): NewsItem {
  return {
    id: String(row.id), sourceId: String(row.source_id), externalId: row.external_id == null ? null : String(row.external_id),
    originalUrl: row.original_url == null ? null : String(row.original_url), originalLanguage: String(row.original_language ?? "und"),
    originalTitle: String(row.original_title ?? ""), originalText: String(row.original_text ?? ""), translatedTitle: String(row.translated_title ?? row.original_title ?? ""),
    translatedSummary: String(row.translated_summary ?? ""), translationStatus: (row.translation_status ?? "pending") as NewsItem["translationStatus"],
    publishedAt: Number(row.published_at), collectedAt: Number(row.collected_at), category: String(row.category ?? "other"),
    urgency: (row.urgency ?? "normal") as NewsItem["urgency"], verificationStatus: (row.verification_status ?? "unverified") as NewsItem["verificationStatus"],
    locationName: row.location_name == null ? null : String(row.location_name), country: row.country == null ? null : String(row.country),
    latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude),
    locationPrecision: (row.location_precision ?? "unknown") as NewsItem["locationPrecision"], mediaUrl: row.media_url == null ? null : String(row.media_url),
    contentHash: String(row.content_hash ?? ""), storyClusterId: row.story_cluster_id == null ? null : String(row.story_cluster_id),
    status: (row.status ?? "published") as NewsItem["status"], createdAt: Number(row.created_at), updatedAt: Number(row.updated_at), isBookmarked: Boolean(row.is_bookmarked)
  };
}

function clusterFromRow(row: SourceRow): StoryCluster {
  let ids: string[] = [];
  try { ids = JSON.parse(String(row.news_item_ids ?? "[]")); } catch { ids = []; }
  return {
    id: String(row.id), canonicalTitleFa: String(row.canonical_title_fa ?? ""), summaryFa: String(row.summary_fa ?? ""), category: String(row.category ?? "other"),
    verificationStatus: (row.verification_status ?? "unverified") as StoryCluster["verificationStatus"], firstReportedAt: Number(row.first_reported_at),
    lastReportedAt: Number(row.last_reported_at), locationName: row.location_name == null ? null : String(row.location_name), latitude: row.latitude == null ? null : Number(row.latitude), longitude: row.longitude == null ? null : Number(row.longitude), sourceCount: Number(row.source_count ?? 0), newsItemIds: ids, createdAt: Number(row.created_at), updatedAt: Number(row.updated_at)
  };
}

export class RadarDatabase {
  // Keep the wrapper loosely typed: Node 22/26 ship slightly different
  // node:sqlite parameter typings, while the runtime API is stable here.
  readonly db: any;

  constructor(filePath = config.DATABASE_PATH) {
    const resolved = path.resolve(filePath);
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    this.db = new DatabaseSync(resolved);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL DEFAULT '', telegram_handle TEXT,
        original_language TEXT NOT NULL DEFAULT 'und', credibility_tier TEXT NOT NULL DEFAULT 'UNRATED', publisher_group TEXT, discovery_only INTEGER NOT NULL DEFAULT 0, enabled INTEGER NOT NULL DEFAULT 1,
        polling_interval_minutes INTEGER NOT NULL DEFAULT 30, last_fetched_at INTEGER, last_success_at INTEGER, last_error TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_sources_handle ON sources(telegram_handle) WHERE telegram_handle IS NOT NULL;
      CREATE TABLE IF NOT EXISTS news_items (
        id TEXT PRIMARY KEY, source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE, external_id TEXT, original_url TEXT,
        original_language TEXT NOT NULL DEFAULT 'und', original_title TEXT NOT NULL, original_text TEXT NOT NULL, translated_title TEXT NOT NULL DEFAULT '',
        translated_summary TEXT NOT NULL DEFAULT '', translation_status TEXT NOT NULL DEFAULT 'pending', published_at INTEGER NOT NULL, collected_at INTEGER NOT NULL,
        category TEXT NOT NULL DEFAULT 'other', urgency TEXT NOT NULL DEFAULT 'normal', verification_status TEXT NOT NULL DEFAULT 'unverified', location_name TEXT,
        country TEXT, latitude REAL, longitude REAL, location_precision TEXT NOT NULL DEFAULT 'unknown', media_url TEXT, content_hash TEXT NOT NULL,
        story_cluster_id TEXT, status TEXT NOT NULL DEFAULT 'published', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, is_bookmarked INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_id, external_id), UNIQUE(content_hash)
      );
      CREATE INDEX IF NOT EXISTS idx_news_published ON news_items(published_at DESC);
      CREATE INDEX IF NOT EXISTS idx_news_cluster ON news_items(story_cluster_id);
      CREATE TABLE IF NOT EXISTS story_clusters (
        id TEXT PRIMARY KEY, canonical_title_fa TEXT NOT NULL, summary_fa TEXT NOT NULL DEFAULT '', category TEXT NOT NULL DEFAULT 'other',
        verification_status TEXT NOT NULL DEFAULT 'unverified', first_reported_at INTEGER NOT NULL, last_reported_at INTEGER NOT NULL, location_name TEXT,
        latitude REAL, longitude REAL, source_count INTEGER NOT NULL DEFAULT 0, news_item_ids TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ingestion_logs (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, source_id TEXT, status TEXT NOT NULL, item_count INTEGER NOT NULL DEFAULT 0, error_message TEXT);
      CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, timestamp INTEGER NOT NULL, action TEXT NOT NULL, admin_metadata TEXT NOT NULL DEFAULT '');
    `);
    const columns = (this.db.prepare("PRAGMA table_info(sources)").all() as Array<{ name: string }>).map((c) => c.name);
    if (!columns.includes("publisher_group")) this.db.exec("ALTER TABLE sources ADD COLUMN publisher_group TEXT");
    if (!columns.includes("discovery_only")) this.db.exec("ALTER TABLE sources ADD COLUMN discovery_only INTEGER NOT NULL DEFAULT 0");
  }

  close(): void { this.db.close(); }

  listSources(includeDisabled = true): Source[] {
    const sql = includeDisabled ? "SELECT * FROM sources ORDER BY credibility_tier ASC, name ASC" : "SELECT * FROM sources WHERE enabled=1 ORDER BY credibility_tier ASC, name ASC";
    return (this.db.prepare(sql).all() as SourceRow[]).map(sourceFromRow);
  }
  getSource(id: string): Source | null {
    const row = this.db.prepare("SELECT * FROM sources WHERE id=?").get(id) as SourceRow | undefined;
    return row ? sourceFromRow(row) : null;
  }
  getSourceByHandle(handle: string): Source | null {
    const normalized = handle.trim().replace(/^@/, "").toLowerCase();
    const row = this.db.prepare("SELECT * FROM sources WHERE lower(replace(telegram_handle,'@',''))=?").get(normalized) as SourceRow | undefined;
    return row ? sourceFromRow(row) : null;
  }
  upsertSource(source: Source): Source {
    this.db.prepare(`INSERT INTO sources(id,name,type,url,telegram_handle,original_language,credibility_tier,publisher_group,discovery_only,enabled,polling_interval_minutes,last_fetched_at,last_success_at,last_error,created_at,updated_at)
      VALUES(@id,@name,@type,@url,@telegramHandle,@originalLanguage,@credibilityTier,@publisherGroup,@discoveryOnly,@enabled,@pollingIntervalMinutes,@lastFetchedAt,@lastSuccessAt,@lastError,@createdAt,@updatedAt)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,url=excluded.url,telegram_handle=excluded.telegram_handle,original_language=excluded.original_language,credibility_tier=excluded.credibility_tier,publisher_group=excluded.publisher_group,discovery_only=excluded.discovery_only,enabled=excluded.enabled,polling_interval_minutes=excluded.polling_interval_minutes,last_fetched_at=excluded.last_fetched_at,last_success_at=excluded.last_success_at,last_error=excluded.last_error,updated_at=excluded.updated_at`).run({ ...source, telegramHandle: source.telegramHandle, originalLanguage: source.originalLanguage, credibilityTier: source.credibilityTier, publisherGroup: source.publisherGroup, discoveryOnly: source.discoveryOnly ? 1 : 0, enabled: source.enabled ? 1 : 0 });
    return this.getSource(source.id)!;
  }
  createSource(input: Partial<Source> & Pick<Source, "name" | "type">): Source {
    const now = Date.now();
    const source: Source = { id: input.id ?? randomId("src_"), name: input.name, type: input.type, url: input.url ?? "", telegramHandle: input.telegramHandle ?? null, originalLanguage: input.originalLanguage ?? "und", credibilityTier: input.credibilityTier ?? "UNRATED", publisherGroup: input.publisherGroup ?? null, discoveryOnly: input.discoveryOnly ?? false, enabled: input.enabled ?? true, pollingIntervalMinutes: input.pollingIntervalMinutes ?? 30, lastFetchedAt: null, lastSuccessAt: null, lastError: null, createdAt: input.createdAt ?? now, updatedAt: now };
    return this.upsertSource(source);
  }
  updateSource(id: string, patch: Partial<Source>): Source | null {
    const current = this.getSource(id); if (!current) return null;
    return this.upsertSource({ ...current, ...patch, id, updatedAt: Date.now() });
  }
  deleteSource(id: string): boolean { return this.db.prepare("DELETE FROM sources WHERE id=?").run(id).changes > 0; }

  listNews(options: { limit?: number; offset?: number; q?: string; sourceId?: string; category?: string; urgency?: string; status?: string; from?: number; to?: number } = {}): { items: NewsItem[]; total: number } {
    const where: string[] = ["1=1"]; const params: Record<string, unknown> = {};
    if (options.sourceId) { where.push("n.source_id=@sourceId"); params.sourceId = options.sourceId; }
    if (options.category) { where.push("n.category=@category"); params.category = options.category; }
    if (options.urgency) { where.push("n.urgency=@urgency"); params.urgency = options.urgency; }
    if (options.status) { where.push("n.status=@status"); params.status = options.status; } else where.push("n.status NOT IN ('archived','rejected')");
    if (options.from != null) { where.push("n.published_at>=@from"); params.from = options.from; }
    if (options.to != null) { where.push("n.published_at<=@to"); params.to = options.to; }
    if (options.q) { where.push("(n.original_title LIKE @q OR n.translated_title LIKE @q OR n.original_text LIKE @q OR n.translated_summary LIKE @q)"); params.q = `%${options.q.slice(0, 200)}%`; }
    const total = Number((this.db.prepare(`SELECT count(*) as count FROM news_items n WHERE ${where.join(" AND ")}`).get(params as any) as { count: number }).count);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200); const offset = Math.max(options.offset ?? 0, 0);
    const rows = this.db.prepare(`SELECT n.*, s.name as source_name, s.type as source_type, s.credibility_tier as source_credibility_tier FROM news_items n LEFT JOIN sources s ON s.id=n.source_id WHERE ${where.join(" AND ")} ORDER BY n.published_at DESC LIMIT @limit OFFSET @offset`).all({ ...params, limit, offset } as any) as SourceRow[];
    return { items: rows.map((r) => ({ ...newsFromRow(r), source: r.source_name ? { id: String(r.source_id), name: String(r.source_name), type: r.source_type as Source["type"], url: "", telegramHandle: null, originalLanguage: "und", credibilityTier: (r.source_credibility_tier ?? "UNRATED") as Source["credibilityTier"], publisherGroup: null, discoveryOnly: false, enabled: true, pollingIntervalMinutes: 0, lastFetchedAt: null, lastSuccessAt: null, lastError: null, createdAt: 0, updatedAt: 0 } : undefined })) , total };
  }
  getNews(id: string): NewsItem | null { const row = this.db.prepare("SELECT * FROM news_items WHERE id=?").get(id) as SourceRow | undefined; return row ? newsFromRow(row) : null; }
  getNewsByExternal(sourceId: string, externalId: string): NewsItem | null { const row = this.db.prepare("SELECT * FROM news_items WHERE source_id=? AND external_id=?").get(sourceId, externalId) as SourceRow | undefined; return row ? newsFromRow(row) : null; }
  getNewsByHash(hash: string): NewsItem | null { const row = this.db.prepare("SELECT * FROM news_items WHERE content_hash=?").get(hash) as SourceRow | undefined; return row ? newsFromRow(row) : null; }
  insertNews(item: NewsItem): NewsItem {
    const { source: _source, ...values } = item;
    this.db.prepare(`INSERT INTO news_items(id,source_id,external_id,original_url,original_language,original_title,original_text,translated_title,translated_summary,translation_status,published_at,collected_at,category,urgency,verification_status,location_name,country,latitude,longitude,location_precision,media_url,content_hash,story_cluster_id,status,created_at,updated_at,is_bookmarked)
      VALUES(@id,@sourceId,@externalId,@originalUrl,@originalLanguage,@originalTitle,@originalText,@translatedTitle,@translatedSummary,@translationStatus,@publishedAt,@collectedAt,@category,@urgency,@verificationStatus,@locationName,@country,@latitude,@longitude,@locationPrecision,@mediaUrl,@contentHash,@storyClusterId,@status,@createdAt,@updatedAt,@isBookmarked)`).run({ ...values, isBookmarked: item.isBookmarked ? 1 : 0 } as any);
    return this.getNews(item.id)!;
  }
  updateNews(id: string, patch: Partial<NewsItem>): NewsItem | null {
    const current = this.getNews(id); if (!current) return null;
    const next = { ...current, ...patch, id, updatedAt: Date.now() } as NewsItem;
    const { source: _source, ...values } = next;
    this.db.prepare(`UPDATE news_items SET source_id=@sourceId,external_id=@externalId,original_url=@originalUrl,original_language=@originalLanguage,original_title=@originalTitle,original_text=@originalText,translated_title=@translatedTitle,translated_summary=@translatedSummary,translation_status=@translationStatus,published_at=@publishedAt,collected_at=@collectedAt,category=@category,urgency=@urgency,verification_status=@verificationStatus,location_name=@locationName,country=@country,latitude=@latitude,longitude=@longitude,location_precision=@locationPrecision,media_url=@mediaUrl,content_hash=@contentHash,story_cluster_id=@storyClusterId,status=@status,created_at=@createdAt,updated_at=@updatedAt,is_bookmarked=@isBookmarked WHERE id=@id`).run({ ...values, isBookmarked: next.isBookmarked ? 1 : 0 } as any);
    return this.getNews(id);
  }
  setBookmark(id: string, value: boolean): NewsItem | null { return this.updateNews(id, { isBookmarked: value }); }

  listClusters(limit = 100): StoryCluster[] { return (this.db.prepare("SELECT * FROM story_clusters ORDER BY last_reported_at DESC LIMIT ?").all(Math.min(limit, 200)) as SourceRow[]).map(clusterFromRow); }
  getCluster(id: string): StoryCluster | null { const row = this.db.prepare("SELECT * FROM story_clusters WHERE id=?").get(id) as SourceRow | undefined; return row ? clusterFromRow(row) : null; }
  upsertCluster(cluster: StoryCluster): StoryCluster { this.db.prepare(`INSERT INTO story_clusters(id,canonical_title_fa,summary_fa,category,verification_status,first_reported_at,last_reported_at,location_name,latitude,longitude,source_count,news_item_ids,created_at,updated_at) VALUES(@id,@canonicalTitleFa,@summaryFa,@category,@verificationStatus,@firstReportedAt,@lastReportedAt,@locationName,@latitude,@longitude,@sourceCount,@newsItemIds,@createdAt,@updatedAt) ON CONFLICT(id) DO UPDATE SET canonical_title_fa=excluded.canonical_title_fa,summary_fa=excluded.summary_fa,category=excluded.category,verification_status=excluded.verification_status,first_reported_at=excluded.first_reported_at,last_reported_at=excluded.last_reported_at,location_name=excluded.location_name,latitude=excluded.latitude,longitude=excluded.longitude,source_count=excluded.source_count,news_item_ids=excluded.news_item_ids,updated_at=excluded.updated_at`).run({ ...cluster, newsItemIds: JSON.stringify(cluster.newsItemIds) }); return this.getCluster(cluster.id)!; }
  addItemToCluster(itemId: string, clusterId: string): void { this.db.prepare("UPDATE news_items SET story_cluster_id=? WHERE id=?").run(clusterId, itemId); }

  addIngestionLog(log: Omit<IngestionLog, "id"> & { id?: string }): IngestionLog { const value = { id: log.id ?? randomId("log_"), ...log }; this.db.prepare("INSERT INTO ingestion_logs(id,timestamp,source_id,status,item_count,error_message) VALUES(@id,@timestamp,@sourceId,@status,@itemCount,@errorMessage)").run(value); return value; }
  listIngestionLogs(limit = 100): IngestionLog[] { return (this.db.prepare("SELECT id,timestamp,source_id as sourceId,status,item_count as itemCount,error_message as errorMessage FROM ingestion_logs ORDER BY timestamp DESC LIMIT ?").all(Math.min(limit, 500)) as unknown as IngestionLog[]); }
  addAuditLog(log: Omit<AuditLog, "id"> & { id?: string }): AuditLog { const value = { id: log.id ?? randomId("audit_"), ...log }; this.db.prepare("INSERT INTO audit_logs(id,timestamp,action,admin_metadata) VALUES(@id,@timestamp,@action,@adminMetadata)").run(value); return value; }
  listAuditLogs(limit = 100): AuditLog[] { return (this.db.prepare("SELECT id,timestamp,action,admin_metadata as adminMetadata FROM audit_logs ORDER BY timestamp DESC LIMIT ?").all(Math.min(limit, 500)) as unknown as AuditLog[]); }

  sourceStats(): { sources: number; enabledSources: number; news: number; clusters: number; lastIngestionAt: number | null } {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as { count: number }).count);
    const last = this.db.prepare("SELECT max(timestamp) as value FROM ingestion_logs").get() as { value: number | null };
    return { sources: count("SELECT count(*) as count FROM sources"), enabledSources: count("SELECT count(*) as count FROM sources WHERE enabled=1"), news: count("SELECT count(*) as count FROM news_items WHERE status='published'"), clusters: count("SELECT count(*) as count FROM story_clusters"), lastIngestionAt: last.value == null ? null : Number(last.value) };
  }

  seedSources(): void {
    const sources: Array<Partial<Source> & Pick<Source, "name" | "type">> = [
      { id: "src_bbc_me", name: "BBC Middle East (RSS)", type: "rss", url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml", originalLanguage: "en", credibilityTier: "A", publisherGroup: "bbc", pollingIntervalMinutes: 5 },
      { id: "src_bbc_fa", name: "بی‌بی‌سی فارسی (RSS)", type: "rss", url: "https://feeds.bbci.co.uk/persian/rss.xml", originalLanguage: "fa", credibilityTier: "A", publisherGroup: "bbc", pollingIntervalMinutes: 5 },
      { id: "src_aljazeera", name: "Al Jazeera English (RSS)", type: "rss", url: "https://www.aljazeera.com/xml/rss/all.xml", originalLanguage: "en", credibilityTier: "A", publisherGroup: "aljazeera", pollingIntervalMinutes: 5 },
      { id: "src_dw_en", name: "DW English (RSS)", type: "rss", url: "https://rss.dw.com/rdf/rss-en-all", originalLanguage: "en", credibilityTier: "A", publisherGroup: "dw", pollingIntervalMinutes: 5 },
      { id: "src_dw_fa", name: "دویچه‌وله فارسی (RSS)", type: "rss", url: "https://rss.dw.com/rdf/rss-fa-all", originalLanguage: "fa", credibilityTier: "A", publisherGroup: "dw", pollingIntervalMinutes: 5 },
      { id: "src_france24_me", name: "France 24 Middle East (RSS)", type: "rss", url: "https://www.france24.com/en/middle-east/rss", originalLanguage: "en", credibilityTier: "A", publisherGroup: "france24", pollingIntervalMinutes: 5 },
      { id: "src_centcom", name: "U.S. CENTCOM public releases (RSS)", type: "rss", url: "https://www.centcom.mil/DesktopModules/ArticleCS/RSS.ashx?ContentType=1&Site=808&max=20/feed", originalLanguage: "en", credibilityTier: "B", publisherGroup: "centcom", pollingIntervalMinutes: 10 },
      { id: "src_guardian", name: "The Guardian (API)", type: "guardian", url: "https://content.guardianapis.com/search", originalLanguage: "en", credibilityTier: "A", publisherGroup: "guardian", pollingIntervalMinutes: 10 },
      { id: "src_gdelt", name: "GDELT Live Discovery (RSS)", type: "rss", url: "https://data.gdeltproject.org/gdeltv3/gal/feed.rss", originalLanguage: "multi", credibilityTier: "C", publisherGroup: "gdelt", discoveryOnly: true, pollingIntervalMinutes: 1 },
      { id: "src_tg_bbcpersian", name: "BBC Persian (Telegram)", type: "telegram_mtproto", url: "https://t.me/bbcpersian", telegramHandle: "@bbcpersian", originalLanguage: "fa", credibilityTier: "A", publisherGroup: "bbc", pollingIntervalMinutes: 2 },
      { id: "src_tg_iranintl", name: "Iran International TV (Telegram)", type: "telegram_mtproto", url: "https://t.me/IranintlTV", telegramHandle: "@IranintlTV", originalLanguage: "fa", credibilityTier: "B", publisherGroup: "iranintl", pollingIntervalMinutes: 2 },
      { id: "src_tg_isna", name: "ایسنا (تلگرام)", type: "telegram_mtproto", url: "https://t.me/isna94", telegramHandle: "@isna94", originalLanguage: "fa", credibilityTier: "B", publisherGroup: "isna", pollingIntervalMinutes: 2 },
      { id: "src_tg_irna", name: "ایرنا (تلگرام)", type: "telegram_mtproto", url: "https://t.me/irna_1313", telegramHandle: "@irna_1313", originalLanguage: "fa", credibilityTier: "B", publisherGroup: "irna", pollingIntervalMinutes: 2 },
      { id: "src_tg_tasnim", name: "تسنیم (تلگرام)", type: "telegram_mtproto", url: "https://t.me/Tasnimnews", telegramHandle: "@Tasnimnews", originalLanguage: "fa", credibilityTier: "B", publisherGroup: "tasnim", pollingIntervalMinutes: 2 },
      { id: "src_tg_fars", name: "فارس (تلگرام)", type: "telegram_mtproto", url: "https://t.me/Farsna", telegramHandle: "@Farsna", originalLanguage: "fa", credibilityTier: "B", publisherGroup: "fars", pollingIntervalMinutes: 2 },
      { id: "src_tg_idf", name: "IDF official statements (Telegram)", type: "telegram_mtproto", url: "https://t.me/idfofficial", telegramHandle: "@idfofficial", originalLanguage: "en", credibilityTier: "B", publisherGroup: "idf", pollingIntervalMinutes: 2 },
      { id: "src_demo_channel", name: "کانال مدیر (@example_public_channel)", type: "telegram_mtproto", url: "https://t.me/example_public_channel", telegramHandle: "@example_public_channel", originalLanguage: "ar", credibilityTier: "C", publisherGroup: "demo-channel", pollingIntervalMinutes: 2 },
      { id: "src_tg_mes", name: "Middle East Spectator (Telegram)", type: "telegram_mtproto", url: "https://t.me/Middle_East_Spectator", telegramHandle: "@Middle_East_Spectator", originalLanguage: "en", credibilityTier: "C", publisherGroup: "middle-east-spectator", pollingIntervalMinutes: 2 },
      { id: "src_tg_clashreport", name: "Clash Report (Telegram)", type: "telegram_mtproto", url: "https://t.me/ClashReport", telegramHandle: "@ClashReport", originalLanguage: "en", credibilityTier: "C", publisherGroup: "clash-report", pollingIntervalMinutes: 2 },
      { id: "src_manual", name: "ثبت دستی مدیر", type: "manual", url: "", originalLanguage: "fa", credibilityTier: "UNRATED", publisherGroup: "manual", pollingIntervalMinutes: 0 }
    ];
    for (const source of sources) {
      const existing = this.getSource(source.id!);
      if (!existing) this.createSource(source);
      else this.updateSource(existing.id, { name: source.name, type: source.type, url: source.url ?? existing.url, telegramHandle: source.telegramHandle ?? null, originalLanguage: source.originalLanguage ?? existing.originalLanguage, credibilityTier: source.credibilityTier ?? existing.credibilityTier, publisherGroup: source.publisherGroup ?? existing.publisherGroup, discoveryOnly: source.discoveryOnly ?? false, pollingIntervalMinutes: source.pollingIntervalMinutes ?? existing.pollingIntervalMinutes });
    }
  }
}

export const database = new RadarDatabase();
