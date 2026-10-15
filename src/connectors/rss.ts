import Parser from "rss-parser";
import { config } from "../config.js";
import { assertSafeRemoteUrl, canonicalUrl, fetchSafeRemote, sanitizeText } from "../security.js";
import type { IncomingItem, Source } from "../types.js";

export interface SourceConnector { fetch(source: Source): Promise<IncomingItem[]>; }

const parser = new Parser({ timeout: 15000, customFields: { item: [["media:content", "mediaContent", { keepArray: false }], ["content:encoded", "contentEncoded"]] } });

function feedText(item: Record<string, unknown>, title: string): string {
  // Keep the default deployment limited to an excerpt. Full article storage is
  // an explicit, legally reviewed opt-in because feeds may carry copyrighted text.
  if (config.storeFullText) return String(item.contentEncoded ?? item.content ?? item.contentSnippet ?? title);
  return String(item.contentSnippet ?? item.content ?? title);
}

export class RssConnector implements SourceConnector {
  async fetch(source: Source): Promise<IncomingItem[]> {
    if (!source.url) throw new Error("RSS source URL is empty");
    const url = await assertSafeRemoteUrl(source.url);
    const response = await fetchSafeRemote(url, { headers: { "user-agent": "IranWarRadar/1.0 (+news aggregator; contact admin)" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`RSS HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0); if (length > 5_000_000) throw new Error("RSS response too large");
    const body = await response.text(); if (body.length > 5_000_000) throw new Error("RSS response too large");
    const feed = await parser.parseString(body);
    return (feed.items ?? []).slice(0, 100).map((item, index) => {
      const title = sanitizeText(item.title ?? "").slice(0, 1000); const text = sanitizeText(feedText(item as unknown as Record<string, unknown>, title), config.storeFullText ? 20000 : 4000);
      const link = canonicalUrl(item.link ?? item.guid ?? null);
      const date = item.isoDate ? Date.parse(item.isoDate) : item.pubDate ? Date.parse(item.pubDate) : Date.now();
      const media = (item as unknown as Record<string, unknown>).mediaContent as { $?: { url?: string } } | undefined;
      return { sourceId: source.id, externalId: item.guid ?? item.link ?? `rss-${index}-${date}`, originalUrl: link, originalLanguage: source.originalLanguage || "und", originalTitle: title, originalText: text || title, publishedAt: Number.isFinite(date) ? date : Date.now(), mediaUrl: media?.$?.url ?? null };
    }).filter((item) => item.originalTitle && item.originalText);
  }
}

export class GuardianConnector implements SourceConnector {
  constructor(private readonly apiKey: string) {}
  async fetch(source: Source): Promise<IncomingItem[]> {
    if (!this.apiKey) throw new Error("GUARDIAN_API_KEY is not configured");
    const endpoint = new URL(source.url || "https://content.guardianapis.com/search");
    endpoint.searchParams.set("api-key", this.apiKey); endpoint.searchParams.set("q", "Iran OR Israel OR Gulf OR nuclear"); endpoint.searchParams.set("order-by", "newest"); endpoint.searchParams.set("page-size", "50"); endpoint.searchParams.set("show-fields", "headline,trailText,bodyText");
    const response = await fetchSafeRemote(await assertSafeRemoteUrl(endpoint.toString()), { headers: { "user-agent": "IranWarRadar/1.0" }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Guardian HTTP ${response.status}`);
    const payload = await response.json() as { response?: { results?: Array<{ id?: string; webUrl?: string; webTitle?: string; webPublicationDate?: string; fields?: { trailText?: string; bodyText?: string } }> } };
    return (payload.response?.results ?? []).map((item) => ({ sourceId: source.id, externalId: item.id ?? item.webUrl ?? null, originalUrl: canonicalUrl(item.webUrl), originalLanguage: "en", originalTitle: sanitizeText(item.webTitle ?? ""), originalText: sanitizeText(config.storeFullText ? (item.fields?.bodyText ?? item.fields?.trailText ?? item.webTitle ?? "") : (item.fields?.trailText ?? item.webTitle ?? ""), config.storeFullText ? 20000 : 4000), publishedAt: item.webPublicationDate ? Date.parse(item.webPublicationDate) : Date.now() })).filter((x) => x.originalTitle && x.originalText);
  }
}
