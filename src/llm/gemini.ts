const RETRYABLE = new Set([408, 429, 500, 502, 503, 504]);

export interface GeminiOptions {
  timeoutMs?: number;
  retries?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Calls Gemini in JSON mode. Rate limits and transient failures are retried with exponential
 * backoff (honouring Retry-After) so a provider saying "slow down" does not fail a whole kit.
 */
export async function callGeminiJson(prompt: string, options: GeminiOptions = {}): Promise<unknown> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is required.");
  const model = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const retries = options.retries ?? 4;
  let lastError = "unknown error";

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let delay = Math.min(30_000, 2_000 * 2 ** attempt);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json", temperature: 0.4, thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: AbortSignal.timeout(options.timeoutMs ?? 90_000),
      });
      if (response.ok) {
        const body = (await response.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
        const text = body.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("");
        if (!text) {
          lastError = "empty response";
        } else {
          try {
            return JSON.parse(text);
          } catch {
            lastError = "invalid JSON";
          }
        }
      } else {
        lastError = `HTTP ${response.status}`;
        if (!RETRYABLE.has(response.status)) throw new Error(`Gemini request failed with ${lastError}.`);
        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) delay = Math.min(60_000, retryAfter * 1000);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Gemini request failed")) throw error;
      lastError = error instanceof Error ? error.message : String(error);
    }
    if (attempt < retries) await sleep(delay);
  }
  throw new Error(`Gemini request failed after ${retries + 1} attempts (${lastError}).`);
}
