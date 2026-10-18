import { z } from "zod";

const requirementSchema = z
  .object({
    id: z.string().min(1),
    text: z.string().min(1),
    kind: z.enum(["technical", "behavioural", "domain"]),
    priority: z.enum(["must", "nice"]),
  })
  .strict();

const questionSchema = z
  .object({
    id: z.string().min(1),
    requirement_ids: z.array(z.string()),
    category: z.enum(["technical", "behavioural", "system-design", "company-fit"]),
    prompt: z.string().min(1),
    answer_outline: z.string(),
    difficulty: z.number().int().min(1).max(3),
  })
  .strict();

const flashcardSchema = z
  .object({
    id: z.string().min(1),
    front: z.string().min(1),
    back: z.string().min(1),
    requirement_ids: z.array(z.string()),
  })
  .strict();

const scheduleDaySchema = z
  .object({
    day: z.number().int().positive(),
    focus: z.string().min(1),
    question_ids: z.array(z.string()),
    minutes: z.number().int().nonnegative(),
  })
  .strict();

export const kitSchema = z
  .object({
    source: z
      .object({
        company: z.string(),
        company_url: z.string().url(),
        role: z.string(),
        location: z.string(),
        jd_chars: z.number().int().nonnegative(),
        researched_at: z.string().datetime({ offset: true }),
        pages_used: z.array(z.string().url()),
      })
      .strict(),
    company_brief: z
      .object({
        summary: z.string(),
        what_they_do: z.string(),
        sources: z.array(z.string().url()),
      })
      .strict(),
    role: z
      .object({
        title: z.string(),
        seniority: z.string(),
        responsibilities: z.array(z.string()),
        requirements: z.array(requirementSchema),
      })
      .strict(),
    questions: z.array(questionSchema),
    flashcards: z.array(flashcardSchema),
    schedule: z
      .object({
        days_available: z.number().int().positive(),
        days: z.array(scheduleDaySchema),
      })
      .strict(),
    coverage: z
      .object({
        uncovered_requirement_ids: z.array(z.string()),
        passes: z.number().int().positive(),
      })
      .strict(),
  })
  .strict()
  .superRefine((kit, context) => {
    const requirementIds = kit.role.requirements.map((requirement) => requirement.id);
    const questionIds = kit.questions.map((question) => question.id);
    const flashcardIds = kit.flashcards.map((flashcard) => flashcard.id);
    const unique = (values: string[]) => new Set(values).size === values.length;

    if (!unique(requirementIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["role", "requirements"], message: "Requirement IDs must be unique." });
    }
    if (!unique(questionIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["questions"], message: "Question IDs must be unique." });
    }
    if (!unique(flashcardIds)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["flashcards"], message: "Flashcard IDs must be unique." });
    }

    const requirementIdSet = new Set(requirementIds);
    const questionIdSet = new Set(questionIds);
    for (const [index, question] of kit.questions.entries()) {
      for (const id of question.requirement_ids) {
        if (!requirementIdSet.has(id)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["questions", index, "requirement_ids"], message: `Unknown requirement ID: ${id}` });
        }
      }
    }
    for (const [index, flashcard] of kit.flashcards.entries()) {
      for (const id of flashcard.requirement_ids) {
        if (!requirementIdSet.has(id)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["flashcards", index, "requirement_ids"], message: `Unknown requirement ID: ${id}` });
        }
      }
    }

    const referencedRequirementIds = new Set(kit.questions.flatMap((question) => question.requirement_ids));
    const expectedUncovered = requirementIds.filter((id) => !referencedRequirementIds.has(id));
    if (JSON.stringify(kit.coverage.uncovered_requirement_ids) !== JSON.stringify(expectedUncovered)) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["coverage", "uncovered_requirement_ids"], message: "Coverage must match the deterministic question-to-requirement analysis." });
    }
    const uncoveredMust = kit.role.requirements.filter((requirement) => requirement.priority === "must" && expectedUncovered.includes(requirement.id));
    if (uncoveredMust.length > 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["coverage", "uncovered_requirement_ids"], message: "Every must-have requirement must be covered by a question." });
    }

    if (kit.schedule.days.length !== kit.schedule.days_available) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["schedule", "days"], message: "Schedule must contain exactly days_available entries." });
    }
    const scheduledQuestionIds = new Set<string>();
    for (const [index, day] of kit.schedule.days.entries()) {
      if (day.day !== index + 1) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["schedule", "days", index, "day"], message: "Schedule day numbers must be sequential starting at 1." });
      }
      for (const id of day.question_ids) {
        if (!questionIdSet.has(id)) {
          context.addIssue({ code: z.ZodIssueCode.custom, path: ["schedule", "days", index, "question_ids"], message: `Unknown question ID: ${id}` });
        }
        scheduledQuestionIds.add(id);
      }
    }
    for (const id of questionIds) {
      if (!scheduledQuestionIds.has(id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["schedule", "days"], message: `Question ${id} is missing from the schedule.` });
      }
    }
    const scheduledRequirementIds = new Set(
      kit.schedule.days.flatMap((day) => day.question_ids).flatMap((id) => kit.questions.find((question) => question.id === id)?.requirement_ids ?? []),
    );
    for (const requirement of kit.role.requirements) {
      if (requirement.priority === "must" && !scheduledRequirementIds.has(requirement.id)) {
        context.addIssue({ code: z.ZodIssueCode.custom, path: ["schedule", "days"], message: `Must-have requirement ${requirement.id} is missing from the schedule.` });
      }
    }
  });

export type InterviewKit = z.infer<typeof kitSchema>;

export function validateKit(input: unknown): InterviewKit {
  return kitSchema.parse(input);
}