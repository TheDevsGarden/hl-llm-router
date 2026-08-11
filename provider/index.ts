export { registerRouterProvider } from './register';
export { waitForRegistry } from './registry-wait';
export { applyDisabledProviderFilter } from './filter';
export { resolveClassifierDecision } from './classifier-decision';
export type { ClassifierDecisionParams } from './classifier-decision';
export type { RouterProviderState, RouterProviderActions } from './types';
// Lives in shared/ since delegate needs it too, but it is part of the provider's
// public surface: callers reach for it alongside registerRouterProvider.
export { createErrorMessage } from '../shared/error-message';
