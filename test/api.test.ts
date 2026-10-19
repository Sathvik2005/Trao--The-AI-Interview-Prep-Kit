import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { InterviewKit } from "../src/domain/kit-schema.js";
import { createApp } from "../src/api/app.js";
import { MemoryStore } from "../src/api/memory-store.js";
import { hashJwtToken } from "../src/api/store.js";

function validKit(): InterviewKit {
  const requirement = { id: "r-react", text: "React experience", kind: "technical" as const, priority: "must" as const };
  return {
    source: { company: "Example", company_url: "https://example.com/", role: "Frontend Engineer", location: "Remote", jd_chars: 42, researched_at: new Date().toISOString(), pages_used: ["https://example.com/"] },
    company_brief: { summary: "Example company.", what_they_do: "Builds useful software.", sources: ["https://example.com/"] },
    role: { title: "Frontend Engineer", seniority: "Senior", responsibilities: ["Build user interfaces"], requirements: [requirement] },
    questions: [{ id: "q-react", requirement_ids: [requirement.id], category: "technical", prompt: "How have you used React?", answer_outline: "Share a project and its result.", difficulty: 2 }],
    flashcards: [{ id: "f-react", front: "React experience", back: "Discuss a project.", requirement_ids: [requirement.id] }],
    schedule: { days_available: 1, days: [{ day: 1, focus: "Technical practice", question_ids: ["q-react"], minutes: 35 }] },
    coverage: { uncovered_requirement_ids: [], passes: 1 },
  };
}

const stores: MemoryStore[] = [];
afterEach(() => { stores.length = 0; });

function setup() {
  const store = new MemoryStore();
  stores.push(store);
  const app = createApp({ store, jwtSecret: "a-test-secret-that-is-at-least-thirty-two-characters", generateKit: async () => validKit() });
  return { app, store };
}

async function register(app: ReturnType<typeof createApp>, email: string) {
  const result = await request(app).post("/api/auth/register").send({ email, password: "correct horse battery" });
  expect(result.status).toBe(201);
  return result.body.token as string;
}

describe("authenticated kit API", () => {
  it("reports ephemeral memory persistence honestly in its health response", async () => {
    const { app } = setup();
    const health = await request(app).get("/api/health");
    expect(health.status).toBe(200);
    expect(health.body).toEqual({ status: "ok", persistence: "memory" });
  });

  it("requires a JWT, validates saved kits, and keeps resources private to their owner", async () => {
    const { app } = setup();
    expect((await request(app).get("/api/kits")).status).toBe(401);

    const ownerToken = await register(app, "owner@example.com");
    expect(ownerToken.split(".")).toHaveLength(3);
    const created = await request(app).post("/api/kits").set("Authorization", `Bearer ${ownerToken}`).send({ jd: "Senior frontend engineer required for product team", company_url: "https://example.com", days: 1 });
    expect(created.status).toBe(201);
    expect(created.body.kit.kit.questions).toHaveLength(1);
    expect(created.body.kit.user_id).toBeUndefined();

    const otherToken = await register(app, "other@example.com");
    expect((await request(app).get(`/api/kits/${created.body.kit.id}`).set("Authorization", `Bearer ${otherToken}`)).status).toBe(404);
    expect((await request(app).get("/api/kits").set("Authorization", `Bearer ${otherToken}`)).body.kits).toEqual([]);

    const invalid = structuredClone(created.body.kit.kit);
    invalid.questions[0].requirement_ids = ["r-does-not-exist"];
    expect((await request(app).put(`/api/kits/${created.body.kit.id}`).set("Authorization", `Bearer ${ownerToken}`).send(invalid)).status).toBe(400);
  });

  it("persists practice confidence and revokes JWT access on logout", async () => {
    const { app, store } = setup();
    const token = await register(app, "practice@example.com");
    const created = await request(app).post("/api/kits").set("Authorization", `Bearer ${token}`).send({ jd: "Senior frontend engineer required for product team", company_url: "https://example.com", days: 1 });
    const kitId = created.body.kit.id as string;
    const confidence = await request(app).post(`/api/kits/${kitId}/practice`).set("Authorization", `Bearer ${token}`).send({ flashcard_id: "f-react", confidence: 2 });
    expect(confidence.status).toBe(200);
    expect(confidence.body.kit.practice["f-react"]).toBe(2);
    expect(store.sessions[0].token_hash).toBe(hashJwtToken(token));

    expect((await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`)).status).toBe(204);
    expect((await request(app).get("/api/kits").set("Authorization", `Bearer ${token}`)).status).toBe(401);
  });

  it("rejects weak passwords and invalid schedule inputs", async () => {
    const { app } = setup();
    expect((await request(app).post("/api/auth/register").send({ email: "weak@example.com", password: "short" })).status).toBe(400);
    const token = await register(app, "validation@example.com");
    expect((await request(app).post("/api/kits").set("Authorization", `Bearer ${token}`).send({ jd: "Senior frontend engineer required for product team", company_url: "https://example.com", days: 0 })).status).toBe(400);
  });
});
