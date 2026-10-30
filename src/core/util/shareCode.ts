/**
 * Short, human-shareable match code (6 chars).
 *
 * Alphabet excludes visually ambiguous characters (0/O, 1/I/L) so a code read
 * aloud across a pool table or typed from a scoreboard can't be mis-heard.
 * Zero-dependency & deterministic-length so it can be reused by a future
 * server / mini-program runtime without pulling in any platform API.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const SHARE_CODE_LENGTH = 6;

export function createShareCode(length = SHARE_CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

/** Loose validation helper for codes entered by hand. */
export function isValidShareCode(code: string): boolean {
  if (code.length !== SHARE_CODE_LENGTH) return false;
  for (const ch of code.toUpperCase()) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
