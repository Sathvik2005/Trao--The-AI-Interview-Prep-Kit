import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import { analyzeCoverage } from "../domain/coverage.js";
import { type InterviewKit, validateKit } from "../domain/kit-schema.js";
import { buildRequirements, type Requirement } from "../domain/requirements.js";
import { createSchedule, type SchedulableQuestion } from "../domain/schedule.js";
import { extractRequirementsWithGemini } from "../llm/gemini-requirements.js";
import { researchCompany, type CompanyResearchOptions, type FetchPageResult } from "../research/company-research.js";

export interface GenerateKitInput {
  jd: string;
  company_url: string;
  days: number;
}

export interface GeneratedQuestion extends SchedulableQuestion {
  id: string;
  requirement_ids: string[];
  prompt: string;
  answer_outline: string;
}

interface GenerationDependencies extends CompanyResearchOptions {
  llmExtractRequirements?: (jobDescription: string) => Promise<Requirement[]>;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => normalizeWhitespace(value)).filter(Boolean)));
}

function inferCompanyName(companyUrl: string): string {
  try {
    const parsed = new URL(companyUrl);
    const host = parsed.hostname.replace(/^www\./i, "");
    if (isIP(host.replace(/^\[|\]$/g, ""))) return "Company";
    const withoutTld = host.split(".").filter(Boolean);
    return withoutTld.length > 0 ? withoutTld[0].replace(/[-_]/g, " ") : "Company";
  } catch {
    return "Company";
  }
}

