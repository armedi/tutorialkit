import type { EditorSchema } from '@tutorialkit/types';

type FileTreeConfig = {
  visible: boolean;
  allowEdits: string[];
};

export class EditorConfig {
  readonly visible: boolean;
  readonly fileTree: FileTreeConfig;

  constructor(config?: EditorSchema) {
    // Handle boolean | undefined | object config
    if (config === false) {
      this.visible = false;
      this.fileTree = { visible: false, allowEdits: [] };
    } else if (typeof config === 'object' && config !== null) {
      // It's an object with fileTree config
      this.visible = true;
      const fileTree = config.fileTree;
      if (fileTree === false) {
        this.fileTree = { visible: false, allowEdits: [] };
      } else if (typeof fileTree === 'object' && fileTree !== null) {
        const allowEdits = fileTree.allowEdits;
        let editsArray: string[] = [];
        if (typeof allowEdits === 'string') {
          editsArray = [allowEdits];
        } else if (Array.isArray(allowEdits)) {
          editsArray = allowEdits;
        }
        this.fileTree = {
          visible: true,
          allowEdits: editsArray,
        };
      } else {
        // fileTree is true or undefined
        this.fileTree = { visible: true, allowEdits: [] };
      }
    } else {
      // true, undefined, or null - use defaults
      this.visible = true;
      this.fileTree = { visible: true, allowEdits: [] };
    }
  }
}
