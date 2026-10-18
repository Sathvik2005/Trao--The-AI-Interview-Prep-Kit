import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";
import { z } from "zod";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;

export interface FetchPageResult {
  status: number;
  url: string;
  contentType: string;
  text: string;
  finalUrl?: string;
}

export interface SearchResult {
  urls: string[];
}

export interface CompanyResearchResult {
  company: string;
  homepageUrl: string;
  summary: string;
  pages: Array<{ url: string; title: string; snippet: string }>;
  sources: string[];
  interviewEvidence: string[];
}

export interface CompanyResearchOptions {
  allowLocalhost?: boolean;
  production?: boolean;
  fetchPage?: (url: string) => Promise<FetchPageResult>;
  searchPublicDiscussion?: (company: string) => Promise<SearchResult>;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrivateAddress(address: string): boolean {
  try {
    const parsed = ipaddr.parse(address);
    const normalized = parsed.kind() === "ipv6" && (parsed as ipaddr.IPv6).isIPv4MappedAddress()
      ? (parsed as ipaddr.IPv6).toIPv4Address()
      : parsed;
    return normalized.range() !== "unicast";
  } catch {
    return true;
  }
}

function isLocalhostHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  return isIP(host.replace(/^\[|\]$/g, "")) !== 0 && isPrivateAddress(host.replace(/^\[|\]$/g, ""));
}

async function assertSafeRemoteAddress(url: URL, production: boolean): Promise<void> {
  if (!production) return;
  if (isLocalhostHost(url.hostname)) throw new Error("Private or loopback company URLs are rejected in production.");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address.address))) {
    throw new Error("Company URL resolves to a private or reserved network address.");
  }
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > MAX_PAGE_BYTES) throw new Error("Company page exceeds the 1 MB response limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > MAX_PAGE_BYTES) {
      await reader.cancel();
      throw new Error("Company page exceeds the 1 MB response limit.");
    }
    chunks.push(value);
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

export function validateCompanyUrl(rawUrl: string, options: CompanyResearchOptions = {}): URL {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new Error("Company URL is not a valid absolute URL.");
  }

  if (!/^(https?:)$/i.test(parsed.protocol)) {
    throw new Error("Company URL must use http or https.");
  }

  const allowLocalhost = options.allowLocalhost ?? process.env.NODE_ENV !== "production";
  const production = options.production ?? process.env.NODE_ENV === "production";
  if ((production || allowLocalhost === false) && isLocalhostHost(parsed.hostname)) {
    throw new Error("Private or loopback company URLs are rejected in production.");
  }
  if (!allowLocalhost && isLocalhostHost(parsed.hostname)) {
    throw new Error("Local-only company URLs are not allowed for this environment.");
  }

  return parsed;
}

function resolveInternalLink(baseUrl: string, href: string): string | null {
  try {
    const next = new URL(href, baseUrl);
    if (!/^(https?:)$/i.test(next.protocol)) return null;
    if (next.origin === new URL(baseUrl).origin) return next.toString();
    return null;
  } catch {
    return null;
  }
}

function scoreLink(url: string): number {
  const lowered = url.toLowerCase();
  let score = 0;
  if (lowered.includes("careers") || lowered.includes("jobs") || lowered.includes("hiring")) score += 7;
  if (lowered.includes("engineering")) score += 6;
  if (lowered.includes("handbook")) score += 6;
  if (lowered.includes("about")) score += 5;
  if (lowered.includes("team")) score += 3;
  if (lowered.includes("blog")) score += 4;
  if (lowered.includes("interview")) score += 5;
  return score;
}

