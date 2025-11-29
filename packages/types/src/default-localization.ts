import type { Lesson } from './entities/index.js';

export const DEFAULT_LOCALIZATION = {
  partTemplate: 'Part ${index}: ${title}',
  noPreviewNorStepsText: 'No preview to run nor steps to show',
  startRuntimeText: 'Run this tutorial',
  editPageText: 'Edit this page',
  poweredByText: 'Powered by TutorialKit',
  filesTitleText: 'Files',
  fileTreeCreateFileText: 'Create file',
  fileTreeCreateFolderText: 'Create folder',
  fileTreeActionNotAllowedText: 'This action is not allowed',
  fileTreeFileExistsAlreadyText: 'File exists on filesystem already',
  fileTreeAllowedPatternsText: 'Created files and folders must match following patterns:',
  confirmationText: 'OK',
  prepareEnvironmentTitleText: 'Preparing Environment',
  defaultPreviewTitleText: 'Preview',
  reloadPreviewTitle: 'Reload Preview',
  toggleTerminalButtonText: 'Toggle Terminal',
  solveButtonText: 'Solve',
  resetButtonText: 'Reset',
  /** @deprecated Use startRuntimeText instead */
  startWebContainerText: 'Run this tutorial',
  /** @deprecated Use poweredByText instead */
  webcontainerLinkText: 'Powered by WebContainers',
} satisfies Required<Lesson['data']['i18n']>;
