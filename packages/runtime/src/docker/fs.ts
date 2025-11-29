import type { DockerClient } from './client.js';
import type { Files } from './types.js';

export class DockerFileSystem {
  private _client: DockerClient;

  constructor(client: DockerClient) {
    this._client = client;
  }

  async writeFiles(files: Files): Promise<void> {
    await this._client.writeFiles(files);
  }

  async writeFile(path: string, content: string | Uint8Array): Promise<void> {
    await this._client.writeFiles({ [path]: content });
  }
}
