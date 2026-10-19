import type { InterviewKit } from "./kit-schema.js";

export function questionMinutes(difficulty: number): number {
  return 15 + difficulty * 10;
}

/**
 * Brings the derived parts of a kit (coverage, schedule membership, minutes) back in line with
 * the questions after a user edit, so adding or deleting a question never leaves dangling ids.
 */
export function reconcileKit(input: InterviewKit): InterviewKit {
  const kit = structuredClone(input);
  const byId = new Map(kit.questions.map((question) => [question.id, question]));
  const covered = new Set(kit.questions.flatMap((question) => question.requirement_ids));
  kit.coverage.uncovered_requirement_ids = kit.role.requirements.filter((item) => !covered.has(item.id)).map((item) => item.id);

  for (const day of kit.schedule.days) day.question_ids = day.question_ids.filter((id) => byId.has(id));
  const scheduled = new Set(kit.schedule.days.flatMap((day) => day.question_ids));
  for (const question of kit.questions) {
    if (scheduled.has(question.id) || kit.schedule.days.length === 0) continue;
    const lightest = kit.schedule.days.reduce((best, day) => (day.question_ids.length < best.question_ids.length ? day : best));
    lightest.question_ids.push(question.id);
  }
  for (const day of kit.schedule.days) {
    day.minutes = day.question_ids.reduce((sum, id) => sum + questionMinutes(byId.get(id)?.difficulty ?? 1), 0);
  }
  return kit;
}

/** Marks questions and flashcards the user changed or added so a regeneration can leave them alone. */
export function applyProvenance(previous: InterviewKit, next: InterviewKit): InterviewKit {
  const kit = structuredClone(next);
  const oldQuestions = new Map(previous.questions.map((question) => [question.id, question]));
  for (const question of kit.questions) {
    const old = oldQuestions.get(question.id);
    if (!old) question.origin = question.origin ?? "manual";
    else if (old.prompt !== question.prompt || old.answer_outline !== question.answer_outline || old.category !== question.category) {
      question.origin = old.origin === "manual" ? "manual" : "edited";
    } else question.origin = old.origin ?? question.origin;
  }
  const oldCards = new Map(previous.flashcards.map((card) => [card.id, card]));
  for (const card of kit.flashcards) {
    const old = oldCards.get(card.id);
    if (!old) card.origin = card.origin ?? "manual";
    else if (old.front !== card.front || old.back !== card.back) card.origin = old.origin === "manual" ? "manual" : "edited";
    else card.origin = old.origin ?? card.origin;
  }
  return kit;
}

export function isProtected(item: { origin?: string; pinned?: boolean }): boolean {
  return item.pinned === true || item.origin === "edited" || item.origin === "manual";
}
