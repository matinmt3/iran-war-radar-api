import crypto from "node:crypto";
import dns from "node:dns/promises";
import net from "node:net";
import { URL } from "node:url";

export function randomId(prefix = ""): string {
  return `${prefix}${crypto.randomUUID()}`;
}

export function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function normalizeText(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[\u200c\u200d\u200e\u200f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/\s+/g, " ");
}

export function canonicalUrl(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const url = new URL(input.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((k) => url.searchParams.delete(k));
    url.hostname = url.hostname.toLowerCase();
    if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
    return url.toString();
  } catch { return null; }
}

function privateIp(host: string): boolean {
  const kind = net.isIP(host);
  if (kind === 4) {
    const p = host.split(".").map(Number);
    return p[0] === 10 || p[0] === 127 || (p[0] === 169 && p[1] === 254) || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || p[0] === 0;
  }
  if (kind === 6) return host === "::1" || host === "::" || host.toLowerCase().startsWith("fc") || host.toLowerCase().startsWith("fd") || host.toLowerCase().startsWith("fe80:");
  return false;
}

/** Reject local/private destinations before a server-side fetch (SSRF defense). */
export async function assertSafeRemoteUrl(input: string): Promise<URL> {
  const canonical = canonicalUrl(input);
  if (!canonical) throw new Error("Only valid http(s) URLs are allowed");
  const url = new URL(canonical);
  if (privateIp(url.hostname) || ["localhost", "localhost.localdomain"].includes(url.hostname.toLowerCase())) throw new Error("Private or local hosts are not allowed");
  // Resolve DNS and reject private addresses. DNS failures are allowed to surface as fetch errors.
  try {
    const records = await dns.lookup(url.hostname, { all: true, verbatim: true });
    if (records.some((record) => privateIp(record.address))) throw new Error("Private or local hosts are not allowed");
  } catch (error) {
    if (error instanceof Error && error.message.includes("Private or local")) throw error;
  }
  return url;
}

/** Fetch an external URL while re-validating every redirect target. */
export async function fetchSafeRemote(input: string | URL, init: RequestInit = {}, maxRedirects = 3): Promise<Response> {
  let current = await assertSafeRemoteUrl(String(input));
  for (let attempt = 0; attempt <= maxRedirects; attempt++) {
    const response = await fetch(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    response.body?.cancel().catch(() => undefined);
    if (!location) throw new Error("Remote URL redirect did not include a location");
    if (attempt === maxRedirects) throw new Error("Too many remote URL redirects");
    current = await assertSafeRemoteUrl(new URL(location, current).toString());
  }
  throw new Error("Too many remote URL redirects");
}

/** Strip scripts, styles, tags and dangerous entities from untrusted feed text. */
export function sanitizeText(input: string | null | undefined, max = 12000): string {
  return String(input ?? "").replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<!--[\s\S]*?-->/g, " ").replace(/<[^>]*>/g, " ").replace(/&(?:nbsp|#160);/gi, " ").replace(/&(?:amp);/gi, "&").replace(/&(?:lt);/gi, "<").replace(/&(?:gt);/gi, ">").replace(/\s+/g, " ").trim().slice(0, max);
}

export function timingSafeEqualText(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
