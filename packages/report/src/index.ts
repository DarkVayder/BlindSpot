export { escapeHtml, revealBidi, sanitizeTerminal } from "./escape.js";
export { DEFAULT_HTML_MAX_FILES, REPORT_CSP, THEME, renderHtml, type HtmlOptions } from "./html.js";
export { parseReportJson, renderJson, reportJsonSchema, type ParsedReport } from "./json.js";
export { BAND_LABEL, BAND_ORDER, bandCounts, isRanked, rankFiles } from "./order.js";
export {
  renderComparison,
  renderTerminal,
  truncateMiddle,
  type ComparisonOptions,
  type TerminalOptions,
} from "./terminal.js";
