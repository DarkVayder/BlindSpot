const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const BIDI_CONTROLS = /[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g;
// eslint-disable-next-line no-control-regex -- matching control characters is the purpose
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

// Bidirectional overrides ("Trojan Source") make a path display differently from what it
// is, so they are shown as visible \u{...} escapes wherever text is rendered for people.
export function revealBidi(value: string): string {
  return value.replace(BIDI_CONTROLS, (c) => `\\u{${c.charCodeAt(0).toString(16)}}`);
}

// File names can contain escape sequences that recolor, rewrite or hyperlink a terminal
// (CSI, OSC 8), and newlines or tabs that make a path display as a different one. Every
// C0/C1 control character and DEL is shown as a visible \xNN escape instead.
function revealControls(value: string): string {
  return value.replace(CONTROL_CHARS, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

export function escapeHtml(value: string | number): string {
  return revealControls(revealBidi(String(value))).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

export function sanitizeTerminal(value: string): string {
  return revealControls(revealBidi(value));
}
