// Persistence for cooldown memory. Kept in the agent dir (not session state) so
// a 5-hour subscription quota block survives pi restarts and applies to every
// project. All failures are non-fatal: a broken store degrades to "nothing is
// cooling", never to a broken turn.
import { existsSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { EMPTY_COOLDOWN_STATE, pruneExpired } from "./cooldown";
import type { CooldownEntry, CooldownReason, CooldownState } from "./types";

export const COOLDOWN_FILE = "router-cooldowns.json";

export const cooldownPath = (agentDir: string): string =>
	join(agentDir, COOLDOWN_FILE);

const REASONS: readonly CooldownReason[] = [
	"quota",
	"rate-limit",
	"auth",
	"server",
	"hang",
	"manual",
];

const parseEntry = (key: string, value: unknown): CooldownEntry | undefined => {
	if (typeof value !== "object" || value === null) return undefined;
	const raw = value as Record<string, unknown>;
	const until = raw.until;
	const provider = raw.provider;
	const reason = raw.reason;
	const scope = raw.scope;
	if (typeof until !== "number" || typeof provider !== "string")
		return undefined;
	if (
		typeof reason !== "string" ||
		!REASONS.includes(reason as CooldownReason)
	) {
		return undefined;
	}
	if (scope !== "provider" && scope !== "model") return undefined;

	return {
		key,
		scope,
		provider,
		...(typeof raw.model === "string" ? { model: raw.model } : {}),
		reason: reason as CooldownReason,
		since: typeof raw.since === "number" ? raw.since : until,
		until,
	};
};

export const parseCooldownState = (text: string): CooldownState => {
	try {
		const parsed = JSON.parse(text) as unknown;
		if (typeof parsed !== "object" || parsed === null) {
			return EMPTY_COOLDOWN_STATE;
		}
		const rawEntries = (parsed as { entries?: unknown }).entries;
		if (typeof rawEntries !== "object" || rawEntries === null) {
			return EMPTY_COOLDOWN_STATE;
		}

		const entries: Record<string, CooldownEntry> = {};
		for (const [key, value] of Object.entries(
			rawEntries as Record<string, unknown>,
		)) {
			const entry = parseEntry(key, value);
			if (entry) entries[key] = entry;
		}
		return { entries };
	} catch {
		return EMPTY_COOLDOWN_STATE;
	}
};

export const loadCooldowns = (agentDir: string, now: number): CooldownState => {
	const path = cooldownPath(agentDir);
	if (!existsSync(path)) return EMPTY_COOLDOWN_STATE;
	try {
		return pruneExpired(parseCooldownState(readFileSync(path, "utf-8")), now);
	} catch {
		return EMPTY_COOLDOWN_STATE;
	}
};

export const saveCooldowns = (
	agentDir: string,
	state: CooldownState,
	now: number,
): void => {
	const path = cooldownPath(agentDir);
	try {
		const pruned = pruneExpired(state, now);
		const tmp = `${path}.tmp`;
		writeFileSync(tmp, `${JSON.stringify(pruned, null, 2)}\n`);
		renameSync(tmp, path);
	} catch {
		// Non-fatal: cooldowns degrade to in-memory only for this session.
	}
};