export async function fetchPage(url: string, options: CompanyResearchOptions = {}): Promise<FetchPageResult> {
  const production = options.production ?? process.env.NODE_ENV === "production";
  let target = validateCompanyUrl(url, options);
  let response: FetchPageResult | undefined;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    await assertSafeRemoteAddress(target, production);
    if (options.fetchPage) {
      response = await options.fetchPage(target.toString());
    } else {
      const fetched = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15_000) });
      if ([301, 302, 303, 307, 308].includes(fetched.status)) {
        const location = fetched.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Company page redirected too many times or without a location.");
        target = validateCompanyUrl(new URL(location, target).toString(), options);
        continue;
      }
      const contentType = fetched.headers.get("content-type") ?? "";
      if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
        throw new Error("Company page returned an unsupported content type.");
      }
      response = {
        status: fetched.status,
        url: target.toString(),
        contentType,
        text: await readBoundedBody(fetched),
        finalUrl: target.toString(),
      };
    }
    break;
  }
  if (!response) throw new Error("Company page could not be fetched.");
  if (new URL(response.finalUrl ?? response.url).origin !== target.origin) {
    await assertSafeRemoteAddress(new URL(response.finalUrl ?? response.url), production);
  }
  if (Buffer.byteLength(response.text ?? "", "utf8") > MAX_PAGE_BYTES) throw new Error("Company page exceeds the 1 MB response limit.");
  const contentType = response.contentType ?? "text/plain";
  if (!/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
    throw new Error("Company page returned an unsupported content type.");
  }
  const text = response.text ?? "";
  return {
    status: response.status,
    url: response.finalUrl ?? response.url ?? url,
    contentType,
    text,
    finalUrl: response.finalUrl ?? response.url ?? url,
  };
}

export function discoverInternalLinks(baseUrl: string, html: string): string[] {
  const matches = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => match[1]);
  const unique = new Set<string>();
  for (const candidate of matches) {
    const absolute = resolveInternalLink(baseUrl, candidate);
    if (!absolute) continue;
    if (candidate.startsWith("#") || candidate.startsWith("mailto:") || candidate.startsWith("tel:")) continue;
    unique.add(absolute);
  }

  return [...unique].sort((left, right) => scoreLink(right) - scoreLink(left));
}

export async function searchPublicDiscussion(companyName: string, options: CompanyResearchOptions = {}): Promise<SearchResult> {
  const searcher = options.searchPublicDiscussion ?? (async (company) => {
    try {
      const encoded = encodeURIComponent(`${company} interview process engineering`);
      const searchUrl = `https://duckduckgo.com/html/?q=${encoded}`;
      const response = await fetch(searchUrl, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return { urls: [] };
      const html = await response.text();
      const matches = [...html.matchAll(/https?:\/\/[^"'\s<>]+/gi)].map((match) => match[0]);
      return { urls: [...new Set(matches)].slice(0, 10) };
    } catch {
      return { urls: [] };
    }
  });

  return searcher(companyName);
}

export async function researchCompany(companyUrl: string, options: CompanyResearchOptions = {}): Promise<CompanyResearchResult> {
  const parsed = validateCompanyUrl(companyUrl, options);
  const homepageFetch = options.fetchPage ?? ((url: string) => fetchPage(url, options));
  const homepage = await homepageFetch(parsed.toString());
  if (homepage.status >= 400) {
    throw new Error(`Company homepage could not be fetched (HTTP ${homepage.status}).`);
  }

  const homepageText = stripHtml(homepage.text);
  const internalLinks = discoverInternalLinks(parsed.toString(), homepage.text).slice(0, 10);
  const pages: Array<{ url: string; title: string; snippet: string }> = [];
  const seen = new Set<string>([parsed.toString()]);

  for (const entry of internalLinks) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    try {
      const page = await homepageFetch(entry);
      if (page.status >= 400) continue;
      const safeText = stripHtml(page.text);
      if (safeText.length < 40) continue;
      pages.push({
        url: entry,
        title: entry.split("/").filter(Boolean).slice(-1)[0] || "Company page",
        snippet: safeText.slice(0, 220),
      });
    } catch {
      continue;
    }
  }

  const interviewEvidence = await searchPublicDiscussion(parsed.hostname.replace(/\.[^.]+$/, ""), options);
  const sources = Array.from(new Set([parsed.toString(), ...pages.map((page) => page.url)]));
  const summary = homepageText.length > 0 ? homepageText.slice(0, 450) : "No readable homepage content was returned.";

  return {
    company: parsed.hostname.replace(/\.[^.]+$/, "") || "Company",
    homepageUrl: parsed.toString(),
    summary,
    pages,
    sources,
    interviewEvidence: interviewEvidence.urls,
  };
}
