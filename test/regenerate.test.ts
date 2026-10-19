import { describe, expect, it } from "vitest";
import { validateKit, type InterviewKit } from "../src/domain/kit-schema.js";
import { planCategories, regenerateSection } from "../src/pipeline/generate-kit.js";
import { researchCompany } from "../src/research/company-research.js";
import type { GenerationLlm } from "../src/llm/generation-llm.js";

const site: Record<string, { status: number; contentType: string; text: string }> = {
  "https://acme.test/": { status: 200, contentType: "text/html", text: '<a href="/careers">Join us</a><a href="/login">Login</a><p>Acme builds logistics software for shipping teams.</p>' },
  "https://acme.test/careers": { status: 200, contentType: "text/html", text: "Careers at Acme: our interview has a take-home followed by a system design round with the team." },
  "https://acme.test/robots.txt": { status: 200, contentType: "text/plain", text: "User-agent: *\nDisallow: /private" },
  "https://acme.test/private": { status: 200, contentType: "text/html", text: "Secret page that crawlers must not read at all, ever, by robots rules." },
};
const fetchPage = async (url: string) => ({ url, ...(site[url] ?? { status: 404, contentType: "text/plain", text: "no" }) });

const requirements: InterviewKit["role"]["requirements"] = [
  { id: "r1", text: "5+ years of React", kind: "technical", priority: "must" },
  { id: "r2", text: "Mentor junior engineers", kind: "behavioural", priority: "must" },
];

function baseKit(): InterviewKit {
  return {
    source: { company: "Acme", company_url: "https://acme.test/", role: "Engineer", location: "", jd_chars: 50, researched_at: new Date().toISOString(), pages_used: ["https://acme.test/"] },
    company_brief: { summary: "Old summary.", what_they_do: "Old.", sources: ["https://acme.test/"], hiring_process: "" },
    role: { title: "Engineer", seniority: "", responsibilities: [], requirements },
    questions: [
      { id: "q-a", requirement_ids: ["r1"], category: "technical", prompt: "Generated technical question one?", answer_outline: "x", difficulty: 2, origin: "generated" },
      { id: "q-b", requirement_ids: ["r1"], category: "technical", prompt: "My hand-edited technical question", answer_outline: "x", difficulty: 2, origin: "edited" },
      { id: "q-c", requirement_ids: ["r2"], category: "behavioural", prompt: "Generated behavioural question?", answer_outline: "x", difficulty: 2, origin: "generated" },
    ],
    flashcards: [{ id: "f1", front: "React", back: "Hooks", requirement_ids: ["r1"] }],
    schedule: { days_available: 2, days: [{ day: 1, focus: "a", question_ids: ["q-a", "q-b"], minutes: 50 }, { day: 2, focus: "b", question_ids: ["q-c"], minutes: 25 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

const llm: GenerationLlm = {
  describeRole: async () => ({ title: "Engineer", seniority: "", location: "", responsibilities: [] }),
  writeBrief: async () => ({ summary: "Acme ships logistics software.", what_they_do: "Logistics.", hiring_process: "Take-home then system design." }),
  generateQuestions: async ({ category, requirements: wanted }) => wanted.map((requirement, index) => ({
    requirement_ids: [requirement.id], prompt: `Fresh ${category} question ${index} about ${requirement.text}?`, answer_outline: "y", difficulty: 3,
  })),
  generateFlashcards: async (wanted) => wanted.map((requirement) => ({ front: `Card ${requirement.text}`, back: "back", requirement_ids: [requirement.id] })),
};

describe("section regeneration", () => {
  it("replaces generated questions in one category and keeps edited ones and other categories", async () => {
    const result = await regenerateSection(baseKit(), { section: "questions", category: "technical" }, { llm });
    const ids = result.questions.map((question) => question.id);
    expect(ids).toContain("q-b");
    expect(ids).toContain("q-c");
    expect(ids).not.toContain("q-a");
    expect(result.questions.find((question) => question.id === "q-b")?.prompt).toBe("My hand-edited technical question");
    expect(result.questions.find((question) => question.id === "q-c")?.prompt).toBe("Generated behavioural question?");
    expect(validateKit(result)).toBeTruthy();
    const scheduled = result.schedule.days.flatMap((day) => day.question_ids).sort();
    expect(scheduled).toEqual([...ids].sort());
  });

  it("keeps a pinned question even if it was never edited", async () => {
    const kit = baseKit();
    kit.questions[0].pinned = true;
    const result = await regenerateSection(kit, { section: "questions", category: "technical" }, { llm });
    expect(result.questions.map((question) => question.id)).toContain("q-a");
  });

  it("rebuilds only the schedule when asked and honours a new day count", async () => {
    const before = baseKit();
    const result = await regenerateSection(before, { section: "schedule", days: 4 }, { llm });
    expect(result.schedule.days).toHaveLength(4);
    expect(result.questions).toEqual(before.questions);
  });
});

describe("company research", () => {
  it("follows ranked links, respects robots.txt and reports a missing site honestly", async () => {
    const found = await researchCompany("https://acme.test/", { fetchPage, searchPublicDiscussion: async () => ({ urls: [] }) });
    expect(found.sources).toContain("https://acme.test/careers");
    expect(found.sources).not.toContain("https://acme.test/login");
    expect(found.notes.join(" ")).toMatch(/No public discussion/);

    const dead = await researchCompany("https://gone.test/", { fetchPage, searchPublicDiscussion: async () => ({ urls: [] }) });
    expect(dead.pages).toHaveLength(0);
    expect(dead.notes.join(" ")).toMatch(/HTTP 404/);
  });

  it("plans system design from the hiring process", () => {
    const plan = planCategories(requirements, "A take-home followed by a system design round");
    expect(plan["system-design"].map((item) => item.id)).toEqual(["r1"]);
    expect(planCategories(requirements, "")["system-design"]).toEqual([]);
  });
});
