import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import ipaddr from "ipaddr.js";

const MAX_PAGE_BYTES = 1_000_000;
const MAX_REDIRECTS = 3;
const MAX_PAGES = 8;

export interface FetchPageResult {
  status: number;
  url: string;
  contentType: string;
  text: string;
  finalUrl?: string;
}

export interface DiscussionEntry {
  url: string;
  title: string;
  snippet: string;
}

export interface SearchResult {
  urls: string[];
  items?: DiscussionEntry[];
}

export interface ResearchedPage {
  url: string;
  title: string;
  snippet: string;
  text: string;
}

export interface CompanyResearchResult {
  company: string;
  homepageUrl: string;
  summary: string;
  pages: ResearchedPage[];
  sources: string[];
  interviewEvidence: string[];
  discussion: DiscussionEntry[];
  notes: string[];
}

export interface CompanyResearchOptions {
  allowLocalhost?: boolean;
  production?: boolean;
  fetchPage?: (url: string) => Promise<FetchPageResult>;
  searchPublicDiscussion?: (company: string) => Promise<SearchResult>;
  /** Delay between requests to the company site, in milliseconds. */
  requestDelayMs?: number;
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
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

/** Reads at most MAX_PAGE_BYTES; anything beyond is dropped (the head of a page holds the useful text). */
async function readBoundedBody(response: Response): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  while (totalBytes < MAX_PAGE_BYTES) {
    const { done, value } = await reader.read();
    if (done) break;
    const room = MAX_PAGE_BYTES - totalBytes;
    chunks.push(value.byteLength > room ? value.subarray(0, room) : value);
    totalBytes += Math.min(value.byteLength, room);
  }
  await reader.cancel().catch(() => undefined);
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

/** Ranks a link by how likely it is to describe what the company does or how it hires. */
function scoreLink(url: string, anchorText = ""): number {
  const haystack = `${new URL(url).pathname} ${anchorText}`.toLowerCase();
  let score = 0;
  if (/(careers?|jobs?|hiring|join|work-with-us|open-roles)/.test(haystack)) score += 7;
  if (/interview|how-we-hire|hiring-process|recruit/.test(haystack)) score += 8;
  if (/engineering|tech-blog|developers?/.test(haystack)) score += 6;
  if (/handbook|culture|values|principles/.test(haystack)) score += 6;
  if (/about|company|mission|who-we-are/.test(haystack)) score += 5;
  if (/blog|stories/.test(haystack)) score += 3;
  if (/team|people/.test(haystack)) score += 3;
  if (/(login|signin|signup|pricing|privacy|terms|cookie|legal|\.(png|jpe?g|svg|gif|pdf|zip|css|js)$)/.test(haystack)) score -= 10;
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
      const fetched = await fetch(target, { redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "PrepKitBot/1.0 (interview preparation research)" } });
      if ([301, 302, 303, 307, 308].includes(fetched.status)) {
        const location = fetched.headers.get("location");
        if (!location || redirects === MAX_REDIRECTS) throw new Error("Company page redirected too many times or without a location.");
        target = validateCompanyUrl(new URL(location, target).toString(), options);
        continue;
      }
      const contentType = fetched.headers.get("content-type") ?? "";
      if (fetched.status < 400 && !/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
        throw new Error("Company page returned an unsupported content type.");
      }
      response = {
        status: fetched.status,
        url: target.toString(),
        contentType,
        text: fetched.status < 400 ? await readBoundedBody(fetched) : "",
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
  if (response.status < 400 && !/^(text\/html|text\/plain|application\/xhtml\+xml)(;|$)/i.test(contentType)) {
    throw new Error("Company page returned an unsupported content type.");
  }
  return {
    status: response.status,
    url: response.finalUrl ?? response.url ?? url,
    contentType,
    text: response.text ?? "",
    finalUrl: response.finalUrl ?? response.url ?? url,
  };
}

export function discoverInternalLinks(baseUrl: string, html: string): string[] {
  const anchors = [...html.matchAll(/<a\b[^>]*?href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map((match) => ({ href: match[1], text: stripHtml(match[2]) }));
  const bare = [...html.matchAll(/href=["']([^"']+)["']/gi)].map((match) => ({ href: match[1], text: "" }));
  const best = new Map<string, number>();
  for (const { href, text } of [...anchors, ...bare]) {
    if (/^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    const absolute = resolveInternalLink(baseUrl, href);
    if (!absolute) continue;
    const clean = absolute.split("#")[0];
    best.set(clean, Math.max(best.get(clean) ?? -99, scoreLink(clean, text)));
  }
  return [...best.entries()].sort((left, right) => right[1] - left[1]).map(([url]) => url);
}

const INTERVIEW_WORDS = /(interview|hiring process|take-home|take home|onsite|on-site|phone screen|system design|coding round)/i;

/** Public discussion lives on Hacker News (Algolia API: free, keyless, built for programmatic use). */
async function searchHackerNews(company: string): Promise<SearchResult> {
  try {
    const query = encodeURIComponent(`${company} interview`);
    const response = await fetch(`https://hn.algolia.com/api/v1/search?query=${query}&tags=(story,comment)&hitsPerPage=20`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) return { urls: [] };
    const body = (await response.json()) as { hits?: Array<{ objectID: string; title?: string; story_title?: string; comment_text?: string; story_text?: string }> };
    const name = company.toLowerCase();
    const items = (body.hits ?? [])
      .map((hit) => {
        const text = stripHtml(`${hit.title ?? hit.story_title ?? ""} ${hit.comment_text ?? hit.story_text ?? ""}`);
        return { url: `https://news.ycombinator.com/item?id=${hit.objectID}`, title: hit.title ?? hit.story_title ?? "Hacker News discussion", snippet: text.slice(0, 500), text };
      })
      .filter((item) => item.text.toLowerCase().includes(name) && INTERVIEW_WORDS.test(item.text))
      .slice(0, 6)
      .map(({ url, title, snippet }) => ({ url, title, snippet }));
    return { urls: items.map((item) => item.url), items };
  } catch {
    return { urls: [] };
  }
}

export async function searchPublicDiscussion(companyName: string, options: CompanyResearchOptions = {}): Promise<SearchResult> {
  return (options.searchPublicDiscussion ?? searchHackerNews)(companyName);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function robotsDisallows(robotsText: string, path: string): boolean {
  let applies = false;
  const rules: string[] = [];
  for (const raw of robotsText.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (/^user-agent$/i.test(field)) applies = value === "*";
    else if (/^disallow$/i.test(field) && applies && value) rules.push(value);
  }
  return rules.some((rule) => path.startsWith(rule.replace(/\*$/, "")));
}

function nameFromHost(hostname: string): string {
  const label = hostname.replace(/^www\./i, "").split(".")[0].replace(/[-_]/g, " ");
  return label.replace(/(^|\s)([a-z])/g, (_match, space: string, letter: string) => `${space}${letter.toUpperCase()}`) || "Company";
}

/**
 * Crawls a company site and looks for public discussion. Nothing here is fatal: an unreachable
 * site or a missing hiring page is recorded in `notes` so the kit can report it honestly.
 */
export async function researchCompany(companyUrl: string, options: CompanyResearchOptions = {}): Promise<CompanyResearchResult> {
  const notes: string[] = [];
  let parsed: URL;
  try {
    parsed = validateCompanyUrl(companyUrl, options);
  } catch (error) {
    notes.push(`Company URL rejected: ${error instanceof Error ? error.message : "invalid URL"}`);
    return { company: "Company", homepageUrl: companyUrl, summary: "", pages: [], sources: [], interviewEvidence: [], discussion: [], notes };
  }

  const delayMs = options.requestDelayMs ?? (options.fetchPage ? 0 : 400);
  const rawFetch = options.fetchPage ?? ((url: string) => fetchPage(url, options));
  let lastRequest = 0;
  const politeFetch = async (url: string): Promise<FetchPageResult> => {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const wait = lastRequest + delayMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastRequest = Date.now();
      const result = await rawFetch(url);
      if (result.status !== 429 && result.status !== 503) return result;
      await sleep(1000 * 2 ** attempt);
    }
    return rawFetch(url);
  };

  let robotsText = "";
  try {
    const robots = await politeFetch(new URL("/robots.txt", parsed).toString());
    if (robots.status < 400 && /^text\/plain/i.test(robots.contentType)) robotsText = robots.text;
  } catch {
    // No readable robots.txt: nothing is disallowed.
  }

  let homepage: FetchPageResult = { status: 0, url: parsed.toString(), contentType: "", text: "" };
  try {
    homepage = await politeFetch(parsed.toString());
    if (homepage.status >= 400) notes.push(`Company homepage returned HTTP ${homepage.status}.`);
  } catch (error) {
    notes.push(`Company site could not be reached (${error instanceof Error ? error.message : "network error"}).`);
  }
  let reachable = homepage.status > 0 && homepage.status < 400;
  if (reachable && robotsDisallows(robotsText, parsed.pathname)) {
    notes.push("robots.txt disallows crawling the company homepage; no company pages were read.");
    reachable = false;
  }

  const pages: ResearchedPage[] = [];
  if (reachable) {
    const seen = new Set<string>([parsed.toString()]);
    const queue = discoverInternalLinks(parsed.toString(), homepage.text).slice(0, 12);
    let fetched = 0;
    while (queue.length > 0 && fetched < MAX_PAGES) {
      const entry = queue.shift()!;
      if (seen.has(entry)) continue;
      seen.add(entry);
      if (robotsDisallows(robotsText, new URL(entry).pathname)) {
        notes.push(`Skipped ${entry}: disallowed by robots.txt.`);
        continue;
      }
      try {
        const page = await politeFetch(entry);
        fetched += 1;
        if (page.status >= 400) {
          notes.push(`Skipped ${entry}: HTTP ${page.status}.`);
          continue;
        }
        const text = stripHtml(page.text);
        if (text.length < 40) continue;
        pages.push({ url: entry, title: entry.split("/").filter(Boolean).slice(-1)[0] || "Company page", snippet: text.slice(0, 220), text: text.slice(0, 6000) });
        // A careers or about page often links onward to the real process write-up: follow one level.
        if (fetched <= 3 && scoreLink(entry) >= 6) {
          for (const next of discoverInternalLinks(entry, page.text).slice(0, 3)) if (!seen.has(next) && scoreLink(next) >= 5) queue.unshift(next);
        }
      } catch (error) {
        notes.push(`Skipped ${entry}: ${error instanceof Error ? error.message : "fetch failed"}.`);
      }
    }
    if (!pages.some((page) => scoreLink(page.url) >= 5)) notes.push("No hiring, careers or about page could be found on the company site.");
  }

  const company = nameFromHost(parsed.hostname);
  const discussionResult: SearchResult = await searchPublicDiscussion(company, options).catch(() => ({ urls: [] }));
  const discussion = discussionResult.items ?? discussionResult.urls.map((url) => ({ url, title: "Public discussion", snippet: "" }));
  if (discussion.length === 0) notes.push("No public discussion of the company's interview process was found.");

  const homepageText = reachable ? stripHtml(homepage.text) : "";
  const homepageEntry: ResearchedPage[] = homepageText ? [{ url: parsed.toString(), title: "Homepage", snippet: homepageText.slice(0, 220), text: homepageText.slice(0, 6000) }] : [];
  const allPages = [...homepageEntry, ...pages];
  return {
    company,
    homepageUrl: parsed.toString(),
    summary: homepageText.slice(0, 450),
    pages: allPages,
    sources: allPages.map((page) => page.url),
    interviewEvidence: discussion.map((item) => item.url),
    discussion,
    notes,
  };
}
