export const sourceTypes = ["rss", "telegram_bot", "telegram_mtproto", "guardian", "manual"] as const;
export type SourceType = (typeof sourceTypes)[number];
export const tiers = ["A", "B", "C", "UNRATED"] as const;
export type CredibilityTier = (typeof tiers)[number];
export const verificationStatuses = ["unverified", "single_source", "multi_source", "confirmed_by_admin"] as const;
export type VerificationStatus = (typeof verificationStatuses)[number];

export interface Source {
  id: string;
  name: string;
  type: SourceType;
  url: string;
  telegramHandle: string | null;
  originalLanguage: string;
  credibilityTier: CredibilityTier;
  publisherGroup: string | null;
  discoveryOnly: boolean;
  enabled: boolean;
  pollingIntervalMinutes: number;
  lastFetchedAt: number | null;
  lastSuccessAt: number | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface NewsItem {
  id: string;
  sourceId: string;
  externalId: string | null;
  originalUrl: string | null;
  originalLanguage: string;
  originalTitle: string;
  originalText: string;
  translatedTitle: string;
  translatedSummary: string;
  translationStatus: "not_needed" | "pending" | "translated" | "failed" | "manually_edited";
  publishedAt: number;
  collectedAt: number;
  category: string;
  urgency: "normal" | "important" | "breaking";
  verificationStatus: VerificationStatus;
  locationName: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  locationPrecision: "unknown" | "country" | "region" | "city";
  mediaUrl: string | null;
  contentHash: string;
  storyClusterId: string | null;
  status: "demo" | "pending" | "published" | "archived" | "rejected";
  createdAt: number;
  updatedAt: number;
  isBookmarked?: boolean;
  source?: Source;
}

export interface StoryCluster {
  id: string;
  canonicalTitleFa: string;
  summaryFa: string;
  category: string;
  verificationStatus: VerificationStatus;
  firstReportedAt: number;
  lastReportedAt: number;
  locationName: string | null;
  latitude: number | null;
  longitude: number | null;
  sourceCount: number;
  newsItemIds: string[];
  createdAt: number;
  updatedAt: number;
}

export interface IngestionLog {
  id: string;
  timestamp: number;
  sourceId: string | null;
  status: "success" | "failure";
  itemCount: number;
  errorMessage: string | null;
}

export interface AuditLog {
  id: string;
  timestamp: number;
  action: string;
  adminMetadata: string;
}

export interface IncomingItem {
  sourceId: string;
  externalId?: string | null;
  originalUrl?: string | null;
  originalLanguage?: string;
  originalTitle: string;
  originalText: string;
  publishedAt?: number;
  category?: string;
  urgency?: NewsItem["urgency"];
  locationName?: string | null;
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locationPrecision?: NewsItem["locationPrecision"];
  mediaUrl?: string | null;
}

export interface TranslationResult {
  detectedLanguage: string;
  titleFa: string;
  summaryFa: string;
  category: string;
  urgency: NewsItem["urgency"];
  mentionedLocations: string[];
  uncertaintyIndicators: string[];
}
