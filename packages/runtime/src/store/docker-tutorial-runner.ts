import type { CommandsSchema, Files } from '@tutorialkit/types';
import type { DockerRuntime } from '../docker/index.js';
import { newTask, type Task, type TaskCancelled } from '../tasks.js';
import { clearTerminal, escapeCodes, type ITerminal } from '../utils/terminal.js';
import { Command, Commands } from './commands.js';
import type { DockerTerminalStore } from './docker-terminal.js';
import type { EditorStore } from './editor.js';
import { StepsController } from './steps.js';

interface LoadFilesOptions {
  /**
   * The list of files to load.
   */
  files: Files | Promise<Files>;

  /**
   * The template to load.
   */
  template?: Files | Promise<Files>;

  /**
   * A signal to abort this operation.
   */
  signal?: AbortSignal;
}

interface RunCommandsOptions {
  /**
   * Abort the previous run commands operation.
   *
   * @default true
   */
  abortPreviousRun?: boolean;
}

/**
 * Manages Docker runtime state and exposes an interface for TutorialKit components.
 * There should be only a single instance of this class.
 */
export class TutorialRunner {
  private _currentLoadTask: Task<void | TaskCancelled> | undefined = undefined;
  private _currentProcessTask: Task<void | TaskCancelled> | undefined = undefined;
  private _currentTemplate: Files | undefined = undefined;
  private _currentFiles: Files | undefined = undefined;
  private _currentRunCommands: Commands | undefined = undefined;

  private _packageJsonDirty = false;
  private _commandsChanged = false;
  private _packageJsonContent = '';

  constructor(
    private _dockerRuntime: DockerRuntime,
    private _terminalStore: DockerTerminalStore,
    private _editorStore: EditorStore,
    private _stepController: StepsController,
  ) {}

  /**
   * Set the commands to run. This updates the reported `steps` if any have changed.
   *
   * @param commands The commands schema.
   */
  setCommands(commands: CommandsSchema) {
    const newCommands = new Commands(commands);
    const anyChange = this._changeDetection(commands);

    if (anyChange) {
      this._stepController.setFromCommands([...newCommands]);
      this._currentRunCommands = newCommands;
      this._commandsChanged = true;
    }
  }

  onTerminalResize(_cols: number, _rows: number) {
    // terminal resize is handled by the DockerTerminal directly
  }

  /**
   * Update the content of a single file.
   *
   * @param filePath path of the file
   * @param content new content of the file
   */
  updateFile(filePath: string, content: string): void {
    const previousLoadPromise = this._currentLoadTask?.promise;

    this._currentLoadTask = newTask(
      async (signal) => {
        await previousLoadPromise;

        signal.throwIfAborted();

        await this._dockerRuntime.writeFile(filePath, content);

        this._updateCurrentFiles({ [filePath]: content });
      },
      { ignoreCancel: true },
    );
  }

  /**
   * Update the provided files.
   *
   * @param files Files to update.
   */
  updateFiles(files: Files): void {
    const previousLoadPromise = this._currentLoadTask?.promise;

    this._currentLoadTask = newTask(
      async (signal) => {
        await previousLoadPromise;

        signal.throwIfAborted();

        await this._dockerRuntime.writeFiles(files);

        this._updateCurrentFiles(files);
      },
      { ignoreCancel: true },
    );
  }

  createFolder(_folderPath: string): void {
    /**
     * For Docker with bind mount, creating a folder is implicit when writing files.
     * We just track it in our state.
     */
  }

  async fileExists(filepath: string) {
    if (this._currentFiles?.[filepath] || this._currentTemplate?.[filepath]) {
      return true;
    }

    return false;
  }

  async folderExists(folderPath: string) {
    // check if any file starts with the folder path
    const allFiles = { ...this._currentTemplate, ...this._currentFiles };

    for (const path of Object.keys(allFiles)) {
      if (path.startsWith(folderPath + '/')) {
        return true;
      }
    }

    return false;
  }

  /**
   * Load the provided files into the Docker container.
   * This writes all files to the bind-mounted temp directory.
   */
  prepareFiles({ files, template, signal }: LoadFilesOptions): Promise<void | TaskCancelled> {
    const previousLoadPromise = this._currentLoadTask?.promise;

    this._currentLoadTask?.cancel();

    this._currentLoadTask = newTask(
      async (signal) => {
        await previousLoadPromise;

        signal.throwIfAborted();

        [template, files] = await Promise.all([template, files]);

        signal.throwIfAborted();

        // merge template and files
        const allFiles = { ...template, ...files };

        // write all files to the Docker container's bind-mounted directory
        await this._dockerRuntime.writeFiles(allFiles);

        this._currentTemplate = { ...template };
        this._currentFiles = { ...files };

        this._updateDirtyState(allFiles);
      },
      { ignoreCancel: true, signal },
    );

    return this._currentLoadTask.promise;
  }

