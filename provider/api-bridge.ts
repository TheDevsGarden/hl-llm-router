import { registerApiProvider } from '@earendil-works/pi-ai/compat';
import type { RouterProviderState } from './types';

/**
 * Register with pi-ai's global apiProviderRegistry so compat.streamSimple can
 * find us. Required because pi.registerProvider only registers in
 * ModelRegistry, but compat.streamSimple looks up providers via getApiProvider()
 * in pi-ai's registry. The bridge delegates to the real provider in ModelRegistry.
 */
export const registerApiBridge = (state: RouterProviderState): void => {
  registerApiProvider({
    api: 'router-local-api',
    stream(model, context, options) {
      const registry = state.currentModelRegistry;
      const provider = registry?.getProvider?.('router');
      if (!provider) {
        throw new Error('Router provider not found in ModelRegistry');
      }
      return provider.stream(model, context, options as any);
    },
    streamSimple(model, context, options) {
      const registry = state.currentModelRegistry;
      const provider = registry?.getProvider?.('router');
      if (!provider) {
        throw new Error('Router provider not found in ModelRegistry');
      }
      return provider.streamSimple(model, context, options as any);
    },
  }, 'hl-llm-router');
};
