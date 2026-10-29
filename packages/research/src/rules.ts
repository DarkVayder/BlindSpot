// The labelling rules registered in docs/research-protocol.md §3. Changing a rule means a
// new rule version and an amendment in §9, never an edit to an existing version.

export const BUGFIX_RULE = "bugfix@1";
export const REVERT_RULE = "revert@1";
export const MAX_FILES_FOR_BUGFIX = 20;

const FIX_TERMS = /\b(fix|fixes|fixed|fixing|bugfix|hotfix|bug|regression|crash|broken)\b/i;
const EXCLUDED_TYPES = /^(docs|test|style|ci|build|chore|release)(\([^)]*\))?!?:/i;
const EXCLUDED_SUBJECT_TERMS = /\b(typo|lint)\b/i;
const REVERT_SUBJECT = /^Revert "/;
const REVERT_BODY = /\bThis reverts commit [0-9a-f]{7,64}\b/;

export type BugfixVerdict =
  "bugfix" | "no_fix_terms" | "excluded_type" | "excluded_subject" | "too_many_files";

export interface CommitForRules {
  message: string;
  changedFiles: number;
}

function split(message: string): { subject: string; body: string } {
  const newline = message.indexOf("\n");
  return newline < 0
    ? { subject: message.trim(), body: "" }
    : { subject: message.slice(0, newline).trim(), body: message.slice(newline + 1) };
}

export function classifyBugfix(commit: CommitForRules): BugfixVerdict {
  const { subject } = split(commit.message);
  if (!FIX_TERMS.test(commit.message)) return "no_fix_terms";
  if (EXCLUDED_TYPES.test(subject)) return "excluded_type";
  if (EXCLUDED_SUBJECT_TERMS.test(subject)) return "excluded_subject";
  if (commit.changedFiles > MAX_FILES_FOR_BUGFIX) return "too_many_files";
  return "bugfix";
}

export function isRevert(message: string): boolean {
  const { subject, body } = split(message);
  return REVERT_SUBJECT.test(subject) || REVERT_BODY.test(body);
}
