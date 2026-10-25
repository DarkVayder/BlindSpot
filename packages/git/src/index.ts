export { collectHistory, type HistoryResult } from "./analyze.js";
export { CatFileParser, readBlobs, type BlobHandler } from "./blobs.js";
export { HistoryCollector, identityHaystacks, missingHistory, type FileHistoryEvidence } from "./history.js";
export {
  LogParser,
  createSentinel,
  readLog,
  type CommitRecord,
  type FileChange,
  type Trailer,
} from "./log.js";
export {
  listTrackedFiles,
  openRepository,
  type Repository,
  type TrackedEntry,
  type TrackedKind,
} from "./repo.js";
export {
  GitError,
  MIN_GIT_VERSION,
  checkGitVersion,
  gitEnv,
  isSupportedVersion,
  parseGitVersion,
  resolveGitExecutable,
  type GitErrorCode,
} from "./runner.js";
