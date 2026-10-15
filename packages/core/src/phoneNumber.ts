// Philippine mobile numbers only. This module must stay import-free: the
// Supabase Edge Functions import it directly by relative path (Deno needs
// explicit .ts extensions there, which the other packages don't use).

const PH_MOBILE_E164 = /^\+639\d{9}$/;

export function isPhMobileE164(value: string): boolean {
  return PH_MOBILE_E164.test(value);
}

/**
 * Normalizes the ways people type a Philippine mobile number into
 * `+639XXXXXXXXX`. Returns null for anything else — other countries,
 * landlines, wrong lengths, stray characters.
 */
export function normalizePhPhoneNumber(input: string): string | null {
  const stripped = input.trim().replace(/[\s\-().]/g, '');

  let nationalNumber: string;
  if (/^\+639\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(3);
  } else if (/^639\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(2);
  } else if (/^09\d{9}$/.test(stripped)) {
    nationalNumber = stripped.slice(1);
  } else if (/^9\d{9}$/.test(stripped)) {
    nationalNumber = stripped;
  } else {
    return null;
  }

  return `+63${nationalNumber}`;
}
