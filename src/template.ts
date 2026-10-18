const VARIABLE = /\$\{(\w+)\}/g;
const DANGLING = /^[\s·•|:–—-]+|[\s·•|:–—-]+$/g;

/**
 * Replaces `${name}` with its value; unknown names become empty. When a value
 * is empty, separators left dangling at the edges (`·`, `|`, `-`, …) are dropped.
 */
export function render(template: string, vars: Record<string, string | undefined>): string {
  let missing = false;
  const out = template.replace(VARIABLE, (_, name: string) => {
    const value = vars[name] ?? '';
    missing ||= value === '';
    return value;
  });
  return (missing ? out.replace(DANGLING, '') : out).trim();
}

export function variablesIn(template: string): string[] {
  return [...template.matchAll(VARIABLE)].map((m) => m[1]);
}

/** Joins icon and text with a single space, skipping empty parts. */
export function label(icon: string, text: string): string {
  return [icon.trim(), text.trim()].filter(Boolean).join(' ');
}
