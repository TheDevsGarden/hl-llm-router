import type { CooldownReason } from "../types";
import { UNIT_MS } from "./duration";
import { HangError } from "../delegate/hang-guard";

const QUOTA_HINTS = [
	"quota",
	"insufficient",
	"credit",
	"billing",
	"payment required",
	"exceeded your",
	"daily limit",
	"usage limit",
	"plan limit",
	"out of tokens",
	"upgrade to continue",
];

const RATE_HINTS = [
	"rate limit",
	"rate-limit",
	"ratelimit",
	"too many requests",
	"slow down",
];

const AUTH_HINTS = [
	"unauthorized",
	"invalid api key",
	"no api key",
	"auth failed",
	"authentication",
	"forbidden",
];

/**
 * Transport-level failures: the endpoint never produced a usable response.
 * Deliberately excludes 'abort' — a user pressing Esc must never cool a model.
 */
const CONNECTIVITY_HINTS = [
	"timed out",
	"timeout",
	"etimedout",
	"econnreset",
	"econnrefused",
	"enotfound",
	"eai_again",
	"socket hang up",
	"fetch failed",
	"network socket disconnected",
];

const SERVER_HINTS = [
	"internal server error",
	"bad gateway",
	"service unavailable",
	"gateway timeout",
	"overloaded",
];

// Stream hung: the provider accepted the request but never emitted body bytes
// within the hang-guard budget. Not a connectivity error — the provider was
// reachable, it just produced no output. This is the signature of a model
// that is over capacity, out of memory, or pathologically slow on this
// workload. Cooling prevents the next turn from waiting the full budget again.
const HANG_HINTS = [
	"stream hung: pre-stream timeout",
	"stream hung: initial-idle timeout",
	"stream hung: inter-event timeout",
];

const statusOf = (error: unknown): number | undefined => {
	if (typeof error !== "object" || error === null) return undefined;
	const record = error as Record<string, unknown>;
	for (const key of ["status", "statusCode", "code"]) {
		const value = record[key];
		if (typeof value === "number" && value >= 100 && value < 600) return value;
		if (typeof value === "string" && /^\d{3}$/.test(value))
			return Number(value);
	}
	return undefined;
};

const textOf = (error: unknown): string => {
	if (error instanceof Error) return error.message.toLowerCase();
	if (typeof error === "string") return error.toLowerCase();
	if (typeof error === "object" && error !== null) {
		const message = (error as { message?: unknown }).message;
		if (typeof message === "string") return message.toLowerCase();
	}
	return "";
};

const includesAny = (text: string, hints: string[]): boolean =>
	hints.some((hint) => text.includes(hint));

/**
 * Decide whether a failure is worth cooling down for, and why.
 * Quota is checked before rate limit: a 429 that says "daily limit" is an
 * exhausted plan, not a per-minute throttle, and deserves the longer window.
 * Returns undefined for failures a retry could plausibly fix (unknown model,
 * malformed request, transient socket errors).
 *
 * HangError is surfaced directly — it is a first-class cooldown reason.
 */
export const classifyFailure = (error: unknown): CooldownReason | undefined => {
	if (error instanceof HangError) return "hang";
	const status = statusOf(error);
	const text = textOf(error);

	if (status === 402 || includesAny(text, QUOTA_HINTS)) return "quota";
	if (status === 429 || includesAny(text, RATE_HINTS)) return "rate-limit";
	if (status === 401 || status === 403 || includesAny(text, AUTH_HINTS)) {
		return "auth";
	}
	if (
		(status !== undefined && status >= 500) ||
		includesAny(text, SERVER_HINTS)
	) {
		return "server";
	}
	// A hang or refused connection must cool, or an unreachable endpoint is
	// retried on every single turn forever. Free-pool candidates are quality-
	// sorted, so a dead provider with cost 0 sits at the TOP of every chain and
	// burns the full idle timeout before anything else is tried.
	if (includesAny(text, CONNECTIVITY_HINTS)) return "server";
	return undefined;
};

/**
 * True when the failure is transport-level rather than model-level.
 * The caller widens such a cooldown to provider scope: an unreachable host is
 * a property of the endpoint, not of one model behind it, and cooling models
 * one at a time means eating one full timeout per model.
 */
export const isConnectivityFailure = (error: unknown): boolean =>
	includesAny(textOf(error), CONNECTIVITY_HINTS);

const RETRY_PATTERNS: readonly RegExp[] = [
	/retry[- ]after[":\s]+(\d+(?:\.\d+)?)\s*(ms|s|m|h)?\b/i,
	/try again in\s+(\d+(?:\.\d+)?)\s*(ms|s|m|h|seconds?|minutes?|hours?)/i,
	/(?:resets?|available again)\s+in\s+(\d+(?:\.\d+)?)\s*(ms|s|m|h|seconds?|minutes?|hours?)/i,
];

const UNIT_ALIASES: Record<string, string> = {
	second: "s",
	seconds: "s",
	minute: "m",
	minutes: "m",
	hour: "h",
	hours: "h",
};

/** Hard ceiling on a server-advertised wait, so a bogus header can't park a provider for a week. */
export const MAX_ADVERTISED_WAIT_MS = 6 * 3_600_000;

/**
 * Extract a wait hint the provider itself advertised (retry-after header text,
 * "try again in 42s", "resets in 3 minutes"). Bare numbers are read as seconds,
 * matching the retry-after convention. Returns undefined when the provider said
 * nothing — the caller then falls back to the configured window.
 */
export const advertisedWaitMs = (error: unknown): number | undefined => {
	const text = textOf(error);
	if (!text) return undefined;

	for (const pattern of RETRY_PATTERNS) {
		const match = pattern.exec(text);
		if (!match) continue;
		const amount = Number(match[1]);
		if (!Number.isFinite(amount) || amount < 0) continue;
		const rawUnit = (match[2] ?? "s").toLowerCase();
		const unit = UNIT_ALIASES[rawUnit] ?? rawUnit;
		const ms = amount * (UNIT_MS[unit] ?? 1_000);
		if (ms <= 0) continue;
		return Math.min(ms, MAX_ADVERTISED_WAIT_MS);
	}
	return undefined;
};
