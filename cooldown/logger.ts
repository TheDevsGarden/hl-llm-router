import {
	appendFileSync,
	existsSync,
	mkdirSync,
	renameSync,
	statSync,
} from "node:fs";
import { dirname } from "node:path";
import { homedir } from "node:os";

/**
 * Diagnostic logging for the router — append-only JSON Lines.
 *
 * Each event is a single JSON object on one line. The file auto-rotates at
 * 10 MB. No async I/O: appendFileSync is fast enough for this rate (a few
 * events per turn) and avoids the complexity of a background writer.
 *
 * Events:
 *   { type: 'hang', timestamp, canonicalId, timeoutMs }
 *   { type: 'cooldown', timestamp, canonicalId, reason, until, trigger }
 *   { type: 'manual-cool', timestamp, canonicalId, durationMs, userReason }
 *   { type: 'manual-uncool', timestamp, canonicalId }
 *
 * API keys are scrubbed before writing: any string matching the `sk-...`
 * pattern is replaced with `sk-REDACTED`.
 */

const LOG_DIR = `${homedir()}/.pi/agent/logs`;
const LOG_PATH = `${LOG_DIR}/router.log`;
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB
const ROTATE_PATH = `${LOG_PATH}.old`;

const ensureDir = (): void => {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true });
	}
};

const scrub = (text: string): string => {
	// OpenRouter: sk-or-v1-...
	// OpenAI: sk-...
	// Cohere: sk-...
	// Anthropic: sk-ant-...
	// Google: sk-...
	// Any 20+ alphanumeric chars after sk-
	return text.replace(
		/sk-[a-z0-9-_]{20,}/gi,
		(m) => `${m.slice(0, 7)}REDACTED`,
	);
};

const rotateIfNeeded = (): void => {
	if (!existsSync(LOG_PATH)) return;
	try {
		if (statSync(LOG_PATH).size > MAX_SIZE) {
			if (existsSync(ROTATE_PATH)) {
				// Already rotated once — drop the oldest
			}
			renameSync(LOG_PATH, ROTATE_PATH);
		}
	} catch {
		// Best-effort rotation. Failure is non-fatal.
	}
};

export interface RouterLogEvent {
	type: "hang" | "cooldown" | "manual-cool" | "manual-uncool";
	timestamp: number;
	canonicalId: string;
	[key: string]: unknown;
}

export const logRouterEvent = (event: RouterLogEvent): void => {
	try {
		ensureDir();
		rotateIfNeeded();
		const line = scrub(JSON.stringify(event)) + "\n";
		appendFileSync(LOG_PATH, line, "utf8");
	} catch {
		// Logging is best-effort. A full disk is not a reason to fail a turn.
	}
};
