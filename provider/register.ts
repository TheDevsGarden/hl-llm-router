import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from '@earendil-works/pi-ai';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { RouterProviderState, RouterProviderActions } from './types';
import { buildProfileModels, profileModelsKey } from './profile-models';
import { registerApiBridge } from './api-bridge';
import { runRouterStream } from './stream';

/**
 * Register the synthetic 'router' provider with pi. Idempotent: skips
 * re-registration when the model surface is unchanged AND the provider is
 * still present in the current registry (a models.json reload drops runtime
 * registrations, so the skip must not fire then).
 */
export const registerRouterProvider = (
  pi: ExtensionAPI,
  state: RouterProviderState,
  actions: RouterProviderActions,
): void => {
  const modelDefinitions = buildProfileModels(
    state.currentConfig,
    state.currentModelRegistry,
  );
  const modelsKey = profileModelsKey(modelDefinitions);

  const registry = state.currentModelRegistry as
    | { getProvider?: (name: string) => unknown }
    | undefined;
  const routerMissing =
    typeof registry?.getProvider === 'function' &&
    registry.getProvider('router') === undefined;
  if (state.lastRegisteredModels === modelsKey && !routerMissing) return;

  registerApiBridge(state);

  pi.registerProvider('router', {
    baseUrl: 'router://local',
    apiKey: 'pi-model-router',
    api: 'router-local-api',
    models: modelDefinitions,
    streamSimple(
      model: Model<Api>,
      context: Context,
      options?: SimpleStreamOptions,
    ): AssistantMessageEventStream {
      const stream = createAssistantMessageEventStream();
      runRouterStream(state, actions, model, context, options, stream);
      return stream;
    },
  });

  state.lastRegisteredModels = modelsKey;
};
