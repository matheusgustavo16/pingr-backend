import dns from "dns";
import { prisma } from "./prisma.service";

export interface LinkPreviewData {
  url: string;
  title: string | null;
  description: string | null;
  image: string | null;
  siteName: string | null;
}

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias
const FAILED_RETRY_MS = 60 * 60 * 1000; // 1 hora antes de tentar de novo um link que falhou
const FETCH_TIMEOUT_MS = 5000;
const MAX_BODY_BYTES = 512 * 1024; // 512KB — meta tags sempre ficam no <head>

// Bloqueia SSRF para redes internas/loopback/link-local
function isDisallowedIp(ip: string): boolean {
  if (ip === "::1" || ip === "127.0.0.1") return true;
  if (ip.startsWith("127.")) return true;
  if (ip.startsWith("10.")) return true;
  if (ip.startsWith("192.168.")) return true;
  if (ip.startsWith("169.254.")) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (ip.startsWith("fc") || ip.startsWith("fd")) return true; // fc00::/7
  if (ip.startsWith("fe80:")) return true; // link-local IPv6
  return false;
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost") {
    throw new Error("Host não permitido");
  }
  const { address } = await dns.promises.lookup(hostname);
  if (isDisallowedIp(address)) {
    throw new Error("Host não permitido");
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/g, "'");
}

function extractMetaTags(html: string): Record<string, string> {
  const meta: Record<string, string> = {};
  const metaTagRegex = /<meta\s+[^>]*>/gi;
  const tags = html.match(metaTagRegex) || [];

  for (const tag of tags) {
    const propertyMatch = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
    const contentMatch = tag.match(/content\s*=\s*["']([^"']*)["']/i);
    if (propertyMatch && contentMatch) {
      meta[propertyMatch[1].toLowerCase()] = decodeHtmlEntities(contentMatch[1]);
    }
  }

  return meta;
}

function extractTitle(html: string): string | null {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).trim() : null;
}

function resolveUrl(maybeRelative: string, baseUrl: string): string {
  try {
    return new URL(maybeRelative, baseUrl).toString();
  } catch {
    return maybeRelative;
  }
}

async function fetchMetadata(url: string): Promise<LinkPreviewData | null> {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return null;
  }
  await assertPublicHost(parsed.hostname);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; PingrLinkPreview/1.0; +https://pingr.app)",
        Accept: "text/html,application/xhtml+xml",
      },
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return null;
    }

    // Lê só os primeiros MAX_BODY_BYTES — meta tags de OG sempre estão no <head>
    const reader = response.body?.getReader();
    let html = "";
    let received = 0;
    if (reader) {
      const decoder = new TextDecoder();
      while (received < MAX_BODY_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        html += decoder.decode(value, { stream: true });
        received += value.byteLength;
      }
      await reader.cancel().catch(() => {});
    }

    const meta = extractMetaTags(html);
    const title = meta["og:title"] || meta["twitter:title"] || extractTitle(html);
    const description = meta["og:description"] || meta["twitter:description"] || meta["description"] || null;
    const rawImage = meta["og:image"] || meta["twitter:image"] || null;
    const siteName = meta["og:site_name"] || parsed.hostname;

    if (!title && !description && !rawImage) {
      return null;
    }

    return {
      url,
      title: title || null,
      description: description || null,
      image: rawImage ? resolveUrl(rawImage, url) : null,
      siteName: siteName || null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export class LinkPreviewService {
  static async getOrFetchPreview(url: string): Promise<LinkPreviewData | null> {
    let normalizedUrl: string;
    try {
      normalizedUrl = new URL(url).toString();
    } catch {
      return null;
    }

    const cached = await prisma.linkPreview.findUnique({
      where: { url: normalizedUrl },
    });

    const isFresh =
      cached &&
      Date.now() - cached.fetchedAt.getTime() <
        (cached.failed ? FAILED_RETRY_MS : CACHE_TTL_MS);

    if (cached && isFresh) {
      if (cached.failed) return null;
      return {
        url: cached.url,
        title: cached.title,
        description: cached.description,
        image: cached.image,
        siteName: cached.siteName,
      };
    }

    const fetched = await fetchMetadata(normalizedUrl);

    await prisma.linkPreview.upsert({
      where: { url: normalizedUrl },
      update: {
        title: fetched?.title ?? null,
        description: fetched?.description ?? null,
        image: fetched?.image ?? null,
        siteName: fetched?.siteName ?? null,
        failed: !fetched,
        fetchedAt: new Date(),
      },
      create: {
        url: normalizedUrl,
        title: fetched?.title ?? null,
        description: fetched?.description ?? null,
        image: fetched?.image ?? null,
        siteName: fetched?.siteName ?? null,
        failed: !fetched,
      },
    });

    return fetched;
  }
}
