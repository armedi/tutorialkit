import type { DockerRuntimeConfig, Files, HealthResponse, PortMapping, SessionInfo } from './types.js';

const BACKEND_URL_KEY = 'tutorialkit:backendUrl';
const DEFAULT_BACKEND_URL = 'http://localhost:3001';

export class DockerClient {
  private _backendUrl: string;
  private _sessionId: string | null = null;

  constructor(config?: DockerRuntimeConfig) {
    this._backendUrl = config?.backendUrl || this._getStoredBackendUrl() || DEFAULT_BACKEND_URL;
  }

  private _getStoredBackendUrl(): string | null {
    if (typeof localStorage !== 'undefined') {
      return localStorage.getItem(BACKEND_URL_KEY);
    }

    return null;
  }

  get backendUrl(): string {
    return this._backendUrl;
  }

  set backendUrl(url: string) {
    this._backendUrl = url;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(BACKEND_URL_KEY, url);
    }
  }

  get sessionId(): string | null {
    return this._sessionId;
  }

  async checkHealth(): Promise<HealthResponse> {
    try {
      const response = await fetch(`${this._backendUrl}/health`);
      return await response.json();
    } catch (error) {
      return {
        status: 'error',
        docker: {
          available: false,
          error: `Cannot connect to backend at ${this._backendUrl}. ${error instanceof Error ? error.message : 'Unknown error'}`,
        },
        message: 'Backend server is not reachable',
      };
    }
  }

  async createSession(files: Files): Promise<{ id: string; output: string }> {
    // convert Uint8Array to base64 for transport
    const transportFiles: Record<string, string | { base64: string }> = {};

    for (const [path, content] of Object.entries(files)) {
      if (content instanceof Uint8Array) {
        transportFiles[path] = { base64: btoa(String.fromCharCode(...content)) };
      } else {
        transportFiles[path] = content;
      }
    }

    const response = await fetch(`${this._backendUrl}/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: transportFiles }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create session');
    }

    const result = await response.json();
    this._sessionId = result.id;

    return result;
  }

  async getSessionInfo(): Promise<SessionInfo | null> {
    if (!this._sessionId) {
      return null;
    }

    try {
      const response = await fetch(`${this._backendUrl}/sessions/${this._sessionId}`);

      if (!response.ok) {
        if (response.status === 404) {
          return null;
        }

        throw new Error('Failed to get session info');
      }

      return await response.json();
    } catch {
      return null;
    }
  }

  async getSessionPorts(): Promise<PortMapping[]> {
    if (!this._sessionId) {
      return [];
    }

    try {
      const response = await fetch(`${this._backendUrl}/sessions/${this._sessionId}/ports`);

      if (!response.ok) {
        return [];
      }

      const result = await response.json();

      return result.ports || [];
    } catch {
      return [];
    }
  }

  async writeFiles(files: Files): Promise<void> {
    if (!this._sessionId) {
      throw new Error('No active session');
    }

    // convert Uint8Array to base64 for transport
    const transportFiles: Record<string, string | { base64: string }> = {};

    for (const [path, content] of Object.entries(files)) {
      if (content instanceof Uint8Array) {
        transportFiles[path] = { base64: btoa(String.fromCharCode(...content)) };
      } else {
        transportFiles[path] = content;
      }
    }

    const response = await fetch(`${this._backendUrl}/sessions/${this._sessionId}/files`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ files: transportFiles }),
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to write files');
    }
  }

  async deleteSession(): Promise<void> {
    if (!this._sessionId) {
      return;
    }

    try {
      await fetch(`${this._backendUrl}/sessions/${this._sessionId}`, {
        method: 'DELETE',
      });
    } finally {
      this._sessionId = null;
    }
  }

  createTerminalWebSocket(terminalId: string = 'main'): WebSocket {
    if (!this._sessionId) {
      throw new Error('No active session');
    }

    const wsUrl = this._backendUrl.replace(/^http/, 'ws');

    return new WebSocket(`${wsUrl}/sessions/${this._sessionId}/terminal?terminalId=${terminalId}`);
  }
}
