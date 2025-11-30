import type { FileDescriptor, Files, FilesystemError, Lesson } from '@tutorialkit/types';
import { atom, type ReadableAtom } from 'nanostores';

import { type BootStatus, DockerRuntime, type PreviewInfo } from '../docker/index.js';
import type { ITerminal } from '../docker/terminal.js';
import { LessonFilesFetcher } from '../lesson-files.js';
import { newTask, type Task } from '../tasks.js';
import { DockerPreviewsStore } from './docker-previews.js';
import { DockerTerminalStore, type TerminalConfig } from './docker-terminal.js';
import { TutorialRunner } from './docker-tutorial-runner.js';
import {
  type EditorConfig,
  type EditorDocument,
  type EditorDocuments,
  EditorStore,
  type ScrollPosition,
} from './editor.js';
import { StepsController } from './steps.js';

interface StoreOptions {
  /**
   * The base path to use when fetching files.
   */
  basePathname?: string;

  /**
   * Backend URL for Docker runtime (optional, can be set later via UI).
   */
  backendUrl?: string;
}

export class TutorialStore {
  private _dockerRuntime: DockerRuntime;
  private _runner: TutorialRunner;
  private _previewsStore: DockerPreviewsStore;
  private _editorStore: EditorStore;
  private _terminalStore: DockerTerminalStore;
  private _stepController = new StepsController();
  private _lessonFilesFetcher: LessonFilesFetcher;
  private _lessonTask: Task<unknown> | undefined;
  private _lesson: Lesson | undefined;
  private _ref = atom(1);
  private _themeRef = atom(1);

  private _lessonFiles: Files | undefined;
  private _lessonSolution: Files | undefined;
  private _lessonTemplate: Files | undefined;

  /**
   * Whether or not the current lesson is fully loaded in Docker container
   * and in every stores.
   */
  readonly lessonFullyLoaded = atom<boolean>(false);

  constructor({ basePathname, backendUrl }: StoreOptions = {}) {
    this._dockerRuntime = new DockerRuntime(backendUrl ? { backendUrl } : undefined);
    this._editorStore = new EditorStore();
    this._lessonFilesFetcher = new LessonFilesFetcher(basePathname);
    this._previewsStore = new DockerPreviewsStore(this._dockerRuntime);
    this._terminalStore = new DockerTerminalStore(this._dockerRuntime);
    this._runner = new TutorialRunner(
      this._dockerRuntime,
      this._terminalStore as any,
      this._editorStore,
      this._stepController,
    );

    // HMR support
    if (import.meta.hot) {
      import.meta.hot.on('tk:refresh-wc-files', async (hotFilesRefs: string[]) => {
        let shouldUpdate = false;

        for (const filesRef of hotFilesRefs) {
          const result = await this._lessonFilesFetcher.invalidate(filesRef);

          switch (result.type) {
            case 'none': {
              break;
            }
            case 'files': {
              if (this._lesson?.files[0] === filesRef) {
                shouldUpdate = true;

                this._lesson.files[1] = Object.keys(result.files).sort();
                this._lessonFiles = result.files;
              }

              break;
            }
            case 'solution': {
              if (this._lesson?.solution[0] === filesRef) {
                shouldUpdate = true;

                this._lesson.solution[1] = Object.keys(result.files).sort();
                this._lessonSolution = result.files;
              }

              break;
            }
            case 'template': {
              shouldUpdate = true;

              this._lessonTemplate = result.files;

              break;
            }
          }
        }

        if (shouldUpdate && this._lesson) {
          this._lessonTask?.cancel();

          const files = this._lessonFiles ?? {};
          const template = this._lessonTemplate;

          this._lessonTask = newTask(
            async (signal) => {
              const preparePromise = this._runner.prepareFiles({ template, files, signal });

              this._runner.runCommands();
              this._editorStore.setDocuments(files);

              await preparePromise;
            },
            { ignoreCancel: true },
          );
        }
      });
    }
  }

  /** Get the Docker runtime instance */
  get dockerRuntime(): DockerRuntime {
    return this._dockerRuntime;
  }

