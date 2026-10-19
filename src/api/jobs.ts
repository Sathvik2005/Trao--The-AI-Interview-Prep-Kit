import { randomUUID } from "node:crypto";
import type { InterviewKit } from "../domain/kit-schema.js";
import type { GenerateKitInput, ProgressEvent } from "../pipeline/generate-kit.js";
import type { DatabaseStore, SavedKit } from "./store.js";

export interface JobStep {
  step: string;
  label: string;
  status: ProgressEvent["status"];
  detail?: string;
}

export interface GenerationJob {
  id: string;
  status: "running" | "done" | "failed";
  input_hash: string;
  steps: JobStep[];
  kit_id?: string;
  error?: { code: string; message: string };
  created_at: string;
  updated_at: string;
}

interface StoredJob extends GenerationJob {
  user_id: string;
}

const JOB_TTL_MS = 60 * 60 * 1000;
const MAX_RUNNING_PER_USER = 2;

export type KitGenerator = (input: GenerateKitInput, onProgress: (event: ProgressEvent) => void) => Promise<InterviewKit>;

/**
 * Tracks long-running generations so the request returns immediately and the client can poll
 * progress. Jobs live in process memory; the finished kit is persisted to the database, so a
 * restart only loses the progress view of a run that was in flight.
 */
export class JobRegistry {
  private readonly jobs = new Map<string, StoredJob>();

  constructor(private readonly store: DatabaseStore, private readonly generate: KitGenerator) {}

  find(userId: string, id: string): GenerationJob | null {
    this.sweep();
    const job = this.jobs.get(id);
    return job && job.user_id === userId ? this.publicJob(job) : null;
  }

  findRunningByHash(userId: string, hash: string): GenerationJob | null {
    for (const job of this.jobs.values()) {
      if (job.user_id === userId && job.status === "running" && job.input_hash === hash) return this.publicJob(job);
    }
    return null;
  }

  runningCount(userId: string): number {
    return [...this.jobs.values()].filter((job) => job.user_id === userId && job.status === "running").length;
  }

  canStart(userId: string): boolean {
    return this.runningCount(userId) < MAX_RUNNING_PER_USER;
  }

  start(userId: string, input: GenerateKitInput, hash: string): GenerationJob {
    const now = new Date().toISOString();
    const job: StoredJob = { id: randomUUID(), user_id: userId, status: "running", input_hash: hash, steps: [], created_at: now, updated_at: now };
    this.jobs.set(job.id, job);
    void this.run(job, input);
    return this.publicJob(job);
  }

  private async run(job: StoredJob, input: GenerateKitInput): Promise<void> {
    try {
      const kit = await this.generate(input, (event) => this.record(job, event));
      kit.source.input_hash = job.input_hash;
      const saved: SavedKit = await this.store.createKit(job.user_id, kit);
      job.kit_id = saved.id;
      job.status = "done";
    } catch (error) {
      console.error("Kit generation failed:", error instanceof Error ? error.message : "Unknown error");
      job.status = "failed";
      job.error = { code: "GENERATION_FAILED", message: "The kit could not be generated. The model provider may be busy; please try again in a minute." };
    }
    job.updated_at = new Date().toISOString();
  }

  private record(job: StoredJob, event: ProgressEvent): void {
    const existing = job.steps.find((step) => step.step === event.step);
    if (existing) Object.assign(existing, event);
    else job.steps.push({ ...event });
    job.updated_at = new Date().toISOString();
  }

  private publicJob(job: StoredJob): GenerationJob {
    const { user_id: _userId, ...rest } = job;
    return structuredClone(rest);
  }

  private sweep(): void {
    const cutoff = Date.now() - JOB_TTL_MS;
    for (const [id, job] of this.jobs) {
      if (job.status !== "running" && Date.parse(job.updated_at) < cutoff) this.jobs.delete(id);
    }
  }
}
