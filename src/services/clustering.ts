import { database } from "../db.js";
import { canonicalUrl, normalizeText, randomId, sha256 } from "../security.js";
import { translator } from "./translation.js";
import type { IncomingItem, NewsItem, Source, StoryCluster } from "../types.js";

function tokens(value: string): Set<string> {
  return new Set(normalizeText(value).split(" ").filter((x) => x.length > 2));
}

function similarity(a: string, b: string): number {
  const aa = tokens(a); const bb = tokens(b); if (!aa.size || !bb.size) return 0;
  let overlap = 0; for (const t of aa) if (bb.has(t)) overlap++;
  return overlap / Math.max(aa.size, bb.size);
}

function verificationFor(source: Source, sources: Source[]): NewsItem["verificationStatus"] {
  const establishedGroups = new Set(sources.filter((s) => (s.credibilityTier === "A" || s.credibilityTier === "B") && !s.discoveryOnly).map((s) => s.publisherGroup || s.id));
  if (establishedGroups.size >= 2) return "multi_source";
  if (establishedGroups.size === 1 || source.credibilityTier === "A" || source.credibilityTier === "B") return "single_source";
  return "unverified";
}

export class ClusteringService {
  async ingest(input: IncomingItem): Promise<{ item: NewsItem; duplicate: boolean; cluster: StoryCluster | null }> {
    const source = database.getSource(input.sourceId);
    if (!source) throw new Error("Source not found");
    const title = input.originalTitle.trim().slice(0, 1000); const text = input.originalText.trim().slice(0, 20000);
    if (!title || !text) throw new Error("Title and text are required");
    const url = canonicalUrl(input.originalUrl);
    const hash = sha256(normalizeText(`${title}\n${text}`).slice(0, 20000));
    const byExternal = input.externalId ? database.getNewsByExternal(source.id, input.externalId) : null;
    const byUrl = url ? database.listNews({ limit: 200, status: "published" }).items.find((n) => n.originalUrl === url) : null;
    const byHash = database.getNewsByHash(hash);
    const duplicate = byExternal ?? byUrl ?? byHash;
    if (duplicate) return { item: duplicate, duplicate: true, cluster: duplicate.storyClusterId ? database.getCluster(duplicate.storyClusterId) : null };

    const now = Date.now();
    const initial: NewsItem = {
      id: randomId("news_"), sourceId: source.id, externalId: input.externalId ?? null, originalUrl: url, originalLanguage: input.originalLanguage ?? "und",
      originalTitle: title, originalText: text, translatedTitle: title, translatedSummary: text.slice(0, 3000), translationStatus: "pending",
      publishedAt: input.publishedAt && Number.isFinite(input.publishedAt) ? input.publishedAt : now, collectedAt: now, category: input.category ?? "other",
      urgency: source.credibilityTier === "C" && input.urgency === "breaking" ? "important" : input.urgency ?? "normal", verificationStatus: source.credibilityTier === "A" || source.credibilityTier === "B" ? "single_source" : "unverified",
      locationName: input.locationName ?? null, country: input.country ?? null, latitude: input.latitude ?? null, longitude: input.longitude ?? null,
      locationPrecision: input.locationPrecision ?? "unknown", mediaUrl: input.mediaUrl ?? null, contentHash: hash, storyClusterId: null, status: "published", createdAt: now, updatedAt: now
    };
    const translated = await translator.translateItem(initial);
    const item = database.insertNews({ ...initial, ...translated });
    const cluster = this.assignCluster(item);
    return { item: cluster ? database.getNews(item.id)! : item, duplicate: false, cluster };
  }

  private assignCluster(item: NewsItem): StoryCluster | null {
    const candidates = database.listClusters(200);
    const allNews = database.listNews({ limit: 200, status: "published" }).items;
    let best: StoryCluster | null = null; let bestScore = 0;
    for (const cluster of candidates) {
      const clusterNews = allNews.filter((n) => cluster.newsItemIds.includes(n.id));
      const representative = clusterNews[0];
      if (!representative) continue;
      const withinWindow = Math.abs(item.publishedAt - cluster.lastReportedAt) <= 48 * 3600 * 1000;
      const sameLocation = Boolean(item.locationName && cluster.locationName && normalizeText(item.locationName) === normalizeText(cluster.locationName));
      const score = similarity(item.translatedTitle || item.originalTitle, cluster.canonicalTitleFa) + (sameLocation ? 0.25 : 0) + (item.category === cluster.category ? 0.1 : 0);
      if (withinWindow && score >= 0.45 && score > bestScore) { best = cluster; bestScore = score; }
    }
    if (!best) {
      const now = Date.now();
      const created: StoryCluster = { id: randomId("cluster_"), canonicalTitleFa: item.translatedTitle || item.originalTitle, summaryFa: item.translatedSummary, category: item.category, verificationStatus: item.verificationStatus, firstReportedAt: item.publishedAt, lastReportedAt: item.publishedAt, locationName: item.locationName, latitude: item.latitude, longitude: item.longitude, sourceCount: 1, newsItemIds: [item.id], createdAt: now, updatedAt: now };
      database.upsertCluster(created); database.addItemToCluster(item.id, created.id); return created;
    }
    const ids = Array.from(new Set([...best.newsItemIds, item.id]));
    const linked = allNews.filter((n) => ids.includes(n.id));
    const sourceIds = new Set(linked.map((n) => n.sourceId).concat(item.sourceId));
    const independentSources = Array.from(sourceIds).map((id) => database.getSource(id)).filter((s): s is Source => Boolean(s));
    const status = verificationFor(database.getSource(item.sourceId)!, independentSources);
    const independentGroups = new Set(independentSources.map((s) => s.publisherGroup || s.id));
    const updated: StoryCluster = { ...best, canonicalTitleFa: best.canonicalTitleFa || item.translatedTitle, summaryFa: best.summaryFa || item.translatedSummary, lastReportedAt: Math.max(best.lastReportedAt, item.publishedAt), sourceCount: independentGroups.size, newsItemIds: ids, verificationStatus: status, updatedAt: Date.now() };
    database.upsertCluster(updated); database.addItemToCluster(item.id, updated.id);
    for (const linkedItem of linked) if (linkedItem.verificationStatus !== "confirmed_by_admin") database.updateNews(linkedItem.id, { verificationStatus: status, storyClusterId: updated.id });
    database.updateNews(item.id, { verificationStatus: status, storyClusterId: updated.id });
    return database.getCluster(updated.id);
  }
}

export const clustering = new ClusteringService();
