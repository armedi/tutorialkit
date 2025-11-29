import type { Exec } from 'dockerode';
import type { WebSocket } from 'ws';

import { getContainerByProject } from './docker.js';
import { addTerminalToSession, getSession, removeTerminalFromSession, updateSessionActivity } from './sessions.js';

interface TerminalSize {
  cols: number;
  rows: number;
}

interface ActiveTerminal {
  exec: Exec;
  stream: NodeJS.ReadWriteStream;
}

const activeTerminals = new Map<string, ActiveTerminal>();

export function handleTerminalConnection(ws: WebSocket, sessionId: string, terminalId: string): void {
  const session = getSession(sessionId);

  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  const terminal = addTerminalToSession(sessionId, terminalId);
  let currentSize: TerminalSize = { cols: 80, rows: 24 };
  const terminalKey = `${sessionId}:${terminalId}`;

  // start a shell in the container using dockerode exec
  const startShell = async () => {
    try {
      // get container - either from session or by looking it up
      let container = session.container;

      if (!container) {
        const projectName = `tutorialkit-${sessionId}`;
        container = await getContainerByProject(projectName, 'app');

        if (container) {
          session.container = container;
        }
      }

      if (!container) {
        ws.send(JSON.stringify({ type: 'error', message: 'Container not found' }));
        return;
      }

      // create exec instance with TTY enabled
      const exec = await container.exec({
        Cmd: ['/bin/sh'],
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Env: ['TERM=xterm-256color'],
      });

      // start exec with hijack mode for bidirectional streaming
      const stream = await exec.start({
        hijack: true,
        stdin: true,
        Tty: true,
      });

      // store exec reference for resize operations
      terminal.exec = exec;
      terminal.stream = stream;
      activeTerminals.set(terminalKey, { exec, stream });

      // set initial terminal size
      try {
        await exec.resize({ h: currentSize.rows, w: currentSize.cols });
      } catch {
        // resize may fail if terminal not ready, ignore
      }

      // stream output to WebSocket
      stream.on('data', (chunk: Buffer) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'output', data: chunk.toString() }));
        }
      });

      stream.on('end', () => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exit', code: 0 }));
        }

        activeTerminals.delete(terminalKey);
      });

      stream.on('error', (error: Error) => {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'error', message: error.message }));
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';

      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: `Failed to start shell: ${message}` }));
      }
    }
  };

  // handle messages from client
  ws.on('message', async (message: Buffer) => {
    updateSessionActivity(sessionId);

    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'start': {
          if (!activeTerminals.has(terminalKey)) {
            if (data.size) {
              currentSize = data.size;
            }

            await startShell();
          }

          break;
        }

        case 'input': {
          const activeTerminal = activeTerminals.get(terminalKey);

          if (activeTerminal?.stream.writable) {
            activeTerminal.stream.write(data.data);
          }

          break;
        }

        case 'resize': {
          if (data.cols && data.rows) {
            currentSize = { cols: data.cols, rows: data.rows };

            const activeTerminal = activeTerminals.get(terminalKey);

            if (activeTerminal?.exec) {
              try {
                await activeTerminal.exec.resize({ h: data.rows, w: data.cols });
              } catch {
                // resize may fail, ignore
              }
            }
          }

          break;
        }

        case 'exec': {
          // execute a command in the container (non-interactive)
          await execCommand(session.container, data.command, ws);
          break;
        }
      }
    } catch {
      // invalid JSON, treat as raw input
      const activeTerminal = activeTerminals.get(terminalKey);

      if (activeTerminal?.stream.writable) {
        activeTerminal.stream.write(message.toString());
      }
    }
  });

  ws.on('close', () => {
    const activeTerminal = activeTerminals.get(terminalKey);

    if (activeTerminal?.stream) {
      activeTerminal.stream.end();
    }

    activeTerminals.delete(terminalKey);
    removeTerminalFromSession(sessionId, terminalId);
  });

  ws.on('error', (error) => {
    console.error(`Terminal WebSocket error for session ${sessionId}:`, error);
  });
}

async function execCommand(
  container: import('dockerode').Container | undefined,
  command: string,
  ws: WebSocket,
): Promise<void> {
  if (!container) {
    ws.send(JSON.stringify({ type: 'error', message: 'Container not found' }));
    return;
  }

  try {
    const exec = await container.exec({
      Cmd: ['/bin/sh', '-c', command],
      AttachStdout: true,
      AttachStderr: true,
      Tty: false,
    });

    const stream = await exec.start({ hijack: true, stdin: false });

    /**
     * For non-TTY, we need to demux stdout/stderr
     * the stream contains both multiplexed.
     */
    stream.on('data', (chunk: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        /**
         * Skip the 8-byte header that Docker uses for multiplexing
         * header format: [stream_type(1), 0, 0, 0, size(4)]
         */
        let offset = 0;

        while (offset < chunk.length) {
          if (offset + 8 > chunk.length) {
            break;
          }

          const size = chunk.readUInt32BE(offset + 4);

          if (offset + 8 + size > chunk.length) {
            break;
          }

          const payload = chunk.slice(offset + 8, offset + 8 + size);
          ws.send(JSON.stringify({ type: 'output', data: payload.toString() }));
          offset += 8 + size;
        }
      }
    });

    stream.on('end', async () => {
      // get exit code from exec inspect
      try {
        const info = await exec.inspect();

        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exec-complete', code: info.ExitCode }));
        }
      } catch {
        if (ws.readyState === ws.OPEN) {
          ws.send(JSON.stringify({ type: 'exec-complete', code: null }));
        }
      }
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';

    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'error', message: `Failed to execute command: ${message}` }));
    }
  }
}

export function killAllProcesses(): void {
  for (const [key, terminal] of activeTerminals) {
    if (terminal.stream) {
      terminal.stream.end();
    }

    activeTerminals.delete(key);
  }
}
