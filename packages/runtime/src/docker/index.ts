import { atom, type ReadableAtom } from 'nanostores';
import { DockerClient } from './client.js';
import { DockerFileSystem } from './fs.js';
import { DockerPreviews, type PreviewInfo } from './previews.js';
import { DockerTerminal, type ITerminal } from './terminal.js';
import type { DockerRuntimeConfig, Files, HealthResponse } from './types.js';

export type BootStatus = 'unknown' | 'checking' | 'connecting' | 'connected' | 'error';

export class DockerRuntime {
  private _client: DockerClient;
  private _fs: DockerFileSystem;
  private _previews: DockerPreviews;
  private _terminals: Map<string, DockerTerminal> = new Map();
  private _bootStatus = atom<BootStatus>('unknown');
  private _bootError = atom<string | undefined>(undefined);

  constructor(config?: DockerRuntimeConfig) {
    this._client = new DockerClient(config);
    this._fs = new DockerFileSystem(this._client);
    this._previews = new DockerPreviews(this._client);
  }

  get bootStatus(): ReadableAtom<BootStatus> {
    return this._bootStatus;
  }

  get bootError(): ReadableAtom<string | undefined> {
    return this._bootError;
  }

  get previews(): ReadableAtom<PreviewInfo[]> {
    return this._previews.previews;
  }

  get sessionId(): string | null {
    return this._client.sessionId;
  }

  get backendUrl(): string {
    return this._client.backendUrl;
  }

  set backendUrl(url: string) {
    this._client.backendUrl = url;
  }

  async checkHealth(): Promise<HealthResponse> {
    this._bootStatus.set('checking');

    const health = await this._client.checkHealth();

    if (health.status === 'ok') {
      this._bootStatus.set('unknown');
      this._bootError.set(undefined);
    } else {
      this._bootStatus.set('error');
      this._bootError.set(health.docker.error || health.message);
    }

    return health;
  }

  async boot(files: Files): Promise<void> {
    this._bootStatus.set('connecting');
    this._bootError.set(undefined);

    try {
      await this._client.createSession(files);

      this._bootStatus.set('connected');
      this._previews.startPolling();
    } catch (error) {
      this._bootStatus.set('error');
      this._bootError.set(error instanceof Error ? error.message : 'Failed to start session');
      throw error;
    }
  }

  async writeFiles(files: Files): Promise<void> {
    await this._fs.writeFiles(files);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this._fs.writeFile(path, content);
  }

  setExpectedPorts(ports: number[]): void {
    this._previews.setExpectedPorts(ports);
  }

  getTerminal(terminalId: string = 'main'): DockerTerminal {
    let terminal = this._terminals.get(terminalId);

    if (!terminal) {
      terminal = new DockerTerminal(this._client, terminalId);
      this._terminals.set(terminalId, terminal);
    }

    return terminal;
  }

  attachTerminal(terminalId: string, terminal: ITerminal): DockerTerminal {
    const dockerTerminal = this.getTerminal(terminalId);
    dockerTerminal.attach(terminal);

    if (this._client.sessionId && !dockerTerminal.isConnected) {
      dockerTerminal.connect().catch((error) => {
        console.error('Failed to connect terminal:', error);
      });
    }

    return dockerTerminal;
  }

  async shutdown(): Promise<void> {
    // disconnect all terminals
    for (const terminal of this._terminals.values()) {
      terminal.disconnect();
    }
    this._terminals.clear();

    // stop preview polling
    this._previews.reset();

    // delete session
    await this._client.deleteSession();

    this._bootStatus.set('unknown');
  }
}

export { DockerClient } from './client.js';
export { DockerFileSystem } from './fs.js';
export { DockerPreviews, type PreviewInfo } from './previews.js';
export { DockerTerminal, type ITerminal } from './terminal.js';
export { EditorConfig } from './editor-config.js';
export { createTerminalConfig, type TerminalConfig } from './terminal-config.js';
export type { DockerRuntimeConfig, Files, HealthResponse, PortMapping, SessionInfo, TerminalMessage } from './types.js';
