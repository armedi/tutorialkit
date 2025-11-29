import { atom, type ReadableAtom } from 'nanostores';
import type { DockerClient } from './client.js';
import type { PortMapping } from './types.js';

export interface PreviewInfo {
  port: number;
  url: string;
  title?: string;
  pathname?: string;
  ready: boolean;
}

export class DockerPreviews {
  private _client: DockerClient;
  private _previews = atom<PreviewInfo[]>([]);
  private _pollInterval: ReturnType<typeof setInterval> | null = null;
  private _expectedPorts: number[] = [];

  constructor(client: DockerClient) {
    this._client = client;
  }

  get previews(): ReadableAtom<PreviewInfo[]> {
    return this._previews;
  }

  setExpectedPorts(ports: number[]): void {
    this._expectedPorts = ports;
    this._updatePreviews();
  }

  startPolling(intervalMs: number = 2000): void {
    if (this._pollInterval) {
      return;
    }

    this._pollInterval = setInterval(() => {
      this._updatePreviews();
    }, intervalMs);

    // immediate update
    this._updatePreviews();
  }

  stopPolling(): void {
    if (this._pollInterval) {
      clearInterval(this._pollInterval);
      this._pollInterval = null;
    }
  }

  private async _updatePreviews(): Promise<void> {
    const portMappings = await this._client.getSessionPorts();
    const previews: PreviewInfo[] = [];

    for (const mapping of portMappings) {
      // only include ports that are expected
      if (this._expectedPorts.length > 0 && !this._expectedPorts.includes(mapping.containerPort)) {
        continue;
      }

      previews.push({
        port: mapping.containerPort,
        url: `http://localhost:${mapping.hostPort}`,
        ready: true,
      });
    }

    // add expected ports that aren't ready yet
    for (const port of this._expectedPorts) {
      if (!previews.some((p) => p.port === port)) {
        previews.push({
          port,
          url: `http://localhost:${port}`,
          ready: false,
        });
      }
    }

    this._previews.set(previews);
  }

  reset(): void {
    this.stopPolling();
    this._previews.set([]);
    this._expectedPorts = [];
  }
}
