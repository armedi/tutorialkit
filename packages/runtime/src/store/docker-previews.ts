import type { PreviewSchema } from '@tutorialkit/types';
import { atom, type ReadableAtom } from 'nanostores';
import type { DockerRuntime } from '../docker/index.js';
import type { PreviewInfo } from '../docker/previews.js';

export class DockerPreviewsStore {
  private _dockerRuntime: DockerRuntime;

  constructor(dockerRuntime: DockerRuntime) {
    this._dockerRuntime = dockerRuntime;
  }

  get previews(): ReadableAtom<PreviewInfo[]> {
    return this._dockerRuntime.previews;
  }

  setPreviews(config: PreviewSchema) {
    if (config === false) {
      this._dockerRuntime.setExpectedPorts([]);
      return;
    }

    if (config === true) {
      // use default ports from docker-compose
      this._dockerRuntime.setExpectedPorts([]);
      return;
    }

    // extract ports from config
    const ports: number[] = [];

    for (const preview of config) {
      if (typeof preview === 'number') {
        ports.push(preview);
      } else if (typeof preview === 'string') {
        // "3000" or "3000/path"
        const port = parseInt(preview.split('/')[0], 10);

        if (!isNaN(port)) {
          ports.push(port);
        }
      } else if (Array.isArray(preview)) {
        // [3000, "title"]
        if (typeof preview[0] === 'number') {
          ports.push(preview[0]);
        }
      } else if (typeof preview === 'object' && preview.port) {
        ports.push(preview.port);
      }
    }

    this._dockerRuntime.setExpectedPorts(ports);
  }
}
