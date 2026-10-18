import { describe, expect, it } from "vitest";
import { kitSchema } from "../src/domain/kit-schema.js";
import { generateInterviewKit, type GenerateKitInput } from "../src/pipeline/generate-kit.js";
import { validateCompanyUrl } from "../src/research/company-research.js";

describe("company URL validation", () => {
  it("rejects unsafe loopback addresses in production", () => {
    expect(() => validateCompanyUrl("http://127.0.0.1:3000", { allowLocalhost: false, production: true })).toThrow();
    expect(() => validateCompanyUrl("http://localhost:8099/acme/", { allowLocalhost: false, production: true })).toThrow();
    expect(() => validateCompanyUrl("http://169.254.169.254/metadata", { allowLocalhost: true, production: true })).toThrow();
    expect(() => validateCompanyUrl("http://[fd00::1]/", { allowLocalhost: true, production: true })).toThrow();
  });

  it("allows localhost for evaluation fixtures when explicitly permitted", () => {
    expect(() => validateCompanyUrl("http://localhost:8099/acme/", { allowLocalhost: true, production: false })).not.toThrow();
  });
});

describe("pipeline generation", () => {
  it("builds a valid kit with coverage and schedule from a realistic job description", async () => {
    const input: GenerateKitInput = {
      jd: "We are looking for a Senior Frontend Engineer. Required: 5+ years of React and TypeScript. Preferred: mentoring engineers and collaborating with product design.",
      company_url: "https://example.com",
      days: 5,
    };

    const kit = await generateInterviewKit(input, {
      fetchPage: async (url: string) => {
        const normalized = url.endsWith("/") ? url.slice(0, -1) : url;
        if (normalized === "https://example.com") {
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: `
              <html>
                <body>
                  <a href="/careers">Careers</a>
                  <a href="/engineering">Engineering</a>
                </body>
              </html>
            `,
          };
        }
        if (normalized === "https://example.com/careers") {
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: "We hire engineers with strong React, TypeScript, product sense, and mentoring culture.",
          };
        }
        if (normalized === "https://example.com/engineering") {
          return {
            status: 200,
            url,
            contentType: "text/html",
            text: "Engineering teams build web platforms, review designs, and mentor new engineers.",
          };
        }
        return { status: 404, url, contentType: "text/plain", text: "Not found" };
      },
      searchPublicDiscussion: async () => ({ urls: ["https://example.com/blog/interview-process"] }),
    });

    expect(kitSchema.safeParse(kit).success).toBe(true);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days_available).toBe(5);
    expect(kit.schedule.days).toHaveLength(5);
    expect(kit.questions.every((question) => question.requirement_ids.length > 0)).toBe(true);
    expect(kit.source.pages_used.some((page) => page.includes("example.com"))).toBe(true);
  });

  it("does not invent requirements from a sparse description", async () => {
    const kit = await generateInterviewKit({ jd: "Two-line stub. We do some software work.", company_url: "https://example.com", days: 1 }, {
      fetchPage: async (url: string) => ({
        status: 200,
        url,
        contentType: "text/html",
        text: "<html><body><a href='/'>Home</a></body></html>",
      }),
      searchPublicDiscussion: async () => ({ urls: [] }),
    });

    expect(kit.role.requirements.length).toBeLessThanOrEqual(2);
    expect(kit.coverage.uncovered_requirement_ids).toEqual([]);
    expect(kit.schedule.days).toHaveLength(1);
    expect(kitSchema.safeParse(kit).success).toBe(true);
  });
});
