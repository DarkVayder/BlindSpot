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

export function escapeHtml(value: string | number): string {
  return revealBidi(String(value)).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

// File names and commit-derived text can contain escape sequences that recolor, rewrite
// or hyperlink the user's terminal (CSI, OSC 8). Every C0/C1 control character and DEL is
// shown as a visible \xNN escape instead of being passed through.
export function sanitizeTerminal(value: string): string {
  return revealBidi(value).replace(
    CONTROL_CHARS,
    (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`,
  );
}
