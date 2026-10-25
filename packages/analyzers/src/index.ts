export { analyzeFiles, type AnalysisOutput, type AnalyzedFile } from "./analyze.js";
export { countNonBlankLines, isBinary, isGenerated } from "./content.js";
export {
  DEFAULT_EXCLUDES,
  matchesAny,
  selectFiles,
  type Candidate,
  type Exclusion,
  type ExclusionReason,
  type Selection,
} from "./discovery.js";
export { DEFAULT_GRAPH_BUDGET, resolveSpecifier, transitiveFanIn, type FanInResult } from "./graph.js";
export { isJsLike, languageOf } from "./languages.js";
export { analyzeSource, type SourceAnalysis } from "./source.js";
