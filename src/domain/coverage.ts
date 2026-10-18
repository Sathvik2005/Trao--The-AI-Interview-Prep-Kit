import type { Requirement } from "./requirements.js";

export interface RequirementQuestionReference {
  requirement_ids: readonly string[];
}

export interface CoverageResult {
  uncovered_requirement_ids: string[];
}

export function analyzeCoverage(
  requirements: Requirement[],
  questions: RequirementQuestionReference[],
): CoverageResult {
  const coveredIds = new Set(questions.flatMap((question) => question.requirement_ids));
  return {
    uncovered_requirement_ids: requirements
      .filter((requirement) => !coveredIds.has(requirement.id))
      .map((requirement) => requirement.id),
  };
}