  /** @internal */
  setLesson(lesson: Lesson, options: { ssr?: boolean } = {}) {
    if (lesson === this._lesson) {
      return;
    }

    this._lessonTask?.cancel();

    this._ref.set(1 + (this._ref.value || 0));
    this._lesson = lesson;
    this.lessonFullyLoaded.set(false);

    this._previewsStore.setPreviews(lesson.data.previews ?? true);
    this._terminalStore.setTerminalConfiguration(lesson.data.terminal);
    this._editorStore.setEditorConfig(lesson.data.editor);
    this._runner.setCommands(lesson.data);
    this._editorStore.setDocuments(lesson.files);

    if (options.ssr) {
      return;
    }

    this._lessonTask = newTask(
      async (signal) => {
        const templatePromise = this._lessonFilesFetcher.getLessonTemplate(lesson);
        const filesPromise = this._lessonFilesFetcher.getLessonFiles(lesson);

        // boot Docker container with template files first
        const template = await templatePromise;

        signal.throwIfAborted();

        // check if we need to boot the runtime
        if (!this._dockerRuntime.sessionId) {
          await this._dockerRuntime.boot(template);
        }

        signal.throwIfAborted();

        const preparePromise = this._runner.prepareFiles({ template: templatePromise, files: filesPromise, signal });

        this._runner.runCommands();

        const [solution, files] = await Promise.all([this._lessonFilesFetcher.getLessonSolution(lesson), filesPromise]);

        signal.throwIfAborted();

        this._lessonTemplate = template;
        this._lessonFiles = files;
        this._lessonSolution = solution;

        this._editorStore.setDocuments(files);

        if (lesson.data.focus === undefined) {
          this._editorStore.setSelectedFile(undefined);
        } else if (files[lesson.data.focus] !== undefined) {
          this._editorStore.setSelectedFile(lesson.data.focus);
        }

        await preparePromise;

        signal.throwIfAborted();

        this.lessonFullyLoaded.set(true);
      },
      { ignoreCancel: true },
    );
  }

  /** Instances of the preview tabs. */
  get previews(): ReadableAtom<PreviewInfo[]> {
    return this._previewsStore.previews;
  }

  /** Configuration and instances of the terminal */
  get terminalConfig(): ReadableAtom<TerminalConfig> {
    return this._terminalStore.terminalConfig;
  }

  /** Configuration of the editor and file tree */
  get editorConfig(): ReadableAtom<EditorConfig> {
    return this._editorStore.editorConfig;
  }

