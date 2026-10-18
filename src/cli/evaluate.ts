import "dotenv/config";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { generateInterviewKit } from "../pipeline/generate-kit.js";

const batchCaseSchema = z.object({
  id: z.string().trim().min(1).max(200),
  jd: z.string().trim().min(1),
  company_url: z.string().url(),
  days: z.number().int().min(1).max(60),
}).strict();

type BatchCase = z.infer<typeof batchCaseSchema>;
type CaseResult = {
  id: string;
  status: "ok" | "failed";
  kit: Awaited<ReturnType<typeof generateInterviewKit>> | null;
  error: { code: string; message: string } | null;
};

export function parseArgs(argv: string[]): { input: string; output: string } {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--") || !["--input", "--output"].includes(token)) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${token}.`);
    const key = token.slice(2);
    if (args[key]) throw new Error(`Duplicate argument: ${token}`);
    args[key] = next;
    index += 1;
  }
  if (!args.input || !args.output) throw new Error("Usage: npm run evaluate -- --input <cases.json> --output <kits.json>");
  return { input: args.input, output: args.output };
}

export async function evaluateCases(
  input: unknown,
  generate = generateInterviewKit,
): Promise<{ version: "1.0"; generated_at: string; kits: CaseResult[]; failed_cases: boolean }> {
  if (!Array.isArray(input)) throw new Error("Input JSON must be an array of cases.");
  const kits: CaseResult[] = new Array(input.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < input.length) {
      const index = nextIndex;
      nextIndex += 1;
      const candidate: unknown = input[index];
      const parsed = batchCaseSchema.safeParse(candidate);
      const fallbackId = candidate && typeof candidate === "object" && "id" in candidate && typeof candidate.id === "string"
        ? candidate.id
        : `case-${index + 1}`;
      if (!parsed.success) {
        kits[index] = {
          id: fallbackId,
          status: "failed",
          kit: null,
          error: { code: "INVALID_CASE", message: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") },
        };
        continue;
      }
      const entry: BatchCase = parsed.data;
      try {
        const kit = await generate({ jd: entry.jd, company_url: entry.company_url, days: entry.days });
        kits[index] = { id: entry.id, status: "ok", kit, error: null };
      } catch (error) {
        kits[index] = {
          id: entry.id,
          status: "failed",
          kit: null,
          error: {
            code: "KIT_GENERATION_FAILED",
            message: error instanceof Error ? error.message : String(error),
          },
        };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(2, input.length) }, () => worker()));
  return {
    version: "1.0",
    generated_at: new Date().toISOString(),
    kits,
    failed_cases: kits.some((result) => result.status === "failed"),
  };
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { input: inputPath, output: outputPath } = parseArgs(argv);
  let input: unknown;
  try {
    input = JSON.parse(readFileSync(inputPath, "utf8"));
  } catch (error) {
    throw new Error(`Could not read valid JSON from ${inputPath}: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = await evaluateCases(input);
  mkdirSync(dirname(outputPath), { recursive: true });
  const temporaryPath = `${outputPath}.tmp`;
  writeFileSync(temporaryPath, JSON.stringify({ version: result.version, generated_at: result.generated_at, kits: result.kits }, null, 2), "utf8");
  renameSync(temporaryPath, outputPath);
  if (result.failed_cases) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
