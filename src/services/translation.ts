import { config } from "../config.js";
import type { NewsItem, TranslationResult } from "../types.js";

export function detectLanguage(text: string): string {
  const sample = text.slice(0, 300);
  if (/([\u0600-\u06ff])/.test(sample)) {
    // Persian-specific code points (Arabic generally uses ي/ك instead of ی/ک).
    if (/[گچپژکی]/.test(sample) || /\b(این|است|برای|خبر|ایران)\b/.test(sample)) return "fa";
    return "ar";
  }
  if (/[àâçéèêëîïôùûüÿœ]/i.test(sample)) return "fr";
  if (/[А-яЁё]/.test(sample)) return "ru";
  return "en";
}

const allowedCategories = new Set(["military", "diplomacy", "cyber", "energy", "aviation", "humanitarian", "other"]);
const allowedUrgencies = new Set(["normal", "important", "breaking"]);

function validateResult(value: unknown): TranslationResult {
  if (!value || typeof value !== "object") throw new Error("Gemini returned non-object JSON");
  const v = value as Record<string, unknown>;
  const result: TranslationResult = {
    detectedLanguage: typeof v.detectedLanguage === "string" ? v.detectedLanguage.slice(0, 20) : "und",
    titleFa: typeof v.titleFa === "string" ? v.titleFa.trim().slice(0, 500) : "",
    summaryFa: typeof v.summaryFa === "string" ? v.summaryFa.trim().slice(0, 3000) : "",
    category: typeof v.category === "string" && allowedCategories.has(v.category) ? v.category : "other",
    urgency: typeof v.urgency === "string" && allowedUrgencies.has(v.urgency) ? v.urgency as TranslationResult["urgency"] : "normal",
    mentionedLocations: Array.isArray(v.mentionedLocations) ? v.mentionedLocations.filter((x): x is string => typeof x === "string").slice(0, 20) : [],
    uncertaintyIndicators: Array.isArray(v.uncertaintyIndicators) ? v.uncertaintyIndicators.filter((x): x is string => typeof x === "string").slice(0, 20) : []
  };
  if (!result.titleFa || !result.summaryFa) throw new Error("Gemini returned an empty translation");
  return result;
}

function parseJson(text: string): unknown {
  const stripped = text.trim().replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
  return JSON.parse(stripped);
}

export class TranslationService {
  async translate(title: string, body: string, hintedLanguage?: string): Promise<TranslationResult> {
    const detected = hintedLanguage && hintedLanguage !== "und" ? hintedLanguage : detectLanguage(`${title} ${body}`);
    if (detected === "fa") {
      return { detectedLanguage: "fa", titleFa: title.trim(), summaryFa: body.trim().slice(0, 3000), category: "other", urgency: "normal", mentionedLocations: [], uncertaintyIndicators: [] };
    }
    if (!config.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is not configured");
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(config.GEMINI_MODEL)}:generateContent?key=${encodeURIComponent(config.GEMINI_API_KEY)}`;
    const prompt = `You are a careful Persian news translator. Return ONLY valid JSON with exactly these keys: detectedLanguage, titleFa, summaryFa, category, urgency, mentionedLocations, uncertaintyIndicators. Translate faithfully into natural Persian; do not add facts or infer coordinates. Preserve uncertainty (reportedly/alleged/unconfirmed), names, numbers and quotes. Summary must be concise (2-4 sentences). Category must be one of military,diplomacy,cyber,energy,aviation,humanitarian,other. Urgency must be normal,important,breaking.\nOriginal language hint: ${detected}\nTITLE:\n${title.slice(0, 1200)}\nBODY:\n${body.slice(0, 9000)}`;
    const request = async () => {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, responseMimeType: "application/json" } },), signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error(`Gemini HTTP ${response.status}`);
      const payload = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = payload.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return validateResult(parseJson(text));
    };
    try { return await request(); } catch (firstError) {
      // A single retry is useful for transient malformed JSON, but never synthesize a fake translation.
      try { return await request(); } catch (secondError) { throw new Error(`Translation failed: ${secondError instanceof Error ? secondError.message : String(firstError)}`); }
    }
  }

  async translateItem(item: NewsItem): Promise<Partial<NewsItem>> {
    const language = item.originalLanguage || detectLanguage(`${item.originalTitle} ${item.originalText}`);
    if (language === "fa") return { translatedTitle: item.originalTitle, translatedSummary: item.originalText.slice(0, 3000), translationStatus: "not_needed", originalLanguage: "fa" };
    try {
      const result = await this.translate(item.originalTitle, item.originalText, language);
      return { translatedTitle: result.titleFa, translatedSummary: result.summaryFa, translationStatus: "translated", originalLanguage: result.detectedLanguage, category: result.category, urgency: result.urgency, locationName: result.mentionedLocations[0] ?? item.locationName };
    } catch {
      return { translatedTitle: item.originalTitle, translatedSummary: item.originalText.slice(0, 3000), translationStatus: "failed", originalLanguage: language };
    }
  }
}

export const translator = new TranslationService();