  /**
   * Runs the list of commands set with `setCommands`.
   */
  runCommands({ abortPreviousRun = true }: RunCommandsOptions = {}): void {
    const previousTask = this._currentProcessTask;
    const loadPromise = this._currentLoadTask?.promise;
    const newCommands = this._currentRunCommands;
    const commandsChanged = this._commandsChanged;

    if (!newCommands) {
      throw new Error('setCommands should be called before runCommands');
    }

    this._currentProcessTask = newTask(
      async (signal) => {
        await loadPromise;

        if (signal.aborted && abortPreviousRun) {
          previousTask?.cancel();
        }

        signal.throwIfAborted();

        const anyChange = this._packageJsonDirty || commandsChanged;

        if (!anyChange) {
          if (previousTask) {
            const abortListener = () => previousTask.cancel();
            signal.addEventListener('abort', abortListener, { once: true });

            return previousTask.promise;
          }

          return undefined;
        }

        this._commandsChanged = false;

        if (abortPreviousRun) {
          previousTask?.cancel();
        }

        await previousTask?.promise;

        signal.throwIfAborted();

        return this._runCommands(newCommands, signal);
      },
      { ignoreCancel: true },
    );
  }

  /**
   * Restart the last run commands.
   */
  restartLastRunCommands() {
    if (!this._currentRunCommands || !this._currentProcessTask) {
      return;
    }

    const previousRunCommands = this._currentRunCommands;
    const previousProcessPromise = this._currentProcessTask.promise;
    const loadPromise = this._currentLoadTask?.promise;

    this._currentProcessTask.cancel();

    this._currentProcessTask = newTask(
      async (signal) => {
        await Promise.all([previousProcessPromise, loadPromise]);

        signal.throwIfAborted();

        return this._runCommands(previousRunCommands, signal);
      },
      { ignoreCancel: true },
    );
  }

  /**
   * Get snapshot of runner's current files.
   */
  takeSnapshot() {
    const files: Record<string, string> = {};

    // first add template files
    for (const [filePath, value] of Object.entries(this._currentTemplate || {})) {
      if (typeof value === 'string') {
        files[filePath.slice(1)] = value;
      }
    }

    // next overwrite with files from editor
    for (const [filePath, value] of Object.entries(this._currentFiles || {})) {
      if (typeof value === 'string') {
        files[filePath.slice(1)] = value;
      }
    }

    return { files };
  }

  private async _runCommands(commands: Commands, signal: AbortSignal) {
    const output = this._terminalStore.getOutputPanel();

    clearTerminal(output);

    let shouldClearDirtyFlag = true;

    try {
      const commandList = [...commands];

      this._stepController.setFromCommands(commandList);

      let runnableCommands = 0;

      for (const [index, command] of commandList.entries()) {
        const isMainCommand = index === commandList.length - 1 && !!commands.mainCommand;

        if (!command.isRunnable()) {
          this._stepController.updateStep(index, {
            title: command.title,
            status: 'skipped',
          });

          continue;
        }

        this._stepController.updateStep(index, {
          title: command.title,
          status: 'running',
        });

        if (runnableCommands > 0) {
          output?.write('\n');
        }

        runnableCommands++;

        // execute command via Docker terminal
        await this._execCommand(command.shellCommand, output);

        try {
          signal.throwIfAborted();
        } catch (error) {
          this._stepController.skipRemaining(index);
          throw error;
        }

        if (isMainCommand) {
          shouldClearDirtyFlag = false;
          this._clearDirtyState();
        }

        this._stepController.updateStep(index, {
          title: command.title,
          status: 'completed',
        });

        try {
          signal.throwIfAborted();
        } catch (error) {
          this._stepController.skipRemaining(index + 1);
          throw error;
        }
      }

      if (shouldClearDirtyFlag) {
        this._clearDirtyState();
      }
    } catch {
      // commands failed, silently ignore
    }
  }

  private async _execCommand(shellCommand: string, output: ITerminal | undefined): Promise<void> {
    const [command, ...args] = shellCommand.split(' ');

    output?.write(`${escapeCodes.magenta('❯')} ${escapeCodes.green(command)} ${args.join(' ')}\n`);

    // get the main terminal and execute the command
    const terminal = this._dockerRuntime.getTerminal('main');

    return new Promise<void>((resolve) => {
      // use exec to run the command
      terminal.exec(shellCommand);

      /**
       * For now, we resolve immediately as exec is fire-and-forget.
       * In a real implementation, we'd wait for exec-complete message.
       */
      setTimeout(resolve, 500);
    });
  }

  private _updateDirtyState(files: Files) {
    for (const filePath in files) {
      if (filePath.endsWith('/package.json') && files[filePath] !== this._packageJsonContent) {
        this._packageJsonContent = files[filePath] as string;
        this._packageJsonDirty = true;

        return;
      }
    }
  }

  private _updateCurrentFiles(files: Files) {
    if (this._currentFiles) {
      for (const filePath in files) {
        this._currentFiles[filePath] = files[filePath];
      }
    } else {
      this._currentFiles = { ...files };
    }

    this._updateDirtyState(files);
  }

  private _clearDirtyState() {
    this._packageJsonDirty = false;
  }

  private _changeDetection(newCommands: CommandsSchema) {
    if (this._packageJsonDirty) {
      return true;
    }

    if (!this._currentRunCommands) {
      return true;
    }

    const prevCommandList = commandsToList(this._currentRunCommands);
    const newCommandList = commandsToList(newCommands);

    if (prevCommandList.length !== newCommandList.length) {
      return true;
    }

    for (let i = 0; i < prevCommandList.length; ++i) {
      if (!Command.equals(prevCommandList[i], newCommandList[i])) {
        return true;
      }
    }

    return false;
  }
}

function commandsToList(commands: Commands | CommandsSchema) {
  if (commands instanceof Commands) {
    return [...commands].filter((command) => command.isRunnable());
  }

  return commandsToList(new Commands(commands));
}
