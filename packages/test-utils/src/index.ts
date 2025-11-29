import path from 'node:path';
import { vi, type Mocked } from 'vitest';

interface FileNode {
  file: {
    contents: string | Uint8Array;
  };
}

interface DirectoryNode {
  directory: FileSystemTree;
}

type FileSystemTree = Record<string, FileNode | DirectoryNode>;

interface FakeTerminal {
  id: string;
  onData: ((data: string) => void) | null;
  write(data: string): void;
}

export interface MockedDockerRuntime {
  _fakeFs: FileSystemTree;
  _fakeTerminals: FakeTerminal[];
  boot(): Promise<void>;
  writeFiles(files: Record<string, string | { base64: string }>): Promise<void>;
  readFile(filePath: string): Promise<string>;
  fileExists(filePath: string): Promise<boolean>;
  folderExists(folderPath: string): Promise<boolean>;
  createFolder(folderPath: string): Promise<void>;
  getTerminal(id: string): FakeTerminal;
  shutdown(): Promise<void>;
}

export function createMockDockerRuntime(): Mocked<MockedDockerRuntime> {
  const runtime: MockedDockerRuntime = {
    _fakeFs: {},
    _fakeTerminals: [],

    boot: vi.fn(async () => {
      // Simulate boot delay
    }),

    writeFiles: vi.fn(async function (this: MockedDockerRuntime, files) {
      for (const [filePath, contents] of Object.entries(files)) {
        const parentFolder = path.dirname(filePath);
        let folderNode = getDirNode(this._fakeFs, parentFolder);

        if (!folderNode) {
          // Create parent directories
          const segments = parentFolder.split('/').filter(Boolean);
          let current = this._fakeFs;

          for (const segment of segments) {
            if (!current[segment]) {
              current[segment] = { directory: {} };
            }

            current = (current[segment] as DirectoryNode).directory;
          }

          folderNode = getDirNode(this._fakeFs, parentFolder);
        }

        if (folderNode) {
          const value = typeof contents === 'string' ? contents : atob(contents.base64);
          folderNode.directory[path.basename(filePath)] = { file: { contents: value } };
        }
      }
    }),

    readFile: vi.fn(async function (this: MockedDockerRuntime, filePath: string) {
      const fileNode = getFileNode(this._fakeFs, filePath);

      if (!fileNode) {
        throw new Error(`No file found at ${filePath}`);
      }

      return fileNode.file.contents as string;
    }),

    fileExists: vi.fn(async function (this: MockedDockerRuntime, filePath: string) {
      return !!getFileNode(this._fakeFs, filePath);
    }),

    folderExists: vi.fn(async function (this: MockedDockerRuntime, folderPath: string) {
      return !!getDirNode(this._fakeFs, folderPath);
    }),

    createFolder: vi.fn(async function (this: MockedDockerRuntime, folderPath: string) {
      const segments = folderPath.split('/').filter(Boolean);
      let current = this._fakeFs;

      for (const segment of segments) {
        if (!current[segment]) {
          current[segment] = { directory: {} };
        }

        current = (current[segment] as DirectoryNode).directory;
      }
    }),

    getTerminal: vi.fn(function (this: MockedDockerRuntime, id: string) {
      let terminal = this._fakeTerminals.find((t) => t.id === id);

      if (!terminal) {
        terminal = {
          id,
          onData: null,
          write: vi.fn(),
        };
        this._fakeTerminals.push(terminal);
      }

      return terminal;
    }),

    shutdown: vi.fn(async () => {
      // Cleanup
    }),
  };

  return runtime as Mocked<MockedDockerRuntime>;
}

function getFileNode(tree: FileSystemTree, filePath: string): FileNode | undefined {
  const node = getNode(tree, filePath);

  if (node && 'file' in node) {
    return node;
  }

  return undefined;
}

function getDirNode(tree: FileSystemTree, filePath: string): DirectoryNode | undefined {
  const node = getNode(tree, filePath);

  if (node && 'directory' in node) {
    return node;
  }

  return undefined;
}

function getNode(tree: FileSystemTree, filePath: string): FileNode | DirectoryNode | undefined {
  const segments = filePath.split('/');

  for (let i = 0; i < segments.length; ++i) {
    const segment = segments[i];

    if (segment.length === 0) {
      continue;
    }

    const node = tree[segment];

    if (!node) {
      return undefined;
    }

    // if we reached the end of the path
    if (i === segments.length - 1) {
      return node;
    }

    // if not we continue if it's a directory
    if ('directory' in node) {
      tree = node.directory;
      continue;
    }

    // if the path think the current segment is not a file then we need to return undefined
    return undefined;
  }

  return undefined;
}
