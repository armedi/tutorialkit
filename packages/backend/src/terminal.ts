import { spawn, type ChildProcess } from 'node:child_process';
import type { WebSocket } from 'ws';
import {
  getSession,
  addTerminalToSession,
  removeTerminalFromSession,
  updateSessionActivity,
} from './sessions.js';

interface TerminalSize {
  cols: number;
  rows: number;
}

const activeProcesses = new Map<string, ChildProcess>();

export function handleTerminalConnection(
  ws: WebSocket,
  sessionId: string,
  terminalId: string,
): void {
  const session = getSession(sessionId);
  if (!session) {
    ws.close(4004, 'Session not found');
    return;
  }

  const terminal = addTerminalToSession(sessionId, terminalId);
  let shellProcess: ChildProcess | null = null;
  let currentSize: TerminalSize = { cols: 80, rows: 24 };

  // start a shell in the container
  const startShell = () => {
    // use docker compose exec to run shell in the service container
    shellProcess = spawn(
      'docker',
      ['compose', 'exec', '-it', '-T', 'app', '/bin/sh'],
      {
        cwd: session.tempDir,
        env: {
          ...process.env,
          TERM: 'xterm-256color',
          COLUMNS: String(currentSize.cols),
          LINES: String(currentSize.rows),
        },
      },
    );

    const processKey = `${sessionId}:${terminalId}`;
    activeProcesses.set(processKey, shellProcess);

    shellProcess.stdout?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      }
    });

    shellProcess.stderr?.on('data', (data: Buffer) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
      }
    });

    shellProcess.on('close', (code: number | null) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'exit', code }));
      }
      activeProcesses.delete(processKey);
    });

    shellProcess.on('error', (error: Error) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify({ type: 'error', message: error.message }));
      }
    });
  };

  // handle messages from client
  ws.on('message', (message: Buffer) => {
    updateSessionActivity(sessionId);

    try {
      const data = JSON.parse(message.toString());

      switch (data.type) {
        case 'start':
          if (!shellProcess) {
            if (data.size) {
              currentSize = data.size;
            }
            startShell();
          }
          break;

        case 'input':
          if (shellProcess?.stdin?.writable) {
            shellProcess.stdin.write(data.data);
          }
          break;

        case 'resize':
          if (data.cols && data.rows) {
            currentSize = { cols: data.cols, rows: data.rows };
            // docker exec doesn't support resize directly, but we track it
          }
          break;

        case 'exec':
          // execute a command in the container (non-interactive)
          execCommand(session.tempDir, data.command, ws);
          break;
      }
    } catch {
      // invalid JSON, treat as raw input
      if (shellProcess?.stdin?.writable) {
        shellProcess.stdin.write(message.toString());
      }
    }
  });

  ws.on('close', () => {
    if (shellProcess) {
      shellProcess.kill();
      const processKey = `${sessionId}:${terminalId}`;
      activeProcesses.delete(processKey);
    }
    removeTerminalFromSession(sessionId, terminalId);
  });

  ws.on('error', (error) => {
    console.error(`Terminal WebSocket error for session ${sessionId}:`, error);
  });
}

async function execCommand(tempDir: string, command: string, ws: WebSocket): Promise<void> {
  const proc = spawn('docker', ['compose', 'exec', '-T', 'app', '/bin/sh', '-c', command], {
    cwd: tempDir,
  });

  proc.stdout?.on('data', (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  proc.stderr?.on('data', (data: Buffer) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'output', data: data.toString() }));
    }
  });

  proc.on('close', (code: number | null) => {
    if (ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify({ type: 'exec-complete', code }));
    }
  });
}

export function killAllProcesses(): void {
  for (const [key, proc] of activeProcesses) {
    proc.kill();
    activeProcesses.delete(key);
  }
}
