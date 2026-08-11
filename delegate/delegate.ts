import { streamSimple } from "@earendil-works/pi-ai/compat";
import type { CooldownState } from "../types";
import { resolveContextWindow } from "../config";
import {
	EMPTY_COOLDOWN_STATE,
	advertisedWaitMs,
	classifyFailure,
	isConnectivityFailure,
	markCooling,
	resolveRule,
} from "../cooldown";
import { loadCooldowns, saveCooldowns } from "../cooldown-store";
import { safeParseModelRef } from "../shared/model-ref";
import { invariant } from "../invariants";
import { truncateContext } from "./truncate";
import { resolveDelegatedReasoning } from "./params";
import { applyCooldownOrder } from "./order";
import { withHangGuard, HangError } from "./hang-guard";
import { logRouterEvent } from "../cooldown/logger";
import type { DelegateChainParams, DelegateChainResult } from "./params";

/**
 * Delegate a turn to the first candidate in the chain that answers, forwarding
 * its events onto `stream`.
 *
 * NEVER THROWS: every failure path resolves to `{ success: false, ... }` with
 * the offending error in `lastError`, so the caller decides how to surface it
 * and the cooldown store is always written before returning.
 */
export const delegateToChain = async (
	params: DelegateChainParams,
): Promise<DelegateChainResult> => {
	const {
		registry,
		profile,
		context,
		options,
		stream,
		reportedContextWindow,
		setThinkingLabel,
		addCost,
		cooldownDir,
	} = params;

	invariant(
		params.modelsToTry.length > 0,
		"delegateToChain called with an empty candidate chain",
	);

	const primaryRef = params.modelsToTry[0];
	const cooldownsEnabled = params.cooldowns?.enabled === true;
	const now = Date.now();

	let cooldownState: CooldownState = cooldownsEnabled
		? loadCooldowns(cooldownDir, now)
		: EMPTY_COOLDOWN_STATE;
	let cooldownDirty = false;

	let lastError: unknown;
	let success = false;
	let fellBack = false;

	try {
		let decision = params.decision;
		let modelsToTry = params.modelsToTry;
		if (cooldownsEnabled) {
			const ordering = applyCooldownOrder(
				modelsToTry,
				decision,
				cooldownState,
				now,
			);
			modelsToTry = ordering.ordered;
			decision = ordering.decision;
		}

		const noteFailure = (
			failedProvider: string,
			failedModelId: string,
			error: unknown,
		): void => {
			if (!cooldownsEnabled) return;
			const reason = classifyFailure(error);
			if (!reason) return;
			const resolved = resolveRule(
				failedProvider,
				params.cooldowns?.defaults,
				params.cooldowns?.providers,
			);
			// An unreachable host is a property of the endpoint, not of one model
			// behind it. Cooling per-model would eat one full idle timeout for every
			// model the dead provider offers before the chain could move on.
			const rule = isConnectivityFailure(error)
				? { ...resolved, scope: "provider" as const }
				: resolved;
			// HangError carries the exact timeout budget that was used. Use it as
			// the cooldown duration so a model that hung for 30 minutes is cooled
			// for 30 minutes, not the generic server-rule window.
			const hangMs = error instanceof HangError ? error.timeoutMs : undefined;
			const advertisedMs = advertisedWaitMs(error) ?? hangMs;
			cooldownState = markCooling(cooldownState, {
				provider: failedProvider,
				modelId: failedModelId,
				reason,
				rule,
				now: Date.now(),
				...(advertisedMs === undefined ? {} : { advertisedMs }),
			});
			cooldownDirty = true;

			// Log the event for forensics.
			const canonicalId = `${failedProvider}/${failedModelId}`;
			if (reason === "hang" && hangMs !== undefined) {
				logRouterEvent({
					type: "hang",
					timestamp: Date.now(),
					canonicalId,
					timeoutMs: hangMs,
				});
			} else {
				logRouterEvent({
					type: "cooldown",
					timestamp: Date.now(),
					canonicalId,
					reason,
					until: Date.now() + (advertisedMs ?? 0),
					trigger:
						error instanceof Error
							? { kind: "error", errorMessage: error.message }
							: { kind: "error", errorMessage: String(error) },
				});
			}
		};

		for (const modelRef of modelsToTry) {
			const parsedRef = safeParseModelRef(modelRef);
			if (!parsedRef) {
				lastError = new Error(
					`Invalid model reference "${modelRef}". Expected "provider/model".`,
				);
				continue;
			}
			const { provider: targetProvider, modelId: targetModelId } = parsedRef;

			if (targetProvider === "router") continue;

			const targetModel = registry.find(targetProvider, targetModelId);
			if (!targetModel) {
				lastError = new Error(
					`Routed model not found: ${targetProvider}/${targetModelId}`,
				);
				continue;
			}

			let apiKey: string;
			let headers: Record<string, string> | undefined;
			try {
				const auth = await registry.getApiKeyAndHeaders(targetModel);
				if (!auth.ok || !auth.apiKey) {
					throw new Error(
						auth.ok
							? `No API key for routed model: ${targetProvider}/${targetModelId}`
							: `Auth failed for routed model: ${targetProvider}/${targetModelId}: ${auth.error}`,
					);
				}
				apiKey = auth.apiKey;
				headers = auth.headers;
			} catch (authError) {
				// Deliberately NOT noteFailure(): this is a local credential lookup,
				// not a provider response. "No API key configured" is a static config
				// fact, and cooling on it lets one uncredentialed candidate park a
				// whole provider (subs rules are provider-scoped) — in pool mode that
				// cools every provider in a single turn. A genuine 401 still arrives
				// from the stream below and is cooled there.
				lastError = authError;
				continue;
			}

			try {
				// HONESTY CHECK & AUTO-TRUNCATION
				let effectiveContext = context;
				const targetLimit = resolveContextWindow(
					decision.tier,
					profile,
					registry,
				);
				if (targetLimit < reportedContextWindow) {
					effectiveContext = truncateContext(context, targetLimit);
				}

				const delegatedReasoning = resolveDelegatedReasoning(
					params,
					decision,
					targetModel.reasoning,
				);

				try {
					if (delegatedReasoning) {
						setThinkingLabel(
							`Thinking (${targetProvider}/${targetModelId})...`,
						);
					} else {
						setThinkingLabel();
					}
				} catch {
					// Stale extension context — skip non-critical UI updates.
				}

				const { reasoning: _piReasoning, ...delegationOptions } = options ?? {};

				const delegatedStream = streamSimple(targetModel, effectiveContext, {
					...delegationOptions,
					apiKey,
					headers,
					...(delegatedReasoning ? { reasoning: delegatedReasoning } : {}),
				});

				// HANG GUARD: a provider that accepted the request but never emits
				// body bytes must not block the chain for the full HTTP idle timeout.
				// Budget per model: explicit responseTimeoutMs (capped at 30 min) >
				// reasoning models get 10 min > default 3 min. No inter-event
				// timeout once streaming starts — reasoning pauses are normal.
				const CAP_MS = 1_800_000; // 30 min hard cap
				const isReasoning = targetModel.reasoning === true;
				const initialIdleMs = Math.min(
					targetModel.responseTimeoutMs ?? (isReasoning ? 600_000 : 180_000),
					CAP_MS,
				);
				const guard = withHangGuard(delegatedStream, {
					preStreamTimeoutMs: 10_000,
					initialIdleTimeoutMs: initialIdleMs,
					interEventTimeoutMs: 0,
				});

				let contentReceived = false;
				for await (const event of guard.iterator) {
					if (event.type === "done") {
						addCost(event.message.usage?.cost?.total ?? 0);
					}
					if (event.type === "error" && !contentReceived) {
						const errorMessage =
							"error" in event &&
							event.error &&
							typeof event.error === "object" &&
							"errorMessage" in event.error &&
							typeof event.error.errorMessage === "string"
								? event.error.errorMessage
								: undefined;
						throw new Error(
							errorMessage || "Model failed before sending content.",
						);
					}
					const isContent =
						event.type === "text_delta" ||
						event.type === "thinking_delta" ||
						event.type === "toolcall_delta" ||
						event.type === "toolcall_end";
					if (isContent) contentReceived = true;
					stream.push(event);
				}
				// If the guard aborted the stream (timeout), surface it as a hang
				// error so noteFailure cools the model instead of treating the empty
				// stream as a success. The exact timeout used is captured for
				// forensics.
				if (!contentReceived && !guard.hasStarted()) {
					throw new HangError("initial-idle", initialIdleMs);
				}
				success = true;
				fellBack = modelRef !== primaryRef;
				break;
			} catch (err) {
				lastError = err;
				noteFailure(targetProvider, targetModelId, err);
			}
		}
	} catch (unexpected) {
		lastError = unexpected;
	} finally {
		if (cooldownDirty) {
			saveCooldowns(cooldownDir, cooldownState, Date.now());
		}
	}

	if (!success && !(lastError instanceof Error)) {
		lastError = new Error(
			typeof lastError === "string"
				? lastError
				: "Failed to delegate to any model in the chain.",
		);
	}

	return { success, fellBack, lastError };
};
