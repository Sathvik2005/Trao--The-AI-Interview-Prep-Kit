import { createHash } from "node:crypto";
import { analyzeCoverage } from "../domain/coverage.js";
import { type InterviewKit, validateKit } from "../domain/kit-schema.js";
import { isProtected, reconcileKit } from "../domain/reconcile.js";
import { buildRequirements, type Requirement } from "../domain/requirements.js";
import { createSchedule, type SchedulableQuestion } from "../domain/schedule.js";
import { extractRequirementsWithGemini } from "../llm/gemini-requirements.js";
import { geminiGenerationLlm, type Category, type GeneratedQuestionDraft, type GenerationLlm } from "../llm/generation-llm.js";
import { researchCompany, type CompanyResearchOptions, type CompanyResearchResult } from "../research/company-research.js";

export interface GenerateKitInput {
  jd: string;
  company_url: string;
  days: number;
}

export type StepStatus = "running" | "done" | "skipped" | "failed";
export interface ProgressEvent {
  step: string;
  label: string;
  status: StepStatus;
  detail?: string;
}

export interface GenerationDependencies extends CompanyResearchOptions {
  llmExtractRequirements?: (jobDescription: string) => Promise<Requirement[]>;
  /** Model-backed generation steps. `null` selects the deterministic offline templates. */
  llm?: GenerationLlm | null;
  onProgress?: (event: ProgressEvent) => void;
}

type Question = InterviewKit["questions"][number];
type Flashcard = InterviewKit["flashcards"][number];
export type RegenerableSection = "company_brief" | "questions" | "flashcards" | "schedule";

const CATEGORIES: Category[] = ["technical", "behavioural", "system-design", "company-fit"];
const MAX_COVERAGE_PASSES = 3;

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function resolveLlm(dependencies: GenerationDependencies): GenerationLlm | null {
  if (dependencies.llm !== undefined) return dependencies.llm;
  return process.env.GEMINI_API_KEY ? geminiGenerationLlm : null;
}

/** Stable key for "the same posting submitted twice". */
export function inputHash(input: GenerateKitInput): string {
  let url = input.company_url.trim();
  try {
    const parsed = new URL(url);
    url = `${parsed.protocol}//${parsed.host}${parsed.pathname.replace(/\/+$/, "")}`.toLowerCase();
  } catch {
    url = url.toLowerCase();
  }
  return createHash("sha256").update(`${normalizeWhitespace(input.jd).toLowerCase()}|${url}|${input.days}`).digest("hex").slice(0, 32);
}

function canonicalUrl(raw: string): string {
  const url = new URL(raw).toString();
  return url.endsWith("/") ? url : `${url}/`;
}

