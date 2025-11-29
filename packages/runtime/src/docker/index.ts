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
  private _pendingTerminals: Set<string> = new Set();
  private _bootStatus = atom<BootStatus>('unknown');
  private _bootError = atom<string | undefined>(undefined);
  private _containerReady = atom<boolean>(false);
  private _containerReadyPromise: Promise<void> | null = null;

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

  async checkSessionInfo() {
    return this._client.getSessionInfo();
  }

  async boot(files: Files): Promise<void> {
    this._bootStatus.set('connecting');
    this._bootError.set(undefined);
    this._containerReady.set(false);
    this._containerReadyPromise = null;

    try {
      await this._client.createSession(files);

      this._bootStatus.set('connected');
      this._previews.startPolling();

      // start container readiness check in background and connect pending terminals
      this._startContainerReadyPolling();
    } catch (error) {
      this._bootStatus.set('error');
      this._bootError.set(error instanceof Error ? error.message : 'Failed to start session');
      throw error;
    }
  }

  /**
   * Wait for container to be ready. Multiple callers will share the same promise.
   * Call this before connecting terminals to ensure the container is running.
   */
  async waitForContainerReady(): Promise<void> {
    if (this._containerReady.get()) {
      return;
    }

    if (!this._containerReadyPromise) {
      this._containerReadyPromise = this._pollContainerReady();
    }

    return this._containerReadyPromise;
  }

  /**
   * Start polling for container readiness in the background.
   * Connects pending terminals once ready.
   */
  private _startContainerReadyPolling(): void {
    this.waitForContainerReady()
      .then(() => {
        // connect any terminals that were attached before the container was ready
        for (const terminalId of this._pendingTerminals) {
          const dockerTerminal = this._terminals.get(terminalId);

          if (dockerTerminal && !dockerTerminal.isConnected) {
            dockerTerminal.connect().catch((error) => {
              console.error(`Failed to connect pending terminal ${terminalId}:`, error);
            });
          }
        }

        this._pendingTerminals.clear();
      })
      .catch((error) => {
        console.error('Container failed to become ready:', error);
      });
  }

  /**
   * Poll session info until container is ready, with exponential backoff.
   * Times out after 30 seconds.
   */
  private async _pollContainerReady(): Promise<void> {
    const maxWaitTime = 30000; // 30 seconds
    const initialDelay = 500;
    const maxDelay = 4000;
    const startTime = Date.now();
    let delay = initialDelay;

    while (Date.now() - startTime < maxWaitTime) {
      const sessionInfo = await this._client.getSessionInfo();

      if (sessionInfo?.containerReady) {
        this._containerReady.set(true);
        return;
      }

      if (sessionInfo?.status === 'error' || sessionInfo?.status === 'stopped') {
        throw new Error(sessionInfo.error || 'Container failed to start');
      }

      await new Promise((resolve) => setTimeout(resolve, delay));
      delay = Math.min(delay * 1.5, maxDelay); // exponential backoff with cap
    }

    throw new Error('Timeout waiting for container to be ready');
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

    if (this._client.sessionId) {
      // session exists, wait for container to be ready then connect
      if (!dockerTerminal.isConnected) {
        this.waitForContainerReady()
          .then(() => {
            if (!dockerTerminal.isConnected) {
              dockerTerminal.connect().catch((error) => {
                console.error('Failed to connect terminal:', error);
              });
            }
          })
          .catch((error) => {
            console.error('Failed to wait for container:', error);
          });
      }
    } else {
      // session not yet created, mark as pending for connection after boot()
      this._pendingTerminals.add(terminalId);
    }

    return dockerTerminal;
  }

  async shutdown(): Promise<void> {
    // disconnect all terminals
    for (const terminal of this._terminals.values()) {
      terminal.disconnect();
    }
    this._terminals.clear();
    this._pendingTerminals.clear();

    // stop preview polling
    this._previews.reset();

    // delete session
    await this._client.deleteSession();

    // reset container ready state
    this._containerReady.set(false);
    this._containerReadyPromise = null;

    this._bootStatus.set('unknown');
  }
}

export { DockerClient } from './client.js';
export { EditorConfig } from './editor-config.js';
export { DockerFileSystem } from './fs.js';
export { DockerPreviews, type PreviewInfo } from './previews.js';
export { DockerTerminal, type ITerminal } from './terminal.js';
export { createTerminalConfig, type TerminalConfig } from './terminal-config.js';
export type { DockerRuntimeConfig, Files, HealthResponse, PortMapping, SessionInfo, TerminalMessage } from './types.js';
