import { config } from "../config.js";
import { database } from "../db.js";
import { GuardianConnector, RssConnector } from "../connectors/rss.js";
import { TelegramMtprotoConnector } from "../connectors/telegram.js";
import { clustering } from "./clustering.js";
import type { IncomingItem, Source } from "../types.js";

export class IngestionService {
  private readonly rss = new RssConnector();
  private readonly guardian = new GuardianConnector(config.GUARDIAN_API_KEY);
  private readonly mtproto = new TelegramMtprotoConnector();

  async connectorFor(source: Source): Promise<{ fetch(source: Source): Promise<IncomingItem[]> }> {
    if (source.type === "rss") return this.rss;
    if (source.type === "guardian") return this.guardian;
    if (source.type === "telegram_mtproto") return this.mtproto;
    throw new Error(`Source type ${source.type} is event-driven or manual`);
  }

  async runSource(sourceId: string): Promise<{ sourceId: string; itemCount: number; duplicateCount: number; error?: string }> {
    const source = database.getSource(sourceId); if (!source) throw new Error("Source not found");
    const started = Date.now(); database.updateSource(sourceId, { lastFetchedAt: started, lastError: null });
    try {
      const connector = await this.connectorFor(source); const incoming = await connector.fetch(source);
      let itemCount = 0; let duplicateCount = 0;
      for (const item of incoming) { try { const result = await clustering.ingest(item); if (result.duplicate) duplicateCount++; else itemCount++; } catch (error) { /* keep processing the rest */ } }
      database.updateSource(sourceId, { lastSuccessAt: Date.now(), lastError: null });
      database.addIngestionLog({ timestamp: Date.now(), sourceId, status: "success", itemCount, errorMessage: duplicateCount ? `${duplicateCount} duplicate(s) skipped` : null });
      return { sourceId, itemCount, duplicateCount };
    } catch (error) {
      const message = error instanceof Error ? error.message.slice(0, 500) : "Unknown ingestion error";
      database.updateSource(sourceId, { lastError: message }); database.addIngestionLog({ timestamp: Date.now(), sourceId, status: "failure", itemCount: 0, errorMessage: message });
      return { sourceId, itemCount: 0, duplicateCount: 0, error: message };
    }
  }

  async runAll(sourceId?: string): Promise<{ results: Array<{ sourceId: string; itemCount: number; duplicateCount: number; error?: string }>; total: number }> {
    const sources = sourceId ? [database.getSource(sourceId)].filter((x): x is Source => Boolean(x)) : database.listSources(false).filter((s) => ["rss", "guardian", "telegram_mtproto"].includes(s.type));
    const results: Array<{ sourceId: string; itemCount: number; duplicateCount: number; error?: string }> = [];
    // Sequential execution avoids hammering sources and keeps SQLite writes deterministic.
    for (const source of sources) results.push(await this.runSource(source.id));
    return { results, total: results.reduce((sum, r) => sum + r.itemCount, 0) };
  }

  async runDue(): Promise<void> {
    const now = Date.now();
    const due = database.listSources(false).filter((s) => ["rss", "guardian", "telegram_mtproto"].includes(s.type) && s.pollingIntervalMinutes > 0 && now - (s.lastFetchedAt ?? 0) >= s.pollingIntervalMinutes * 60_000);
    for (const source of due) {
      if (source.type === "guardian" && !config.GUARDIAN_API_KEY) continue;
      if (source.type === "telegram_mtproto" && !(config.TELEGRAM_API_ID && config.TELEGRAM_API_HASH && config.TELEGRAM_SESSION)) continue;
      await this.runSource(source.id);
    }
  }
}

export const ingestion = new IngestionService();
