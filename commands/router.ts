import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { CommandContext } from "./types";
import { handleStatus } from "./status";
import { handleCompact } from "./compact";
import { handleProfile } from "./profile";
import { handlePin } from "./pin";
import { handleThinking } from "./thinking";
import { handleDisable } from "./disable";
import { handleProvider } from "./provider";
import { handleFix } from "./fix";
import { handleWidget } from "./widget";
import { handleDebug } from "./debug";
import { handleReload } from "./reload";
import { handleCooldowns } from "./cooldowns";
import { handleMorphTools } from "./morphtools";
import { handleContextOverride } from "./context-override";
import { handleHelp } from "./help";
import { handleCool } from "./cool";
import { handleUncool } from "./uncool";

/** The /router dispatch switch. Extracted so each subcommand lives in its own file. */
export const dispatch = async (
	cctx: CommandContext,
	args: string | undefined,
	ctx: ExtensionContext,
): Promise<void> => {
	const { state, actions } = cctx;
	const parts = args?.trim().split(/\s+/) ?? [];
	const subcommand = parts[0];
	const subArgs = parts.slice(1);

	switch (subcommand) {
		case "profile":
			await handleProfile(cctx, subArgs, ctx);
			break;
		case "pin":
			await handlePin(cctx, subArgs, ctx);
			break;
		case "thinking":
			await handleThinking(cctx, subArgs, ctx);
			break;
		case "disable":
			await handleDisable(cctx, subArgs, ctx);
			break;
		case "provider":
			await handleProvider(cctx, subArgs, ctx);
			break;
		case "fix":
			await handleFix(cctx, subArgs, ctx);
			break;
		case "widget":
			await handleWidget(cctx, subArgs, ctx);
			break;
		case "debug":
			await handleDebug(cctx, subArgs, ctx);
			break;
		case "reload":
			await handleReload(cctx, subArgs, ctx);
			break;
		case "status":
			await handleStatus(cctx, subArgs, ctx);
			break;
		case "cooldowns":
			await handleCooldowns(cctx, subArgs, ctx);
			break;
		case "compact":
			await handleCompact(cctx, subArgs, ctx);
			break;
		case "morphtools":
			await handleMorphTools(cctx, subArgs, ctx);
			break;
		case "context-override":
			await handleContextOverride(cctx, subArgs, ctx);
			break;
		case "cool":
			await handleCool(cctx, subArgs, ctx);
			break;
		case "uncool":
			await handleUncool(cctx, subArgs, ctx);
			break;
		case "help":
		case "?":
			await handleHelp(cctx, subArgs, ctx);
			break;
		default:
			if (subcommand) {
				// Check if subcommand is actually a profile name (backwards compatible-ish with /router-on)
				if (state.currentConfig.profiles[subcommand]) {
					if (subArgs.length > 0) {
						ctx.ui.notify(
							`Usage: /router ${subcommand} (no extra arguments allowed)`,
							"error",
						);
						return;
					}
					await actions.switchToRouterProfile(subcommand, ctx);
					ctx.ui.notify(
						`Router enabled with profile: ${state.selectedProfile}`,
						"info",
					);
				} else {
					ctx.ui.notify(
						`Unknown router subcommand: ${subcommand}. Try /router help`,
						"error",
					);
				}
			} else {
				await handleStatus(cctx, subArgs, ctx);
			}
			break;
	}
};
