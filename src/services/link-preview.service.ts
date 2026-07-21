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
const FETCH_TIMEOUT_MS = 8000;
const MAX_BODY_BYTES = 512 * 1024; // 512KB — meta tags sempre ficam no <head>

/** UA de navegador: muitos sites (YouTube incluso) omitem OG tags para bots. */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

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

function extractYoutubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parsed.pathname === "/watch") return parsed.searchParams.get("v");
      const parts = parsed.pathname.split("/").filter(Boolean);
      if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1]) {
        return parts[1];
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function fetchYoutubeOembed(url: string): Promise<LinkPreviewData | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
    const response = await fetch(oembedUrl, {
      signal: controller.signal,
      headers: { "User-Agent": BROWSER_UA, Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
      provider_name?: string;
    };
    if (!data.title && !data.thumbnail_url) return null;
    return {
      url,
      title: data.title || null,
      description: data.author_name || null,
      image: data.thumbnail_url || null,
      siteName: data.provider_name || "YouTube",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function youtubeThumbnailFallback(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
}

async function scrapeOpenGraph(url: string): Promise<LinkPreviewData | null> {
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
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
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
        // Head completo basta; evita baixar o resto da página
        if (html.includes("</head>") || html.includes("</HEAD>")) break;
      }
      await reader.cancel().catch(() => {});
    }

    const meta = extractMetaTags(html);
    const title = meta["og:title"] || meta["twitter:title"] || extractTitle(html);
    const description =
      meta["og:description"] || meta["twitter:description"] || meta["description"] || null;
    const rawImage = meta["og:image"] || meta["twitter:image"] || null;
    const siteName = meta["og:site_name"] || parsed.hostname;

    // Título genérico do YouTube sem OG = página de consentimento/bloqueio
    const cleanedTitle = title?.replace(/\s*-\s*YouTube\s*$/i, "").trim() || null;
    if (!cleanedTitle && !description && !rawImage) {
      return null;
    }
    if (cleanedTitle === "" && !description && !rawImage) {
      return null;
    }

    return {
      url,
      title: cleanedTitle || title || null,
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

async function fetchMetadata(url: string): Promise<LinkPreviewData | null> {
  const videoId = extractYoutubeVideoId(url);

  // YouTube: oEmbed é mais confiável que scrape (consent wall / HTML enorme)
  if (videoId) {
    const oembed = await fetchYoutubeOembed(url);
    if (oembed) {
      if (!oembed.image) {
        oembed.image = youtubeThumbnailFallback(videoId);
      }
      return oembed;
    }
  }

  const scraped = await scrapeOpenGraph(url);
  if (scraped) {
    if (videoId && !scraped.image) {
      scraped.image = youtubeThumbnailFallback(videoId);
    }
    if (videoId && (!scraped.siteName || scraped.siteName.includes("youtube"))) {
      scraped.siteName = "YouTube";
    }
    return scraped;
  }

  // Fallback mínimo pra YouTube mesmo quando o vídeo está indisponível no oEmbed:
  // ainda assim o usuário vê um card reconhecível em vez de só o texto cru.
  if (videoId) {
    return {
      url,
      title: "Vídeo do YouTube",
      description: null,
      image: youtubeThumbnailFallback(videoId),
      siteName: "YouTube",
    };
  }

  return null;
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
      if (cached.failed) {
        // Cache de falha antigo: YouTube agora tem oEmbed + fallback, então
        // re-tenta em vez de esconder o card por até 1h.
        if (!extractYoutubeVideoId(normalizedUrl)) return null;
      } else {
        return {
          url: cached.url,
          title: cached.title,
          description: cached.description,
          image: cached.image,
          siteName: cached.siteName,
        };
      }
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
