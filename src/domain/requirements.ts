import { createHash } from "node:crypto";
import { z } from "zod";
import type { InterviewKit } from "./kit-schema.js";

const extractionCandidateSchema = z
  .object({
    text: z.string().trim().min(1),
    source_quote: z.string().trim().min(1),
    kind: z.enum(["technical", "behavioural", "domain"]),
    priority: z.enum(["must", "nice"]),
  })
  .strict();

export type RequirementCandidate = z.infer<typeof extractionCandidateSchema>;
export type Requirement = InterviewKit["role"]["requirements"][number];

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

export function buildRequirements(input: unknown, jobDescription: string): Requirement[] {
  const candidates = z.array(extractionCandidateSchema).parse(input);
  const normalizedDescription = normalizeWhitespace(jobDescription).toLocaleLowerCase();
  const byText = new Map<string, RequirementCandidate>();

  for (const candidate of candidates) {
    const normalizedQuote = normalizeWhitespace(candidate.source_quote).toLocaleLowerCase();
    if (!normalizedDescription.includes(normalizedQuote)) {
      throw new Error("Requirement evidence must be quoted from the supplied job description.");
    }
    const key = normalizeWhitespace(candidate.text).toLocaleLowerCase();
    const existing = byText.get(key);
    if (existing && existing.kind !== candidate.kind) {
      throw new Error("Duplicate requirement text has conflicting kinds.");
    }
    if (!existing || candidate.priority === "must") {
      byText.set(key, candidate);
    }
  }

  return [...byText.values()].map((candidate) => {
    const canonicalText = normalizeWhitespace(candidate.text);
    const digest = createHash("sha256").update(canonicalText.toLocaleLowerCase()).digest("hex").slice(0, 12);
    return {
      id: `r-${digest}`,
      text: canonicalText,
      kind: candidate.kind,
      priority: candidate.priority,
    };
  });
}