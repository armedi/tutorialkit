import type { TerminalSchema } from '@tutorialkit/types';

interface TerminalPanelConfig {
  type: 'terminal' | 'output';
  id: string;
  title?: string;
  allowCommands?: string[];
}

export interface TerminalConfig {
  panels: TerminalPanelConfig[];
  activePanel: number;
  defaultOpen: boolean;
}

export function createTerminalConfig(config?: TerminalSchema): TerminalConfig {
  if (config === false) {
    return { panels: [], activePanel: 0, defaultOpen: false };
  }

  if (config === undefined || config === true) {
    return {
      panels: [{ type: 'terminal', id: 'terminal' }],
      activePanel: 0,
      defaultOpen: false,
    };
  }

  // Handle array of panels
  if (Array.isArray(config.panels)) {
    const panels: TerminalPanelConfig[] = config.panels.map((panel, index) => {
      // Handle tuple format: ["output" | "terminal", string]
      if (Array.isArray(panel)) {
        const [type, title] = panel;
        return { type, id: `${type}-${index}`, title };
      }

      // Handle string format: "output" | "terminal"
      if (typeof panel === 'string') {
        return { type: panel, id: `${panel}-${index}` };
      }

      // Handle object format
      return {
        type: panel.type,
        id: panel.id ?? `${panel.type}-${index}`,
        title: panel.title,
        allowCommands: panel.allowCommands,
      };
    });

    return {
      panels,
      activePanel: config.activePanel ?? 0,
      defaultOpen: config.open ?? false,
    };
  }

  return {
    panels: [{ type: 'terminal', id: 'terminal' }],
    activePanel: 0,
    defaultOpen: false,
  };
}
