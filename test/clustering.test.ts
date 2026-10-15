import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { database } from "../src/db.js";
import { clustering } from "../src/services/clustering.js";

describe("deduplication and verification", () => {
  it("deduplicates stable Telegram message IDs", async () => {
    const suffix = crypto.randomUUID();
    const source = database.createSource({ id: `test_c_${suffix}`, name: "Test unofficial", type: "telegram_mtproto", telegramHandle: `@test${suffix.replace(/-/g, "").slice(0, 16)}`, originalLanguage: "fa", credibilityTier: "C", publisherGroup: `test-c-${suffix}` });
    const input = { sourceId: source.id, externalId: "100", originalLanguage: "fa", originalTitle: `خبر آزمایشی ${suffix}`, originalText: `متن کاملاً آزمایشی ${suffix}`, urgency: "breaking" as const };
    const first = await clustering.ingest(input); const second = await clustering.ingest(input);
    expect(first.duplicate).toBe(false); expect(second.duplicate).toBe(true); expect(second.item.id).toBe(first.item.id);
    expect(first.item.verificationStatus).toBe("unverified"); expect(first.item.urgency).not.toBe("breaking");
  });

  it("counts publisher groups, not transports, for corroboration", async () => {
    const suffix = crypto.randomUUID(); const title = `رویداد آزمایشی گروه ناشر ${suffix}`;
    const a1 = database.createSource({ id: `test_a1_${suffix}`, name: "Outlet RSS", type: "rss", url: "https://example.com/feed", originalLanguage: "fa", credibilityTier: "A", publisherGroup: `publisher-${suffix}` });
    const a2 = database.createSource({ id: `test_a2_${suffix}`, name: "Outlet Telegram", type: "telegram_mtproto", telegramHandle: `@outlet${suffix.replace(/-/g, "").slice(0, 14)}`, originalLanguage: "fa", credibilityTier: "A", publisherGroup: `publisher-${suffix}` });
    const b = database.createSource({ id: `test_b_${suffix}`, name: "Independent", type: "rss", url: "https://example.org/feed", originalLanguage: "fa", credibilityTier: "B", publisherGroup: `independent-${suffix}` });
    const one = await clustering.ingest({ sourceId: a1.id, externalId: "1", originalLanguage: "fa", originalTitle: title, originalText: `نسخه اول ${suffix}` });
    const two = await clustering.ingest({ sourceId: a2.id, externalId: "2", originalLanguage: "fa", originalTitle: title, originalText: `نسخه دوم ${suffix}` });
    expect(two.cluster?.sourceCount).toBe(1); expect(two.cluster?.verificationStatus).toBe("single_source");
    const three = await clustering.ingest({ sourceId: b.id, externalId: "3", originalLanguage: "fa", originalTitle: title, originalText: `نسخه سوم ${suffix}` });
    expect(three.cluster?.sourceCount).toBe(2); expect(three.cluster?.verificationStatus).toBe("multi_source"); expect(one.cluster?.id).toBe(three.cluster?.id);
  });
});
