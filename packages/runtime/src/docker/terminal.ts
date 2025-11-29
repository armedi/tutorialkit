import type { DockerClient } from './client.js';
import type { TerminalMessage } from './types.js';

export interface ITerminal {
  cols?: number;
  rows?: number;
  reset(): void;
  write(data: string): void;
  input(data: string): void;
  onData(callback: (data: string) => void): void;
}

export class DockerTerminal {
  private _client: DockerClient;
  private _terminalId: string;
  private _ws: WebSocket | null = null;
  private _terminal: ITerminal | null = null;
  private _isStarted = false;
  private _reconnectAttempts = 0;
  private _maxReconnectAttempts = 3;

  constructor(client: DockerClient, terminalId: string = 'main') {
    this._client = client;
    this._terminalId = terminalId;
  }

  get isConnected(): boolean {
    return this._ws?.readyState === WebSocket.OPEN;
  }

  attach(terminal: ITerminal): void {
    this._terminal = terminal;

    // set up terminal input handler
    terminal.onData((data: string) => {
      if (this._ws?.readyState === WebSocket.OPEN) {
        this._sendMessage({ type: 'input', data });
      }
    });

    // if already connected, start the shell
    if (this._ws?.readyState === WebSocket.OPEN && !this._isStarted) {
      this._startShell();
    }
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this._ws = this._client.createTerminalWebSocket(this._terminalId);

        this._ws.onopen = () => {
          this._reconnectAttempts = 0;

          if (this._terminal) {
            this._startShell();
          }

          resolve();
        };

        this._ws.onmessage = (event) => {
          this._handleMessage(event.data);
        };

        this._ws.onclose = () => {
          this._isStarted = false;
          this._attemptReconnect();
        };

        this._ws.onerror = (error) => {
          reject(error);
        };
      } catch (error) {
        reject(error);
      }
    });
  }

  private _startShell(): void {
    if (this._isStarted) {
      return;
    }

    this._sendMessage({
      type: 'start',
      size: {
        cols: this._terminal?.cols ?? 80,
        rows: this._terminal?.rows ?? 24,
      },
    });

    this._isStarted = true;
  }

  private _handleMessage(data: string): void {
    try {
      const message: TerminalMessage = JSON.parse(data);

      switch (message.type) {
        case 'output':
          if (message.data && this._terminal) {
            this._terminal.write(message.data);
          }
          break;

        case 'exit':
          // shell exited
          this._isStarted = false;
          break;

        case 'error':
          if (message.message && this._terminal) {
            this._terminal.write(`\r\n\x1b[31mError: ${message.message}\x1b[0m\r\n`);
          }
          break;

        case 'exec-complete':
          // command execution completed
          break;
      }
    } catch {
      // not JSON, treat as raw output
      if (this._terminal) {
        this._terminal.write(data);
      }
    }
  }

  private _sendMessage(message: TerminalMessage): void {
    if (this._ws?.readyState === WebSocket.OPEN) {
      this._ws.send(JSON.stringify(message));
    }
  }

  private _attemptReconnect(): void {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      return;
    }

    this._reconnectAttempts++;

    setTimeout(() => {
      if (this._client.sessionId) {
        this.connect().catch(() => {
          // reconnect failed
        });
      }
    }, 1000 * this._reconnectAttempts);
  }

  resize(cols: number, rows: number): void {
    this._sendMessage({ type: 'resize', cols, rows });
  }

  exec(command: string): void {
    this._sendMessage({ type: 'exec', command });
  }

  write(data: string): void {
    this._sendMessage({ type: 'input', data });
  }

  disconnect(): void {
    if (this._ws) {
      this._ws.close();
      this._ws = null;
    }
    this._isStarted = false;
    this._terminal = null;
  }
}
