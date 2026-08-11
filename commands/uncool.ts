import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { loadCooldowns, saveCooldowns } from "../cooldown-store";
import { logRouterEvent } from "../cooldown/logger";
import type { CommandContext } from "./types";

/**
 * Manually remove a cooldown entry so the router may try the model again.
 *
 * Usage: /router uncool <model>
 *   model — canonical ref (provider/model, e.g. "opencode-go/mimo-v2.5")
 *
 * If the model is not currently cooling, this is a no-op.
 */
export const handleUncool = async (
	cctx: CommandContext,
	subArgs: string[],
	ctx: ExtensionContext,
): Promise<void> => {
	if (subArgs.length < 1) {
		ctx.ui.notify(
			"Usage: /router uncool <model>\n" +
				"  Example: /router uncool opencode-go/mimo-v2.5",
			"error",
		);
		return;
	}

	const modelRef = subArgs[0];

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
	const state = loadCooldowns(dir, now);

	if (!state.entries[modelRef]) {
		ctx.ui.notify(`${modelRef} is not cooling. Nothing to do.`, "info");
		return;
	}

	const next = { ...state };
	delete next.entries[modelRef];
	saveCooldowns(dir, next, now);

	logRouterEvent({
		type: "manual-uncool",
		timestamp: now,
		canonicalId: modelRef,
	});

	ctx.ui.notify(
		`Removed cooldown for ${modelRef}. It will be tried again on the next eligible turn.`,
		"info",
	);
};
