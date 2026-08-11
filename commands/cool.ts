import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadCooldowns, saveCooldowns } from "../cooldown-store";
import { markCooling } from "../cooldown";
import { logRouterEvent } from "../cooldown/logger";
import type { CommandContext } from "./types";

/**
 * Manually cool a model so the router skips it for the specified duration.
 *
 * Usage: /router cool <model> <duration> [reason]
 *   model     — canonical ref (provider/model, e.g. "opencode-go/mimo-v2.5")
 *   duration  — human readable: "30s", "5m", "1h", "24h"
 *   reason    — optional note (e.g. "keeps hanging on reasoning prompts")
 */
export const handleCool = async (
	cctx: CommandContext,
	subArgs: string[],
	ctx: ExtensionContext,
): Promise<void> => {
	if (subArgs.length < 2) {
		ctx.ui.notify(
			"Usage: /router cool <model> <duration> [reason]\n" +
				'  Example: /router cool opencode-go/mimo-v2.5 1h "hangs on reasoning"',
			"error",
		);
		return;
	}

	const modelRef = subArgs[0];
	const durationArg = subArgs[1];
	const reasonText = subArgs.slice(2).join(" ") || "manually cooled by user";

	// Parse duration
	const durationMs = parseDurationToMs(durationArg);
	if (durationMs === undefined || durationMs <= 0) {
		ctx.ui.notify(
			`Invalid duration: "${durationArg}". Use 30s, 5m, 1h, 24h, etc.`,
			"error",
		);
		return;
	}

	// Validate model ref format
	if (!modelRef.includes("/")) {
		ctx.ui.notify(
			`Invalid model reference: "${modelRef}". Expected "provider/model"`,
			"error",
		);
		return;
	}

	const dir = getAgentDir();
	const now = Date.now();
	let state = loadCooldowns(dir, now);

	state = markCooling(state, {
		provider: modelRef.split("/")[0],
		modelId: modelRef.split("/").slice(1).join("/"),
		reason: "manual",
		rule: {
			scope: "model",
			rateLimit: durationMs,
			quota: durationMs,
			auth: durationMs,
			server: durationMs,
		},
		now,
		advertisedMs: durationMs,
	});

	saveCooldowns(dir, state, now);

	logRouterEvent({
		type: "manual-cool",
		timestamp: now,
		canonicalId: modelRef,
		durationMs,
		userReason: reasonText,
	});

	ctx.ui.notify(
		`Cooled ${modelRef} for ${durationArg} (${reasonText})`,
		"info",
	);
};

function parseDurationToMs(arg: string): number | undefined {
	const match = arg.match(/^(\d+(?:\.\d+)?)\s*([smhdw])?$/i);
	if (!match) return undefined;
	const n = parseFloat(match[1]);
	const unit = (match[2] || "s").toLowerCase();
	switch (unit) {
		case "s":
			return n * 1_000;
		case "m":
			return n * 60_000;
		case "h":
			return n * 3_600_000;
		case "d":
			return n * 86_400_000;
		case "w":
			return n * 604_800_000;
		default:
			return undefined;
	}
}
