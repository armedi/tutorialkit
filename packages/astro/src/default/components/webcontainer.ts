import { TutorialStore } from '@tutorialkit/runtime';
import { joinPaths } from '../utils/url.js';

interface DockerRuntimeContext {
  loaded: boolean;
}

export const tutorialStore = new TutorialStore({
  basePathname: joinPaths(import.meta.env.BASE_URL, '/'),
});

export const dockerRuntimeContext: DockerRuntimeContext = {
  loaded: false,
};

// mark as loaded when Docker runtime connects
if (!import.meta.env.SSR) {
  tutorialStore.dockerRuntime.bootStatus.subscribe((status) => {
    if (status === 'connected') {
      dockerRuntimeContext.loaded = true;
    }
  });
}

// legacy exports for compatibility
export const webcontainerContext = dockerRuntimeContext;
export const webcontainer = Promise.resolve(null);
export const login = () => Promise.resolve();
export const logout = () => {};