  /** File that's currently open in the editor */
  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this._editorStore.currentDocument;
  }

  /** Status of the Docker runtime's booting */
  get bootStatus(): ReadableAtom<BootStatus> {
    return this._dockerRuntime.bootStatus;
  }

  /** Boot error message if any */
  get bootError(): ReadableAtom<string | undefined> {
    return this._dockerRuntime.bootError;
  }

  /** Files that are available in the editor. */
  get documents(): ReadableAtom<EditorDocuments> {
    return this._editorStore.documents;
  }

  /** Paths of the files that are available in the lesson */
  get files(): ReadableAtom<FileDescriptor[]> {
    return this._editorStore.files;
  }

  /** File that's currently selected in the file tree */
  get selectedFile(): ReadableAtom<string | undefined> {
    return this._editorStore.selectedFile;
  }

  /** Currently active lesson */
  get lesson(): Readonly<Lesson> | undefined {
    return this._lesson;
  }

  /** @internal */
  get ref(): ReadableAtom<unknown> {
    return this._ref;
  }

  /** @internal */
  get themeRef(): ReadableAtom<unknown> {
    return this._themeRef;
  }

  /**
   * Steps that the runner is or will be executing.
   *
   * @internal
   */
  get steps() {
    return this._stepController.steps;
  }

  /** Check if file tree is visible */
  hasFileTree(): boolean {
    if (!this._lesson) {
      return false;
    }

    return this.editorConfig.get().fileTree.visible;
  }

  /** Check if editor is visible */
  hasEditor(): boolean {
    if (!this._lesson) {
      return false;
    }

    return this.editorConfig.get().visible;
  }

  /** Check if lesson has any previews set */
  hasPreviews(): boolean {
    if (!this._lesson) {
      return false;
    }

    const { previews } = this._lesson.data;

    return previews !== false;
  }

  /** Check if lesson has any terminals set */
  hasTerminalPanel(): boolean {
    return this._terminalStore.hasTerminalPanel();
  }

  /** Check if lesson has solution files set */
  hasSolution(): boolean {
    return !!this._lesson && Object.keys(this._lesson.solution[1]).length >= 1;
  }

  /** Check Docker health and reconnect if needed */
  async checkHealth() {
    return this._dockerRuntime.checkHealth();
  }

  /** Set the backend URL for Docker runtime */
  setBackendUrl(url: string) {
    this._dockerRuntime.backendUrl = url;
  }

  /** Get current backend URL */
  getBackendUrl(): string {
    return this._dockerRuntime.backendUrl;
  }

  /**
   * Retry booting the Docker runtime with the current lesson.
   * Use this after configuring the backend URL to start/restart the container.
   */
  async retryBoot(): Promise<void> {
    const lesson = this._lesson;

    if (!lesson) {
      return;
    }

    this._lessonTask?.cancel();
    this.lessonFullyLoaded.set(false);

    this._lessonTask = newTask(
      async (signal) => {
        const templatePromise = this._lessonFilesFetcher.getLessonTemplate(lesson);
        const filesPromise = this._lessonFilesFetcher.getLessonFiles(lesson);

        // boot Docker container with template files first
        const template = await templatePromise;

        signal.throwIfAborted();

        // shutdown existing session if any, then boot fresh
        if (this._dockerRuntime.sessionId) {
          await this._dockerRuntime.shutdown();
        }

        await this._dockerRuntime.boot(template);

        signal.throwIfAborted();

        const preparePromise = this._runner.prepareFiles({ template: templatePromise, files: filesPromise, signal });

        this._runner.runCommands();

        const [solution, files] = await Promise.all([this._lessonFilesFetcher.getLessonSolution(lesson), filesPromise]);

        signal.throwIfAborted();

        this._lessonTemplate = template;
        this._lessonFiles = files;
        this._lessonSolution = solution;

        this._editorStore.setDocuments(files);

        if (lesson.data.focus === undefined) {
          this._editorStore.setSelectedFile(undefined);
        } else if (files[lesson.data.focus] !== undefined) {
          this._editorStore.setSelectedFile(lesson.data.focus);
        }

        await preparePromise;

        signal.throwIfAborted();

        this.lessonFullyLoaded.set(true);
      },
      { ignoreCancel: true },
    );
  }

  /** Reset changed files back to lesson's initial state */
  reset() {
    const isReady = this.lessonFullyLoaded.value;

    if (!isReady || !this._lessonFiles) {
      return;
    }

    this._editorStore.setDocuments(this._lessonFiles);
    this._runner.updateFiles(this._lessonFiles);
  }

  /** Apply lesson solution into the lesson files */
  solve() {
    const isReady = this.lessonFullyLoaded.value;

    if (!isReady || !this._lessonSolution) {
      return;
    }

    const files = { ...this._lessonFiles, ...this._lessonSolution };

    this._editorStore.setDocuments(files);
    this._runner.updateFiles(files);
  }

  /** Set file from file tree as selected */
  setSelectedFile(filePath: string | undefined) {
    this._editorStore.setSelectedFile(filePath);
  }

  /** Add new file to file tree */
  async addFile(filePath: string): Promise<void> {
    // always select the existing or newly created file
    this.setSelectedFile(filePath);

    // prevent creating duplicates
    if (this._editorStore.files.get().find((file) => file.path === filePath)) {
      return;
    }

    if (await this._runner.fileExists(filePath)) {
      throw new Error('FILE_EXISTS' satisfies FilesystemError);
    }

    this._editorStore.addFileOrFolder({ path: filePath, type: 'file' });
    this._runner.updateFile(filePath, '');
  }

  /** Add new folder to file tree */
  async addFolder(folderPath: string) {
    // prevent creating duplicates
    if (this._editorStore.files.get().some((file) => file.path.startsWith(folderPath))) {
      return;
    }

    if (await this._runner.folderExists(folderPath)) {
      throw new Error('FOLDER_EXISTS' satisfies FilesystemError);
    }

    this._editorStore.addFileOrFolder({ path: folderPath, type: 'folder' });
    this._runner.createFolder(folderPath);
  }

  /** Update contents of file */
  updateFile(filePath: string, content: string) {
    const hasChanged = this._editorStore.updateFile(filePath, content);

    if (hasChanged) {
      this._runner.updateFile(filePath, content);
    }
  }

  /** Update content of the active file */
  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    this.updateFile(filePath, newContent);
  }

  /** Update scroll position of the file in editor */
  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this._editorStore.updateScrollPosition(filePath, position);
  }

  /** @internal */
  attachTerminal(id: string, terminal: ITerminal) {
    this._terminalStore.attachTerminal(id, terminal);
  }

  /**
   * Get container error for a specific terminal.
   * Returns a ReadableAtom that can be subscribed to for error state changes.
   */
  getTerminalContainerError(terminalId: string): ReadableAtom<string | undefined> | undefined {
    return this._terminalStore.getContainerError(terminalId);
  }

  /**
   * Retry connecting a terminal that failed with a container error.
   * Re-polls session status and reconnects the terminal.
   */
  async retryTerminalConnection(terminalId: string): Promise<void> {
    const dockerTerminal = this._terminalStore.getDockerTerminal(terminalId);

    if (!dockerTerminal) {
      throw new Error(`Terminal ${terminalId} not found`);
    }

    // clear the error state
    dockerTerminal.clearContainerError();

    // poll session status until container is ready
    const maxWaitTime = 30000;
    const initialDelay = 500;
    const maxDelay = 4000;
    const startTime = Date.now();
    let delay = initialDelay;

    while (Date.now() - startTime < maxWaitTime) {
      const sessionInfo = await this._dockerRuntime.checkSessionInfo();

      if (sessionInfo?.containerReady) {
        // container is ready, reconnect terminal
        if (!dockerTerminal.isConnected) {
          await dockerTerminal.connect();
        } else {
          // already connected, just restart the shell
          dockerTerminal.restartShell();
        }

        return;
      }

      if (sessionInfo?.status === 'error' || sessionInfo?.status === 'stopped') {
        throw new Error(sessionInfo.error || 'Container is not running');
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay);
    }

    throw new Error('Timeout waiting for container to be ready');
  }

  /**
   * Restart the session by deleting and recreating it.
   * This is a more aggressive recovery option when retry doesn't work.
   */
  async restartSession(): Promise<void> {
    if (!this._lessonTemplate) {
      throw new Error('No lesson template available to restart session');
    }

    this.lessonFullyLoaded.set(false);

    // shutdown existing session
    await this._dockerRuntime.shutdown();

    // boot a new session with the template
    await this._dockerRuntime.boot(this._lessonTemplate);

    // reconnect all terminals
    const config = this._terminalStore.terminalConfig.get();

    for (const panel of config.panels) {
      if (panel.dockerTerminal && panel.terminal) {
        panel.dockerTerminal.clearContainerError();

        // re-attach will reconnect
        this._dockerRuntime.attachTerminal(panel.id, panel.terminal);
      }
    }

    // re-run commands if we have lesson files
    if (this._lessonFiles) {
      await this._runner.updateFiles(this._lessonFiles);
      this._runner.runCommands();
    }

    this.lessonFullyLoaded.set(true);
  }

  /** Callback that should be called when terminal resizes */
  onTerminalResize(cols: number, rows: number) {
    if (cols && rows) {
      this._terminalStore.onTerminalResize(cols, rows);
      this._runner.onTerminalResize(cols, rows);
    }
  }

  /** Listen for file changes made in the editor */
  onDocumentChanged(filePath: string, callback: (document: Readonly<EditorDocument>) => void) {
    return this._editorStore.onDocumentChanged(filePath, callback);
  }

  /** Take snapshot of the current state of the lesson */
  takeSnapshot() {
    return this._runner.takeSnapshot();
  }

  /** Shutdown the Docker runtime */
  async shutdown() {
    await this._dockerRuntime.shutdown();
  }
}