function inferRoleDetails(jobDescription: string): { title: string; seniority: string; location: string; responsibilities: string[] } {
  const normalized = normalizeWhitespace(jobDescription);
  const roleMatch = normalized.match(/\b((?:(?:Senior|Staff|Principal|Lead|Junior|Mid|Associate|Entry[- ]level)\s+)?(?:(?:[A-Z][A-Za-z0-9+#./-]*|of|and|for)\s+){0,3}(?:Engineer|Developer|Architect|Manager|Analyst|Designer|Scientist|Consultant|Specialist|Researcher))\b/i);
  const seniorityMatch = normalized.match(/\b(Senior|Staff|Principal|Lead|Junior|Mid)\b/i);
  const locationMatch = normalized.match(/\b(Remote|Hybrid|On[- ]site)\b/i);
  return {
    title: roleMatch ? normalizeWhitespace(roleMatch[1]) : "Engineer",
    seniority: seniorityMatch ? seniorityMatch[0] : "",
    location: locationMatch ? normalizeWhitespace(locationMatch[0]) : "",
    responsibilities: [],
  };
}

async function extractRequirements(jobDescription: string, dependencies: GenerationDependencies): Promise<Requirement[]> {
  if (!jobDescription.trim()) return [];
  if (dependencies.llmExtractRequirements) return dependencies.llmExtractRequirements(jobDescription);
  if (process.env.GEMINI_API_KEY) return extractRequirementsWithGemini(jobDescription);

  // Offline fallback (no provider key): only phrases that literally occur in the description.
  const clean = normalizeWhitespace(jobDescription);
  const patterns = [
    { text: "5+ years of React", source_quote: "5+ years of React", kind: "technical", priority: "must" as const },
    { text: "TypeScript experience", source_quote: "TypeScript", kind: "technical", priority: "must" as const },
    { text: "Mentor junior engineers", source_quote: "mentoring junior engineers", kind: "behavioural", priority: "nice" as const },
    { text: "Collaborate with product design", source_quote: "collaborate with product design", kind: "behavioural", priority: "nice" as const },
  ];
  const matches = patterns.filter((candidate) => clean.toLowerCase().includes(candidate.source_quote.toLowerCase()));
  return matches.length === 0 ? [] : buildRequirements(matches, jobDescription);
}

/** Decides which question categories each requirement belongs in. Pure, so it is easy to test. */
export function planCategories(requirements: Requirement[], hiringProcess: string): Record<Category, Requirement[]> {
  const plan: Record<Category, Requirement[]> = { technical: [], behavioural: [], "system-design": [], "company-fit": [] };
  const designWords = /(system design|architect|distributed|scalab|infrastructure|data pipeline|microservice)/i;
  const processMentionsDesign = /system design/i.test(hiringProcess);
  for (const requirement of requirements) {
    if (requirement.kind === "behavioural") plan.behavioural.push(requirement);
    else if (requirement.kind === "domain") plan["company-fit"].push(requirement);
    else plan.technical.push(requirement);
    if (requirement.kind === "technical" && (designWords.test(requirement.text) || (processMentionsDesign && requirement.priority === "must"))) {
      plan["system-design"].push(requirement);
    }
  }
  return plan;
}

function uniqueId(prefix: string, seed: string, taken: Set<string>): string {
  const base = `${prefix}-${createHash("sha256").update(seed).digest("hex").slice(0, 8)}`;
  let id = base;
  for (let counter = 2; taken.has(id); counter += 1) id = `${base}-${counter}`;
  taken.add(id);
  return id;
}

function templateQuestions(category: Category, requirements: Requirement[]): GeneratedQuestionDraft[] {
  return requirements.map((requirement) => ({
    requirement_ids: [requirement.id],
    prompt: category === "behavioural"
      ? `Tell me about a time you demonstrated this: ${requirement.text}.`
      : `Walk me through your experience with: ${requirement.text}.`,
    answer_outline: "Give a concrete example, the trade-offs you weighed, and the result or what you learned.",
    difficulty: requirement.priority === "must" ? 3 : 2,
  }));
}

interface QuestionContext {
  llm: GenerationLlm | null;
  company: string;
  brief: string;
  hiringProcess: string;
}

async function questionsForCategory(
  category: Category,
  requirements: Requirement[],
  context: QuestionContext,
  existing: Question[],
  count?: number,
): Promise<Question[]> {
  if (requirements.length === 0 && category !== "company-fit") return [];
  if (requirements.length === 0 && !context.brief) return [];
  const drafts = context.llm
    ? await context.llm.generateQuestions({
        category,
        requirements,
        company: context.company,
        brief: context.brief,
        hiringProcess: context.hiringProcess,
        existingPrompts: existing.map((question) => question.prompt),
        count,
      })
    : templateQuestions(category, requirements);
  const taken = new Set(existing.map((question) => question.id));
  const seenPrompts = new Set(existing.map((question) => normalizeWhitespace(question.prompt).toLowerCase()));
  const created: Question[] = [];
  for (const draft of drafts) {
    const key = normalizeWhitespace(draft.prompt).toLowerCase();
    if (seenPrompts.has(key)) continue;
    seenPrompts.add(key);
    created.push({
      id: uniqueId("q", `${category}:${draft.prompt}`, taken),
      requirement_ids: draft.requirement_ids,
      category,
      prompt: normalizeWhitespace(draft.prompt),
      answer_outline: normalizeWhitespace(draft.answer_outline),
      difficulty: Math.min(3, Math.max(1, Math.round(draft.difficulty))),
      origin: "generated",
    });
  }
  return created;
}

/**
 * The second pass: coverage is computed by code, never by the model. Every requirement with no
 * question is sent back for targeted generation, up to MAX_COVERAGE_PASSES, then filled by a plain
 * template question so a must-have can never ship uncovered.
 */
async function closeCoverageGaps(
  requirements: Requirement[],
  questions: Question[],
  plan: Record<Category, Requirement[]>,
  context: QuestionContext,
  startPass: number,
  emit: (event: ProgressEvent) => void,
): Promise<{ questions: Question[]; passes: number; notes: string[] }> {
  let all = [...questions];
  let passes = startPass;
  const notes: string[] = [];
  for (let attempt = 0; attempt < MAX_COVERAGE_PASSES; attempt += 1) {
    const uncovered = new Set(analyzeCoverage(requirements, all).uncovered_requirement_ids);
    if (uncovered.size === 0) break;
    passes += 1;
    emit({ step: "coverage", label: "Coverage check", status: "running", detail: `Pass ${passes}: ${uncovered.size} requirement(s) have no question; generating them.` });
    for (const category of CATEGORIES) {
      const gaps = plan[category].filter((requirement) => uncovered.has(requirement.id));
      if (gaps.length === 0) continue;
      try {
        all = [...all, ...await questionsForCategory(category, gaps, context, all, gaps.length)];
      } catch {
        // The loop re-checks coverage; a failed call just leaves the gap for the next pass.
      }
    }
  }
  const stillUncovered = analyzeCoverage(requirements, all).uncovered_requirement_ids;
  if (stillUncovered.length > 0) {
    const plain = requirements.filter((requirement) => stillUncovered.includes(requirement.id));
    for (const requirement of plain) {
      const category = plan.behavioural.includes(requirement) ? "behavioural" : "technical";
      all = [...all, ...await questionsForCategory(category, [requirement], { ...context, llm: null }, all)];
    }
    notes.push(`${plain.length} requirement(s) were still uncovered after ${MAX_COVERAGE_PASSES} model passes and received plain template questions.`);
  }
  return { questions: all, passes, notes };
}

async function writeFlashcards(requirements: Requirement[], company: string, llm: GenerationLlm | null, existing: Flashcard[]): Promise<Flashcard[]> {
  if (requirements.length === 0) return [];
  const taken = new Set(existing.map((card) => card.id));
  let drafts: Array<{ front: string; back: string; requirement_ids: string[] }> = [];
  if (llm) {
    try {
      drafts = await llm.generateFlashcards(requirements, company);
    } catch {
      drafts = [];
    }
  }
  const covered = new Set(drafts.flatMap((draft) => draft.requirement_ids));
  for (const requirement of requirements) {
    if (covered.has(requirement.id)) continue;
    drafts.push({ front: `What would you say about: ${requirement.text}?`, back: `Prepare a concrete example for "${requirement.text}" and the trade-offs behind it.`, requirement_ids: [requirement.id] });
  }
  return drafts.map((draft) => ({
    id: uniqueId("f", draft.front, taken),
    front: normalizeWhitespace(draft.front),
    back: normalizeWhitespace(draft.back),
    requirement_ids: draft.requirement_ids,
    origin: "generated" as const,
  }));
}

interface BriefResult {
  summary: string;
  what_they_do: string;
  hiring_process: string;
}

async function composeBrief(research: CompanyResearchResult, llm: GenerationLlm | null): Promise<BriefResult> {
  if (research.pages.length === 0 && research.discussion.length === 0) {
    return {
      summary: `No information about ${research.company} could be retrieved from its website or public discussion, so this brief is intentionally minimal.`,
      what_they_do: "",
      hiring_process: "",
    };
  }
  if (llm) {
    const draft = await llm.writeBrief(research.company, research.pages.map((page) => ({ url: page.url, text: page.text })), research.discussion);
    return { summary: normalizeWhitespace(draft.summary), what_they_do: normalizeWhitespace(draft.what_they_do), hiring_process: normalizeWhitespace(draft.hiring_process) };
  }
  return {
    summary: research.summary || "The company details available from public research were limited.",
    what_they_do: research.pages.map((page) => page.snippet).join(" "),
    hiring_process: research.discussion.map((item) => item.snippet).filter(Boolean).join(" "),
  };
}

function briefSources(research: CompanyResearchResult): string[] {
  return Array.from(new Set([...research.sources, ...research.discussion.map((item) => item.url)]));
}

export async function generateInterviewKit(input: GenerateKitInput, dependencies: GenerationDependencies = {}): Promise<InterviewKit> {
  const emit = dependencies.onProgress ?? (() => undefined);
  const llm = resolveLlm(dependencies);
  const companyUrl = canonicalUrl(input.company_url);
  const notes: string[] = [];

  emit({ step: "requirements", label: "Extracting requirements from the job description", status: "running" });
  const requirements = await extractRequirements(input.jd, dependencies);
  if (requirements.length === 0) notes.push("The job description contained too little detail to extract any requirements, so the kit is intentionally thin.");
  emit({ step: "requirements", label: "Extracting requirements from the job description", status: "done", detail: `${requirements.length} requirement(s) found` });

  emit({ step: "role", label: "Reading the role", status: "running" });
  let role = inferRoleDetails(input.jd);
  if (llm && input.jd.trim().length > 0) {
    try {
      role = await llm.describeRole(input.jd);
    } catch {
      notes.push("The role details were inferred heuristically because the model call failed.");
    }
  }
  emit({ step: "role", label: "Reading the role", status: "done", detail: role.title });

  emit({ step: "research", label: "Crawling the company site and searching public discussion", status: "running" });
  const research = await researchCompany(companyUrl, dependencies);
  notes.push(...research.notes);
  emit({ step: "research", label: "Crawling the company site and searching public discussion", status: "done", detail: `${research.pages.length} page(s), ${research.discussion.length} discussion item(s)` });

  emit({ step: "brief", label: "Writing the company brief", status: "running" });
  let brief: BriefResult;
  try {
    brief = await composeBrief(research, llm);
  } catch (error) {
    notes.push(`The company brief fell back to raw page excerpts because the model call failed (${error instanceof Error ? error.message : "error"}).`);
    brief = await composeBrief(research, null);
  }
  emit({ step: "brief", label: "Writing the company brief", status: "done" });

  const context: QuestionContext = { llm, company: research.company, brief: `${brief.summary} ${brief.what_they_do}`.trim(), hiringProcess: brief.hiring_process };
  const plan = planCategories(requirements, brief.hiring_process);
  emit({ step: "questions", label: "Generating questions by category", status: "running" });
  const generateCategory = (category: Category) =>
    questionsForCategory(category, plan[category], context, [], category === "company-fit" && plan[category].length === 0 ? 2 : undefined);
  const failedCategories: Category[] = [];
  const categoryResults = await Promise.all(CATEGORIES.map(async (category) => {
    try {
      return await generateCategory(category);
    } catch {
      failedCategories.push(category);
      return [] as Question[];
    }
  }));
  // One sequential retry of any category that failed while the provider was busy.
  for (const category of failedCategories) {
    try {
      categoryResults[CATEGORIES.indexOf(category)] = await generateCategory(category);
    } catch (error) {
      notes.push(`${category} questions could not be generated (${error instanceof Error ? error.message : "error"}).`);
    }
  }
  const taken = new Set<string>();
  let questions: Question[] = categoryResults.flat().map((question) => ({ ...question, id: uniqueId("q", question.id, taken) }));
  emit({ step: "questions", label: "Generating questions by category", status: "done", detail: `${questions.length} question(s)` });

  emit({ step: "coverage", label: "Coverage check", status: "running" });
  const closed = await closeCoverageGaps(requirements, questions, plan, context, 1, emit);
  questions = closed.questions;
  notes.push(...closed.notes);
  const coverage = analyzeCoverage(requirements, questions);
  emit({ step: "coverage", label: "Coverage check", status: "done", detail: `${closed.passes} pass(es), ${coverage.uncovered_requirement_ids.length} uncovered` });

  emit({ step: "flashcards", label: "Writing flashcards", status: "running" });
  const flashcards = await writeFlashcards(requirements, research.company, llm, []);
  emit({ step: "flashcards", label: "Writing flashcards", status: "done", detail: `${flashcards.length} card(s)` });

  emit({ step: "schedule", label: "Allocating the study schedule", status: "running" });
  const schedule = createSchedule(requirements, questions as SchedulableQuestion[], input.days);
  emit({ step: "schedule", label: "Allocating the study schedule", status: "done", detail: `${input.days} day(s)` });

  const kit: InterviewKit = {
    source: {
      company: research.company,
      company_url: companyUrl,
      role: role.title,
      location: role.location,
      jd_chars: input.jd.length,
      researched_at: new Date().toISOString(),
      pages_used: research.sources,
      input_hash: inputHash(input),
    },
    company_brief: { summary: brief.summary, what_they_do: brief.what_they_do, sources: briefSources(research), hiring_process: brief.hiring_process },
    role: { title: role.title, seniority: role.seniority, responsibilities: role.responsibilities, requirements },
    questions,
    flashcards,
    schedule,
    coverage: { uncovered_requirement_ids: coverage.uncovered_requirement_ids, passes: closed.passes },
    research_notes: Array.from(new Set(notes)),
  };
  return validateKit(kit);
}

export interface RegenerateOptions {
  section: RegenerableSection;
  category?: Category;
  days?: number;
}

/**
 * Regenerates exactly one section. Questions and flashcards the user edited, wrote or pinned are
 * kept (origin and pinned flags carry the provenance); everything outside the section is untouched.
 */
export async function regenerateSection(kit: InterviewKit, options: RegenerateOptions, dependencies: GenerationDependencies = {}): Promise<InterviewKit> {
  const llm = resolveLlm(dependencies);
  const next = structuredClone(kit);
  const requirements = next.role.requirements;
  const notes = new Set(next.research_notes ?? []);

  if (options.section === "company_brief") {
    const research = await researchCompany(next.source.company_url, dependencies);
    const brief = await composeBrief(research, llm);
    next.company_brief = { summary: brief.summary, what_they_do: brief.what_they_do, sources: briefSources(research), hiring_process: brief.hiring_process };
    next.source.pages_used = research.sources;
    next.source.researched_at = new Date().toISOString();
    for (const note of research.notes) notes.add(note);
  } else if (options.section === "questions") {
    const categories = options.category ? [options.category] : CATEGORIES;
    const context: QuestionContext = {
      llm,
      company: next.source.company,
      brief: `${next.company_brief.summary} ${next.company_brief.what_they_do}`.trim(),
      hiringProcess: next.company_brief.hiring_process ?? "",
    };
    const plan = planCategories(requirements, context.hiringProcess);
    const keep = next.questions.filter((question) => !categories.includes(question.category) || isProtected(question));
    let rebuilt = keep;
    for (const category of categories) {
      const protectedCovered = new Set(keep.filter((question) => question.category === category).flatMap((question) => question.requirement_ids));
      const targets = plan[category].filter((requirement) => !protectedCovered.has(requirement.id));
      if (targets.length === 0 && !(category === "company-fit" && plan[category].length === 0)) continue;
      rebuilt = [...rebuilt, ...await questionsForCategory(category, targets, context, rebuilt, category === "company-fit" && targets.length === 0 ? 2 : undefined)];
    }
    const closed = await closeCoverageGaps(requirements, rebuilt, plan, context, next.coverage.passes, () => undefined);
    next.questions = closed.questions;
    next.coverage.passes = closed.passes;
    for (const note of closed.notes) notes.add(note);
  } else if (options.section === "flashcards") {
    const keep = next.flashcards.filter(isProtected);
    const protectedCovered = new Set(keep.flatMap((card) => card.requirement_ids));
    const targets = requirements.filter((requirement) => !protectedCovered.has(requirement.id));
    next.flashcards = [...keep, ...await writeFlashcards(targets, next.source.company, llm, keep)];
  } else {
    next.schedule = createSchedule(requirements, next.questions as SchedulableQuestion[], options.days ?? next.schedule.days_available);
  }

  next.research_notes = Array.from(notes);
  return validateKit(reconcileKit(next));
}
