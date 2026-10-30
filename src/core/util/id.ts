/**
 * Zero-dependency id generation.
 * Format: `${prefix}_${time36}${rand36}` — collision-resistant enough for local-first use.
 */
export function createId(prefix = ''): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  const id = `${time}${rand}`;
  return prefix ? `${prefix}_${id}` : id;
}
