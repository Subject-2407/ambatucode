/**
 * The browser half of assessment timing.
 *
 * The server owns the deadline; this file owns nothing but its presentation.
 * Every function here is pure so the rules can be checked without a DOM, and
 * so the one genuinely dangerous idea — that the local clock knows what time
 * it is — has a single place to be wrong in.
 *
 * A lab machine's clock can be minutes off, and on an offline network there is
 * often no NTP to correct it. `deadlineMs` is therefore meaningless on its own:
 * it is only comparable to `Date.now()` after subtracting the measured skew.
 */

/** Below this the countdown reads as a warning. */
export const TIMER_WARNING_MS = 5 * 60_000;
/** Below this it reads as danger. No sound, ever — this is an exam room. */
export const TIMER_DANGER_MS = 60_000;

export type TimerTier = "normal" | "warning" | "danger" | "expired";

/**
 * How far ahead of us the server's clock runs, in milliseconds.
 *
 * Measured at the instant a payload carrying `serverTimeMs` arrives, so the
 * only error is the one-way network delay — which makes the browser show
 * slightly *less* time than the server will grant, never more. Erring toward
 * the Coder having less time on screen than they really have is the safe
 * direction: the server is the one that decides, and a countdown that ran a
 * beat fast never costs anyone work.
 */
export function measureSkew(serverTimeMs: number, receivedAtMs: number = Date.now()): number {
  return serverTimeMs - receivedAtMs;
}

/** Milliseconds left on a server deadline, corrected for skew. Never negative. */
export function remainingFrom(
  deadlineMs: number,
  skewMs: number,
  nowMs: number = Date.now(),
): number {
  return Math.max(0, deadlineMs - (nowMs + skewMs));
}

export function timerTier(remainingMs: number): TimerTier {
  if (remainingMs <= 0) return "expired";
  if (remainingMs <= TIMER_DANGER_MS) return "danger";
  if (remainingMs <= TIMER_WARNING_MS) return "warning";
  return "normal";
}

/**
 * `MM:SS`, widening to `H:MM:SS` only once there is an hour to show.
 *
 * Rounded up rather than down: a display reading `0:00` while the server still
 * accepts a submission tells the Coder they have missed a deadline they have
 * not missed. The last second is shown as `0:01` and the zero appears when the
 * time is genuinely gone.
 */
export function formatRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);

  const mm = String(minutes).padStart(2, "0");
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${String(hours)}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** The same duration as words, for the `aria-live` region. */
export function describeRemaining(remainingMs: number): string {
  const totalSeconds = Math.ceil(Math.max(0, remainingMs) / 1000);
  if (totalSeconds === 0) return "Time is up";

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${String(seconds)} seconds remaining`;
  if (seconds === 0) return `${String(minutes)} minutes remaining`;
  return `${String(minutes)} minutes ${String(seconds)} seconds remaining`;
}

/**
 * Which announcements the timer has already made.
 *
 * Escalation must be announced once, not on every frame. Keeping the decision
 * pure means the component only has to remember which tiers it has passed.
 */
export function shouldAnnounceTier(tier: TimerTier, announced: readonly TimerTier[]): boolean {
  if (tier === "normal" || tier === "expired") return false;
  return !announced.includes(tier);
}
