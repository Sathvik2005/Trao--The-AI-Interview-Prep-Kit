import { describe, expect, it, vi } from "vitest";
import { evaluateCases, parseArgs } from "../src/cli/evaluate.js";
import type { InterviewKit } from "../src/domain/kit-schema.js";

const validKit = {
  source: { company: "Example", company_url: "https://example.com/", role: "Engineer", location: "Remote", jd_chars: 20, researched_at: "2026-10-18T12:00:00.000Z", pages_used: ["https://example.com/"] },
  company_brief: { summary: "Example.", what_they_do: "Build software.", sources: ["https://example.com/"] },
  role: { title: "Engineer", seniority: "", responsibilities: ["Build software"], requirements: [] },
  questions: [], flashcards: [],
  schedule: { days_available: 1, days: [{ day: 1, focus: "Review company and role context", question_ids: [], minutes: 0 }] },
  coverage: { uncovered_requirement_ids: [], passes: 1 },
} satisfies InterviewKit;

describe("batch evaluator contract", () => {
  it("parses only the documented input and output arguments", () => {
    expect(parseArgs(["--input", "cases.json", "--output", "kits.json"])).toEqual({ input: "cases.json", output: "kits.json" });
    expect(() => parseArgs(["--input", "cases.json"])).toThrow(/Usage/);
    expect(() => parseArgs(["--unknown", "value"])).toThrow(/Unexpected/);
  });

  it("isolates invalid and generation-failing cases while preserving case order", async () => {
    const generate = vi.fn(async (input: { jd: string; company_url: string; days: number }) => {
      if (input.jd === "failure case description") throw new Error("provider unavailable");
      return validKit;
    });
    const result = await evaluateCases([
      { id: "first", jd: "valid case description here", company_url: "https://example.com", days: 1 },
      { id: "bad-days", jd: "days value outside of contract", company_url: "https://example.com", days: 61 },
      { id: "provider-error", jd: "failure case description", company_url: "https://example.com", days: 2 },
      { id: "last", jd: "another valid description", company_url: "https://example.com", days: 3 },
    ], generate);

    expect(result.version).toBe("1.0");
    expect(Number.isNaN(Date.parse(result.generated_at))).toBe(false);
    expect(result.kits.map((entry) => entry.id)).toEqual(["first", "bad-days", "provider-error", "last"]);
    expect(result.kits.map((entry) => entry.status)).toEqual(["ok", "failed", "failed", "ok"]);
    expect(result.kits[1].error?.code).toBe("INVALID_CASE");
    expect(result.kits[2].error?.message).toContain("provider unavailable");
    expect(result.kits[0].kit).toEqual(validKit);
    expect(result.kits[1].kit).toBeNull();
    expect(generate).toHaveBeenCalledTimes(3);
    expect(result.failed_cases).toBe(true);
  });

  it("rejects a non-array case document before writing results", async () => {
    await expect(evaluateCases({ id: "not-an-array" })).rejects.toThrow(/array/);
  });
});