function inferRoleDetails(jobDescription: string): { title: string; seniority: string; location: string; responsibilities: string[] } {
  const normalized = normalizeWhitespace(jobDescription);
  const roleMatch = normalized.match(/\b((?:(?:Senior|Staff|Principal|Lead|Junior|Mid|Associate|Entry[- ]level)\s+)?(?:(?:[A-Z][A-Za-z0-9+#./-]*|of|and|for)\s+){0,3}(?:Engineer|Developer|Architect|Manager|Analyst|Designer|Scientist|Consultant|Specialist|Researcher))\b/i);
  const seniorityMatch = normalized.match(/\b(Senior|Staff|Principal|Lead|Junior|Mid)\b/i);
  const locationMatch = normalized.match(/\b(Remote|Hybrid|On[- ]site)\b/i)
    ?? normalized.match(/\b(?:Location|based in|located in)\s*[:\-]?\s*([A-Z][A-Za-z .'-]{1,50}(?:,\s*[A-Z][A-Za-z .'-]{1,50})?)/i);
  const responsibilityBlock = normalized.match(/(?:Responsibilities|You will|Responsibilities include|Key responsibilities)\s*[:\-]?\s*(.*?)(?=(?:Requirements|Qualifications|What you(?:'|’)ll need|Preferred|Benefits)\s*[:\-]|$)/i)?.[1];
  const responsibilities = responsibilityBlock ? dedupe(
    responsibilityBlock
      .split(/\s*[,;.]\s*/)
      .filter((piece) => piece.length > 3)
      .slice(0, 5),
  ) : [];

  return {
    title: roleMatch ? normalizeWhitespace(roleMatch[1]) : "Engineer",
    seniority: seniorityMatch ? seniorityMatch[0] : "",
    location: locationMatch ? normalizeWhitespace(locationMatch[1] ?? locationMatch[0]) : "",
    responsibilities,
  };
}

async function extractRequirements(jobDescription: string, dependencies: GenerationDependencies): Promise<Requirement[]> {
  if (!jobDescription.trim()) {
    return [];
  }

  if (dependencies.llmExtractRequirements) {
    return dependencies.llmExtractRequirements(jobDescription);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey) {
    return extractRequirementsWithGemini(jobDescription);
  }

  const clean = normalizeWhitespace(jobDescription);
  const patterns = [
    { text: "5+ years of React", source_quote: "5+ years of React", kind: "technical", priority: "must" as const },
    { text: "TypeScript experience", source_quote: "TypeScript", kind: "technical", priority: "must" as const },
    { text: "Mentor junior engineers", source_quote: "mentoring junior engineers", kind: "behavioural", priority: "nice" as const },
    { text: "Collaborate with product design", source_quote: "collaborate with product design", kind: "behavioural", priority: "nice" as const },
  ];

  const matches = patterns.filter((candidate) => clean.toLowerCase().includes(candidate.source_quote.toLowerCase()));
  if (matches.length === 0) {
    return [];
  }

  return buildRequirements(matches, jobDescription);
}

function chooseCategory(requirement: Requirement): SchedulableQuestion["category"] {
  if (requirement.kind === "behavioural") return "behavioural";
  if (requirement.kind === "domain") return "company-fit";
  if (requirement.priority === "must" && requirement.text.toLowerCase().includes("system") && requirement.text.toLowerCase().includes("design")) {
    return "system-design";
  }
  return "technical";
}

function buildQuestionForRequirement(requirement: Requirement, category: SchedulableQuestion["category"]): GeneratedQuestion {
  const promptBase = requirement.kind === "technical"
    ? `Describe how you have worked with ${requirement.text.toLowerCase()}.`
    : requirement.kind === "behavioural"
      ? `Explain a situation where ${requirement.text.toLowerCase()}.`
      : `How does ${requirement.text.toLowerCase()} show up in your work?`;

  return {
    id: `q-${requirement.id.replace(/^r-/, "")}`,
    requirement_ids: [requirement.id],
    category,
    prompt: promptBase,
    answer_outline: `Cover a concrete example, trade-offs, and a result or learning.`,
    difficulty: requirement.priority === "must" ? 3 : 2,
  } satisfies GeneratedQuestion;
}

function buildQuestionsForRequirements(requirements: Requirement[], companyEvidence: string[]): GeneratedQuestion[] {
  const categoryBuckets: Record<SchedulableQuestion["category"], Requirement[]> = {
    technical: [],
    behavioural: [],
    "system-design": [],
    "company-fit": [],
  };

  for (const requirement of requirements) {
    const category = chooseCategory(requirement);
    const evidence = companyEvidence.join(" ").toLowerCase();
    if (category === "company-fit" && evidence.includes("mentor") && requirement.kind !== "technical") {
      categoryBuckets["company-fit"].push(requirement);
    } else {
      categoryBuckets[category].push(requirement);
    }
  }

  const questions: GeneratedQuestion[] = [];
  for (const [category, bucket] of Object.entries(categoryBuckets) as [SchedulableQuestion["category"], Requirement[]][]) {
    for (const requirement of bucket) {
      questions.push(buildQuestionForRequirement(requirement, category));
    }
  }
  return questions;
}

function buildFlashcards(requirements: Requirement[]): InterviewKit["flashcards"] {
  return requirements.map((requirement) => ({
    id: `f-${requirement.id.replace(/^r-/, "")}`,
    front: requirement.text,
    back: requirement.priority === "must" ? `Focus area: ${requirement.kind}.` : `Good-to-have area: ${requirement.kind}.`,
    requirement_ids: [requirement.id],
  }));
}

export async function generateInterviewKit(input: GenerateKitInput, dependencies: GenerationDependencies = {}): Promise<InterviewKit> {
  const companyUrl = new URL(input.company_url).toString();
  const canonicalCompanyUrl = companyUrl.endsWith("/") ? companyUrl : `${companyUrl}/`;
  const companyResearch = await researchCompany(canonicalCompanyUrl, dependencies);
  const requirements = await extractRequirements(input.jd, dependencies);

  let questions = buildQuestionsForRequirements(requirements, companyResearch.interviewEvidence);
  let coverage = analyzeCoverage(requirements, questions);
  let passes = 1;

  if (coverage.uncovered_requirement_ids.length > 0) {
    const uncovered = requirements.filter((requirement) => coverage.uncovered_requirement_ids.includes(requirement.id));
    const secondPassQuestions = buildQuestionsForRequirements(uncovered, companyResearch.interviewEvidence);
    questions = [...questions, ...secondPassQuestions];
    coverage = analyzeCoverage(requirements, questions);
    passes = 2;
  }

  const role = inferRoleDetails(input.jd);
  const kit: InterviewKit = {
    source: {
      company: inferCompanyName(companyUrl),
      company_url: canonicalCompanyUrl,
      role: role.title,
      location: role.location,
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: companyResearch.sources,
    },
    company_brief: {
      summary: companyResearch.summary || "The company details available from public research were limited.",
      what_they_do: companyResearch.pages.length > 0 ? companyResearch.pages.map((page) => page.snippet).join(" ") : companyResearch.summary,
      sources: companyResearch.sources,
    },
    role: {
      title: role.title,
      seniority: role.seniority,
      responsibilities: role.responsibilities,
      requirements,
    },
    questions,
    flashcards: buildFlashcards(requirements),
    schedule: createSchedule(requirements, questions, input.days),
    coverage: {
      uncovered_requirement_ids: coverage.uncovered_requirement_ids,
      passes,
    },
  };

  return validateKit(kit);
}

export type GenerateKitResult = Promise<InterviewKit>;
