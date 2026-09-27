// When should we interrupt someone?
//
// Pure functions, deliberately separate from the browser API, because this is
// the safety-critical half: the decision to buzz a fisherman's phone. It is
// unit-tested without a browser.
//
// The rule that matters most: an all-clear notification may ONLY follow a
// confirmed LOW verdict. "We could not check" must never be delivered as "you
// are safe" — a phone that says all-clear because the warning service broke is
// worse than a phone that says nothing.

const RANK = { MODERATE: 1, HIGH: 2, CRITICAL: 3 };

/** The confirmed hazard level of a verdict, or null when there is none. */
export function hazardOf(verdict) {
  if (!verdict || !verdict.confirmed) return null;
  const level = String(verdict.level || '').toUpperCase();
  return RANK[level] ? level : null;
}

function facts(verdict, district) {
  return {
    level: String(verdict.level || '').toUpperCase(),
    severity: verdict.severity || null,
    hazard: verdict.hazard || null,
    district,
  };
}

/**
 * What (if anything) to tell the user about the move from `prev` to `next`.
 *
 * Returns null, or one of:
 *   { kind: 'start' | 'escalate' | 'clear', ... }
 *
 * `prev` may be null on the first verdict we ever see. We deliberately do NOT
 * notify on that first sighting: a user opening the app must not be buzzed
 * about a warning that was already showing on screen. Notifications are for
 * CHANGES.
 */
export function transition(prev, next, district = '') {
  const was = hazardOf(prev);
  const now = hazardOf(next);

  // First ever verdict: nothing changed, so nothing to announce.
  if (!prev) return null;

  if (!was && now) return { kind: 'start', ...facts(next, district) };

  if (was && now && RANK[now] > RANK[was]) {
    return { kind: 'escalate', ...facts(next, district) };
  }

  if (was && !now) {
    // Only a confirmed LOW is an all-clear. UNKNOWN / unavailable means we could
    // not check, which is not the same statement and must stay silent.
    const confirmedLow = next && next.confirmed && String(next.level || '').toUpperCase() === 'LOW';
    if (confirmedLow) return { kind: 'clear', district };
    return null;
  }

  return null;
}

/** Stable per event, so the same warning is announced once and not on every poll. */
export function tagFor(change) {
  if (!change) return '';
  if (change.kind === 'clear') return `clear:${change.district}`;
  return `${change.kind}:${change.district}:${change.severity || change.level}`;
}
