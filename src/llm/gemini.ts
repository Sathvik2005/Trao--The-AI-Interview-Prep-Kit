const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface GeminiOptions {
  timeoutMs?: number;
  /** Attempts on the primary model before falling back to the next model. */
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Process-wide cap on in-flight model calls, so parallel generations cannot trip the provider's rate limits. */
class Semaphore {
  private active = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly max: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>((resolve) => this.waiters.push(resolve));
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiters.shift()?.();
    }
  }
}

const semaphore = new Semaphore(Math.max(1, Number(process.env.GEMINI_CONCURRENCY || 2)));

const COOLDOWN_MS = 45_000;
const coolingUntil = new Map<string, number>();

/** Models in preference order; any that failed recently go to the back so retries are not wasted on them. */
function modelChain(): string[] {
  const primary = process.env.GEMINI_MODEL || "gemini-flash-lite-latest";
  const fallbacks = (process.env.GEMINI_FALLBACK_MODELS ?? "gemini-3-flash-preview,gemini-3.1-flash-lite").split(",").map((model) => model.trim()).filter(Boolean);
  const chain = [primary, ...fallbacks.filter((model) => model !== primary)];
  const now = Date.now();
  return [...chain.filter((model) => (coolingUntil.get(model) ?? 0) <= now), ...chain.filter((model) => (coolingUntil.get(model) ?? 0) > now)];
}

type Outcome = { value: unknown } | { retry: string } | { fatal: string };

async function attemptOnce(model: string, prompt: string, apiKey: string, timeoutMs: number, thinking: boolean): Promise<Outcome & { delayMs?: number }> {
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", temperature: 0.4, ...(thinking ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}) },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (response.ok) {
      const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
      const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
      if (!text) return { retry: "empty response" };
      try {
        return { value: JSON.parse(text) };
      } catch {
        return { retry: "invalid JSON" };
      }
    }
    if (!RETRYABLE.has(response.status)) return { fatal: `HTTP ${response.status}` };
    const retryAfter = Number(response.headers.get("retry-after"));
    return { retry: `HTTP ${response.status}`, delayMs: Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(60_000, retryAfter * 1000) : undefined };
  } catch (error) {
    return { retry: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Calls Gemini in JSON mode. Transient failures retry with exponential backoff (honouring
 * Retry-After); if a model stays overloaded the next model in the chain is tried. Model-not-found
 * style errors (404) skip straight to the next model.
 */
export async function callGeminiJson(prompt: string, options: GeminiOptions = {}): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required.");
  const attempts = options.retries ?? 3;
  const failures: string[] = [];

  return semaphore.run(async () => {
    for (const model of modelChain()) {
      let thinking = true;
      for (let attempt = 0; attempt < attempts; attempt += 1) {
        const outcome = await attemptOnce(model, prompt, apiKey, options.timeoutMs ?? 60_000, thinking);
        if ("value" in outcome) return outcome.value;
        if ("fatal" in outcome && thinking && outcome.fatal === "HTTP 400") {
          thinking = false; // this model does not accept the reduced-thinking setting
          attempt -= 1;
          continue;
        }
        if ("fatal" in outcome) {
          failures.push(`${model}: ${outcome.fatal}`);
          break;
        }
        failures.push(`${model}: ${outcome.retry}`);
        if (attempt === attempts - 1) coolingUntil.set(model, Date.now() + COOLDOWN_MS);
        else await sleep(outcome.delayMs ?? Math.min(12_000, 1_500 * 2 ** attempt));
      }
    }
    throw new Error(`Gemini request failed on every model (${failures.slice(-3).join("; ")}).`);
  });
}
