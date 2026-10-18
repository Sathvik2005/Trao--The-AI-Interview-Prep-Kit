import type { Requirement } from "./requirements.js";
import { analyzeCoverage } from "./coverage.js";

export interface SchedulableQuestion {
  id: string;
  requirement_ids: readonly string[];
  category: "technical" | "behavioural" | "system-design" | "company-fit";
  difficulty: number;
}

export interface ScheduleDay {
  day: number;
  focus: string;
  question_ids: string[];
  minutes: number;
}

export interface StudySchedule {
  days_available: number;
  days: ScheduleDay[];
}

const CATEGORY_LABELS: Record<SchedulableQuestion["category"], string> = {
  technical: "Technical practice",
  behavioural: "Behavioural practice",
  "system-design": "System design",
  "company-fit": "Company fit",
};

export function createSchedule(
  requirements: Requirement[],
  questions: SchedulableQuestion[],
  daysAvailable: number,
): StudySchedule {
  if (!Number.isSafeInteger(daysAvailable) || daysAvailable < 1) {
    throw new Error("daysAvailable must be a positive integer.");
  }

  const uncoveredMust = requirements.filter(
    (requirement) => requirement.priority === "must" && analyzeCoverage([requirement], questions).uncovered_requirement_ids.length > 0,
  );
  if (uncoveredMust.length > 0) {
    throw new Error(`Cannot schedule uncovered must-have requirements: ${uncoveredMust.map((item) => item.id).join(", ")}`);
  }

  const mustHaveIds = new Set(requirements.filter((requirement) => requirement.priority === "must").map((item) => item.id));
  const scoredQuestions = questions
    .map((question) => ({
      question,
      mustHave: question.requirement_ids.some((id) => mustHaveIds.has(id)),
    }))
    .sort((left, right) => {
      const priorityDifference = Number(right.mustHave) - Number(left.mustHave);
      return priorityDifference || right.question.difficulty - left.question.difficulty || left.question.id.localeCompare(right.question.id);
    });

  const assignments = Array.from({ length: daysAvailable }, () => [] as SchedulableQuestion[]);
  scoredQuestions.forEach(({ question }, index) => {
    const dayIndex = Math.min(daysAvailable - 1, Math.floor((index * daysAvailable) / Math.max(scoredQuestions.length, 1)));
    assignments[dayIndex].push(question);
  });

  return {
    days_available: daysAvailable,
    days: assignments.map((dayQuestions, index) => {
      const categories = [...new Set(dayQuestions.map((question) => CATEGORY_LABELS[question.category]))];
      return {
        day: index + 1,
        focus: categories.length > 0 ? categories.join(" and ") : "Review company and role context",
        question_ids: dayQuestions.map((question) => question.id),
        minutes: dayQuestions.reduce((sum, question) => sum + 15 + question.difficulty * 10, 0),
      };
    }),
  };
}