import { describe, expect, it } from "vitest";
import { analyzeCoverage } from "../src/domain/coverage.js";
import { kitSchema } from "../src/domain/kit-schema.js";
import { buildRequirements } from "../src/domain/requirements.js";
import { createSchedule } from "../src/domain/schedule.js";

const jd = "Required: five years of React. Preferred: mentoring junior engineers.";

const requirements = buildRequirements(
  [
    { text: "Five years of React", source_quote: "five years of React", kind: "technical", priority: "must" },
    { text: "Mentor junior engineers", source_quote: "mentoring junior engineers", kind: "behavioural", priority: "nice" },
  ],
  jd,
);

function validKit() {
  const questions = [
    { id: "q-react", requirement_ids: [requirements[0].id], category: "technical", prompt: "How have you used React?", answer_outline: "Discuss a concrete example.", difficulty: 3 },
    { id: "q-mentor", requirement_ids: [requirements[1].id], category: "behavioural", prompt: "How do you mentor?", answer_outline: "Describe an outcome.", difficulty: 1 },
  ] as const;
  return {
    source: {
      company: "Example Co",
      company_url: "https://example.com",
      role: "Engineer",
      location: "Remote",
      jd_chars: jd.length,
      researched_at: "2026-10-18T12:00:00Z",
      pages_used: ["https://example.com"],
    },
    company_brief: { summary: "", what_they_do: "", sources: [] },
    role: { title: "Engineer", seniority: "", responsibilities: [], requirements },
    questions: [...questions],
    flashcards: [{ id: "f-react", front: "React experience", back: "Five years", requirement_ids: [requirements[0].id] }],
    schedule: createSchedule(requirements, [...questions], 1),
    coverage: { uncovered_requirement_ids: [], passes: 2 },
  };
}

describe("requirement extraction validation", () => {
  it("assigns stable IDs and only accepts evidence quoted from the description", () => {
    const candidates = [{ text: "Five years of React", source_quote: "five years of React", kind: "technical", priority: "must" }];
    const first = buildRequirements(candidates, jd);
    const second = buildRequirements(candidates, jd);
    expect(first).toEqual(second);
    expect(first[0].id).toMatch(/^r-[a-f0-9]{12}$/);
    expect(() => buildRequirements([{ ...candidates[0], source_quote: "expert in Kubernetes" }], jd)).toThrow(/quoted/);
  });

  it("rejects invalid priority values", () => {
    expect(() => buildRequirements([{ text: "React", source_quote: "React", kind: "technical", priority: "required" }], jd)).toThrow();
  });

  it("returns no requirements for an empty extraction", () => {
    expect(buildRequirements([], "Two-line stub with no requirements.")).toEqual([]);
  });
});

describe("deterministic coverage", () => {
  it("reports a requirement with no referencing question as uncovered", () => {
    expect(analyzeCoverage(requirements, [{ requirement_ids: [requirements[0].id] }])).toEqual({
      uncovered_requirement_ids: [requirements[1].id],
    });
  });
});

describe("kit validation", () => {
  it("rejects dangling question references and invalid requirement priorities", () => {
    const kit = validKit();
    const dangling = structuredClone(kit);
    ((dangling.questions[0] as unknown) as { requirement_ids: string[] }).requirement_ids = ["r-missing"];
    expect(kitSchema.safeParse(dangling).success).toBe(false);

    const invalidPriority = structuredClone(kit);
    (invalidPriority.role.requirements[0] as { priority: string }).priority = "required";
    expect(kitSchema.safeParse(invalidPriority).success).toBe(false);
  });

  it("accepts the exact Appendix A shape with valid cross-references", () => {
    expect(kitSchema.safeParse(validKit()).success).toBe(true);
  });
});

describe("deterministic schedules", () => {
  it("builds a valid one-day schedule and places must-have material first", () => {
    const kit = validKit();
    expect(kit.schedule.days).toHaveLength(1);
    expect(kit.schedule.days[0].question_ids).toEqual(["q-react", "q-mentor"]);
    expect(kitSchema.safeParse(kit).success).toBe(true);
  });

  it("builds exactly 60 days with integer minutes and schedules all questions", () => {
    const kit = validKit();
    const schedule = createSchedule(requirements, kit.questions, 60);
    expect(schedule.days).toHaveLength(60);
    expect(schedule.days.every((day) => Number.isInteger(day.minutes))).toBe(true);
    expect(new Set(schedule.days.flatMap((day) => day.question_ids))).toEqual(new Set(["q-react", "q-mentor"]));
    expect(schedule.days[0].question_ids).toContain("q-react");
  });
});