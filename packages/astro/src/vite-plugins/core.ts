/**
 * A plugin that let users write components that can access the internals
 * of TutorialKit.
 *
 * The virtual module can be imported as:
 *
 * ```ts
 * import { tutorialStore } from 'tutorialkit:core';
 *
 * export const MyComponent = () => {
 *   useEffect(() => {
 *     (async () => {
 *       // Access the tutorial store for Docker-based runtime
 *       const files = await tutorialStore.getFiles();
 *     })();
 *   }, []);
 *
 *   return null;
 * };
 * ```
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VitePlugin } from '../types.js';
import { normalizeImportPath } from '../utils.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const virtualModuleId = 'tutorialkit:core';
const resolvedVirtualModuleId = `${virtualModuleId}`;

export const tutorialkitCore: VitePlugin = {
  name: 'tutorialkit-core-virtual-mod-plugin',
  resolveId(id) {
    if (id === virtualModuleId) {
      return resolvedVirtualModuleId;
    }

    return undefined;
  },
  async load(id) {
    if (id === resolvedVirtualModuleId) {
      const pathToInit = normalizeImportPath(path.join(__dirname, 'default/components/webcontainer.ts'));

      return `
        export { tutorialStore } from '${pathToInit}';
      `;
    }

    return undefined;
  },
};
