import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { URL } from 'node:url';
import { checkDockerHealth } from './docker.js';
import {
  createSession,
  deleteSession,
  getSessionInfo,
  getSessionPorts,
  writeSessionFiles,
} from './sessions.js';
import { handleTerminalConnection, killAllProcesses } from './terminal.js';
import type { CreateSessionRequest, WriteFilesRequest, HealthResponse } from './types.js';

interface ServerOptions {
  port: number;
  host: string;
}

export function createBackendServer(options: ServerOptions) {
  const { port, host } = options;

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: '50mb' }));

  // health check
  app.get('/health', async (_req: Request, res: Response) => {
    const dockerHealth = await checkDockerHealth();

    const response: HealthResponse = {
      status: dockerHealth.available ? 'ok' : 'error',
      docker: dockerHealth,
      message: dockerHealth.available
        ? 'TutorialKit backend is running'
        : dockerHealth.error,
    };

    res.status(dockerHealth.available ? 200 : 503).json(response);
  });

  // create session
  app.post('/sessions', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { files } = req.body as CreateSessionRequest;

      if (!files || typeof files !== 'object') {
        res.status(400).json({ error: 'Missing or invalid files object' });
        return;
      }

      const { session, output } = await createSession(files);

      res.status(201).json({
        id: session.id,
        output,
      });
    } catch (error) {
      next(error);
    }
  });

  // get session info
  app.get('/sessions/:sessionId', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const info = await getSessionInfo(sessionId);

    if (!info) {
      res.status(404).json({ error: 'Session not found' });
      return;
    }

    res.json(info);
  });

  // get session ports
  app.get('/sessions/:sessionId/ports', async (req: Request, res: Response) => {
    const { sessionId } = req.params;
    const ports = await getSessionPorts(sessionId);
    res.json({ ports });
  });

  // write files to session
  app.post('/sessions/:sessionId/files', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const { files } = req.body as WriteFilesRequest;

      if (!files || typeof files !== 'object') {
        res.status(400).json({ error: 'Missing or invalid files object' });
        return;
      }

      await writeSessionFiles(sessionId, files);
      res.json({ success: true });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  // delete session
  app.delete('/sessions/:sessionId', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { sessionId } = req.params;
      const output = await deleteSession(sessionId);
      res.json({ success: true, output });
    } catch (error) {
      if (error instanceof Error && error.message.includes('not found')) {
        res.status(404).json({ error: error.message });
        return;
      }
      next(error);
    }
  });

  // error handler
  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: error.message,
    });
  });

  // create HTTP server
  const server = createServer(app);

  // create WebSocket server for terminals
  const wss = new WebSocketServer({ server });

  wss.on('connection', (ws: WebSocket, req) => {
    const url = new URL(req.url || '', `http://${req.headers.host}`);
    const pathParts = url.pathname.split('/');

    // expect: /sessions/:sessionId/terminal
    if (pathParts[1] === 'sessions' && pathParts[3] === 'terminal') {
      const sessionId = pathParts[2];
      const terminalId = url.searchParams.get('terminalId') || 'main';
      handleTerminalConnection(ws, sessionId, terminalId);
    } else {
      ws.close(4000, 'Invalid WebSocket path');
    }
  });

  // graceful shutdown
  const shutdown = () => {
    console.log('\nShutting down...');
    killAllProcesses();
    wss.close();
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  return {
    start: () => {
      server.listen(port, host, () => {
        console.log(`TutorialKit backend running at http://${host}:${port}`);
        console.log(`Health check: http://${host}:${port}/health`);
      });
    },
    stop: () => {
      killAllProcesses();
      wss.close();
      server.close();
    },
  };
}
