/**
 * UptimePulse runs as a single-operator product: one creator account owns the
 * application, and the site owners it watches never hold a login — they read a
 * public analysis page. Everything authenticated therefore resolves to this
 * one address, and the guard is enforced server-side rather than by hiding
 * links in the client.
 */
const DEFAULT_OWNER_EMAIL = "rajaomanjatoventso@gmail.com";

/** Same normalisation as `emailSchema`, so a stored address is comparable. */
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export const OWNER_EMAIL = normalizeEmail(
  process.env.UPTIMEPULSE_OWNER_EMAIL?.trim() || DEFAULT_OWNER_EMAIL
);

export function isOwnerEmail(email: string | null | undefined): boolean {
  return !!email && normalizeEmail(email) === OWNER_EMAIL;
}
