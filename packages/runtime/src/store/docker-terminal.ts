import type { TerminalSchema } from '@tutorialkit/types';
import { atom, type ReadableAtom } from 'nanostores';
import type { DockerRuntime } from '../docker/index.js';
import type { DockerTerminal, ITerminal } from '../docker/terminal.js';

export interface TerminalPanel {
  id: string;
  type: 'terminal' | 'output';
  title?: string;
  terminal?: ITerminal;
  dockerTerminal?: DockerTerminal;
}

export interface TerminalConfig {
  panels: TerminalPanel[];
  activePanel: number;
  defaultOpen: boolean;
}

export class DockerTerminalStore {
  terminalConfig = atom<TerminalConfig>({ panels: [], activePanel: 0, defaultOpen: false });
  private _output: ITerminal | undefined = undefined;

  constructor(private _dockerRuntime: DockerRuntime) {}

  getOutputPanel(): ITerminal | undefined {
    return this._output;
  }

  hasTerminalPanel() {
    return this.terminalConfig.get().panels.length > 0;
  }

  setTerminalConfiguration(config?: TerminalSchema) {
    const panels: TerminalPanel[] = [];
    let defaultOpen = false;

    if (config === undefined || config === true) {
      // default: one output panel and one terminal panel
      panels.push({
        id: 'output',
        type: 'output',
        title: 'Output',
      });
      panels.push({
        id: 'terminal',
        type: 'terminal',
        title: 'Terminal',
      });
    } else if (config === false) {
      // no terminals - panels stays empty
    } else if (typeof config === 'object' && 'panels' in config && Array.isArray(config.panels)) {
      // Object with panels array
      defaultOpen = config.open ?? false;
      for (const panelConfig of config.panels) {
        if (typeof panelConfig === 'string') {
          panels.push({
            id: panelConfig,
            type: 'terminal',
            title: panelConfig,
          });
        } else if (Array.isArray(panelConfig)) {
          // Tuple format: ["output" | "terminal", title]
          const [type, title] = panelConfig;
          panels.push({
            id: `${type}-${panels.length}`,
            type,
            title,
          });
        } else {
          panels.push({
            id: panelConfig.id || panelConfig.title || `panel-${panels.length}`,
            type: panelConfig.type || 'terminal',
            title: panelConfig.title,
          });
        }
      }
    }

    // set output panel reference
    const outputPanel = panels.find((p) => p.type === 'output');
    if (outputPanel?.terminal) {
      this._output = outputPanel.terminal;
    }

    this.terminalConfig.set({ panels, activePanel: 0, defaultOpen });
  }

  attachTerminal(id: string, terminal: ITerminal) {
    const config = this.terminalConfig.get();
    const panel = config.panels.find((p) => p.id === id);

    if (!panel) {
      return;
    }

    panel.terminal = terminal;

    if (panel.type === 'output') {
      this._output = terminal;
    } else if (panel.type === 'terminal') {
      // connect to Docker terminal
      const dockerTerminal = this._dockerRuntime.attachTerminal(id, terminal);
      panel.dockerTerminal = dockerTerminal;
    }

    this.terminalConfig.set({ ...config });
  }

  onTerminalResize(cols: number, rows: number) {
    const config = this.terminalConfig.get();

    for (const panel of config.panels) {
      if (panel.dockerTerminal) {
        panel.dockerTerminal.resize(cols, rows);
      }
    }
  }

  /**
   * Get the container error atom for a terminal panel.
   */
  getContainerError(terminalId: string): ReadableAtom<string | undefined> | undefined {
    const config = this.terminalConfig.get();
    const panel = config.panels.find((p) => p.id === terminalId);
    return panel?.dockerTerminal?.containerError;
  }

  /**
   * Get the DockerTerminal instance for a panel.
   */
  getDockerTerminal(terminalId: string): DockerTerminal | undefined {
    const config = this.terminalConfig.get();
    const panel = config.panels.find((p) => p.id === terminalId);
    return panel?.dockerTerminal;
  }
}
