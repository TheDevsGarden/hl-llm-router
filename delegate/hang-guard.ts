import { setTimeout, clearTimeout } from "node:timers";

/**
 * Hang detection for streamed LLM responses.
 *
 * The router previously had no upper bound on a model's response time: a
 * provider that accepted the request but never sent body bytes would block
 * the for-await loop until the HTTP idle timeout (up to 2h). This wrapper
 * sits between `streamSimple` and the caller's for-await and sets a
 * time-to-first-byte (TTFB) budget.
 *
 * Design choice — TTFB only, not inter-event:
 * Reasoning models legitimately pause between visible tokens while computing
 * internally. An inter-event timeout would kill a 5-minute reasoning pass
 * the moment the model stopped emitting for 30s. The TTFB is the right
 * signal: a model that has produced something is alive; a model that has
 * produced nothing in N minutes is dead.
 *
 * The wrapper is intentionally minimal: one timeout, one error class. It
 * sits on top of the stream object returned by `streamSimple`, which has
 * already absorbed auth lookup and DNS. Pre-stream hangs (stuck auth,
 * unreachable host) are still caught by the connectivity-hints path in
 * `classifyFailure` when the underlying provider eventually errors.
 */
export interface HangGuardOptions {
	/** Time-to-first-byte budget. 0 disables the guard entirely. */
	initialIdleTimeoutMs: number;
}

export interface HangGuard<T> {
	iterator: AsyncIterator<T>;
	/** True once at least one event has been yielded. */
	hasStarted: () => boolean;
	/** Called when a timeout fires. The iterator will not yield more values. */
	abort: () => void;
}

/** Thrown by the hang guard when the TTFB timeout fires. */
export class HangError extends Error {
	readonly timeoutMs: number;
	constructor(timeoutMs: number) {
		super(`Stream hung: no first byte within ${timeoutMs}ms`);
		this.name = "HangError";
		this.timeoutMs = timeoutMs;
	}
}

export const withHangGuard = <T>(
	source: AsyncIterable<T>,
	options: HangGuardOptions,
): HangGuard<T> => {
	const inner = source[Symbol.asyncIterator]();
	let aborted = false;
	let started = false;

	// Short-circuit: no timeout means just pass through the inner iterator.
	if (options.initialIdleTimeoutMs <= 0) {
		return {
			iterator: {
				next: async () => {
					if (aborted) return { done: true, value: undefined };
					const result = await inner.next();
					if (!result.done) started = true;
					return result;
				},
			},
			hasStarted: () => started,
			abort: () => {
				aborted = true;
			},
		};
	}

	const next = async (): Promise<IteratorResult<T>> => {
		if (aborted) return { done: true, value: undefined };
		let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
		const timeout = new Promise<IteratorResult<T>>((resolve) => {
			timeoutHandle = setTimeout(() => {
				if (aborted) return;
				aborted = true;
				resolve({ done: true, value: undefined });
			}, options.initialIdleTimeoutMs);
		});

		let realNext: Promise<IteratorResult<T>>;
		try {
			realNext = inner.next();
		} catch (err) {
			if (timeoutHandle) clearTimeout(timeoutHandle);
			throw err;
		}

		let result: IteratorResult<T>;
		try {
			result = await Promise.race([realNext, timeout]);
		} finally {
			if (timeoutHandle) clearTimeout(timeoutHandle);
		}
		if (result.done) return result;
		started = true;
		return result;
	};

	return {
		iterator: { next },
		hasStarted: () => started,
		abort: () => {
			aborted = true;
		},
	};
};
