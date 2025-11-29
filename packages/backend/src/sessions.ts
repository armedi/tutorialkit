import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { parse as parseYaml } from 'yaml';

import { createCompose, getContainerByProject, getContainerByProjectWithRetry } from './docker.js';
import type { PortMapping, Session, SessionInfo, TerminalSession } from './types.js';

const sessions = new Map<string, Session>();
const sessionCleanupTimers = new Map<string, NodeJS.Timeout>();

const SESSION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export function getSession(sessionId: string): Session | undefined {
  return sessions.get(sessionId);
}

export function getAllSessions(): Session[] {
  return Array.from(sessions.values());
}

export async function createSession(
  files: Record<string, string | { base64: string }>,
): Promise<{ session: Session; output: string }> {
  const sessionId = uuidv4();
  const tempDir = path.join(os.tmpdir(), `tutorialkit-${sessionId}`);

  // create temp directory
  await fs.mkdir(tempDir, { recursive: true });

  // write all files to temp directory
  await writeFilesToDir(tempDir, files);

  const session: Session = {
    id: sessionId,
    tempDir,
    createdAt: new Date(),
    lastActivity: new Date(),
    terminals: new Map(),
  };

  sessions.set(sessionId, session);

  // start container via docker-compose
  const output = await startContainer(session);

  return { session, output };
}

export async function writeFilesToDir(dir: string, files: Record<string, string | { base64: string }>): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    const dirPath = path.dirname(fullPath);

    // ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    // write file content
    if (typeof content === 'string') {
      await fs.writeFile(fullPath, content, 'utf-8');
    } else {
      // base64 encoded binary content
      const buffer = Buffer.from(content.base64, 'base64');
      await fs.writeFile(fullPath, buffer);
    }
  }
}

export async function writeSessionFiles(
  sessionId: string,
  files: Record<string, string | { base64: string }>,
): Promise<void> {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  await writeFilesToDir(session.tempDir, files);
  session.lastActivity = new Date();
}

async function startContainer(session: Session): Promise<string> {
  const composeFile = path.join(session.tempDir, 'docker-compose.yml');
  const projectName = `tutorialkit-${session.id}`;

  try {
    // create compose instance
    const compose = createCompose(composeFile, projectName);
    session.compose = compose;

    // pull images and start containers
    await compose.pull();

    const state = await compose.up();

    // get the container reference with retry logic
    const container = await getContainerByProjectWithRetry(projectName, 'app');

    if (container) {
      session.container = container;

      const info = await container.inspect();
      session.containerId = info.Id;
    }

    // return compose state as output
    return JSON.stringify(state, null, 2);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error starting container: ${message}`;
  }
}

async function getContainerId(session: Session): Promise<string | undefined> {
  if (session.containerId) {
    return session.containerId;
  }

  const projectName = `tutorialkit-${session.id}`;
  const container = await getContainerByProject(projectName, 'app');

  if (container) {
    const info = await container.inspect();
    return info.Id;
  }

  return undefined;
}

export async function getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
  const session = sessions.get(sessionId);

  if (!session) {
    return null;
  }

  const ports = await getSessionPorts(sessionId);

  // check if container is running
  let status: SessionInfo['status'] = 'running';
  let containerReady = false;

  if (!session.containerId) {
    const containerId = await getContainerId(session);

    if (containerId) {
      session.containerId = containerId;
    } else {
      status = 'stopped';
    }
  }

  // check if container is actually running and ready
  if (session.container) {
    try {
      const info = await session.container.inspect();
      containerReady = info.State?.Running === true;

      if (!containerReady && info.State?.Status === 'exited') {
        status = 'stopped';
      }
    } catch {
      // container may have been removed
      containerReady = false;
      status = 'stopped';
    }
  } else if (session.containerId) {
    // try to get container reference if we only have ID
    const projectName = `tutorialkit-${session.id}`;
    const container = await getContainerByProject(projectName, 'app');

    if (container) {
      session.container = container;

      try {
        const info = await container.inspect();
        containerReady = info.State?.Running === true;
      } catch {
        containerReady = false;
      }
    }
  }

  return {
    id: session.id,
    status,
    containerReady,
    ports,
  };
}

export async function getSessionPorts(sessionId: string): Promise<PortMapping[]> {
  const session = sessions.get(sessionId);

  if (!session) {
    return [];
  }

  // parse docker-compose.yml to get port mappings
  try {
    const composeFile = path.join(session.tempDir, 'docker-compose.yml');
    const content = await fs.readFile(composeFile, 'utf-8');
    const compose = parseYaml(content);

    const ports: PortMapping[] = [];

    if (compose.services) {
      for (const service of Object.values(compose.services) as any[]) {
        if (service.ports) {
          for (const portMapping of service.ports) {
            const parsed = parsePortMapping(portMapping);

            if (parsed) {
              ports.push(parsed);
            }
          }
        }
      }
    }

    return ports;
  } catch {
    return [];
  }
}

function parsePortMapping(mapping: string | number | { target: number; published: number }): PortMapping | null {
  if (typeof mapping === 'number') {
    return {
      containerPort: mapping,
      hostPort: mapping,
      protocol: 'tcp',
    };
  }

  if (typeof mapping === 'string') {
    // format: "hostPort:containerPort" or "hostPort:containerPort/protocol"
    const parts = mapping.split(':');

    if (parts.length === 2) {
      const [hostPart, containerPart] = parts;
      const [containerPort, protocol] = containerPart.split('/');

      return {
        containerPort: parseInt(containerPort, 10),
        hostPort: parseInt(hostPart, 10),
        protocol: protocol || 'tcp',
      };
    }
  }

  if (typeof mapping === 'object' && mapping.target && mapping.published) {
    return {
      containerPort: mapping.target,
      hostPort: mapping.published,
      protocol: 'tcp',
    };
  }

  return null;
}

export async function deleteSession(sessionId: string): Promise<string> {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  // clear cleanup timer
  const timer = sessionCleanupTimers.get(sessionId);

  if (timer) {
    clearTimeout(timer);
    sessionCleanupTimers.delete(sessionId);
  }

  // close all terminal connections
  for (const terminal of session.terminals.values()) {
    if (terminal.stream) {
      terminal.stream.end();
    }
  }

  // stop container via docker-compose
  const output = await stopContainer(session);

  // clean up temp directory
  try {
    await fs.rm(session.tempDir, { recursive: true, force: true });
  } catch {
    // ignore cleanup errors
  }

  sessions.delete(sessionId);

  return output;
}

async function stopContainer(session: Session): Promise<string> {
  try {
    if (session.compose) {
      await session.compose.down({ volumes: true });
      return 'Container stopped and removed successfully';
    }

    // if no compose instance, create one to stop
    const composeFile = path.join(session.tempDir, 'docker-compose.yml');
    const projectName = `tutorialkit-${session.id}`;
    const compose = createCompose(composeFile, projectName);
    await compose.down({ volumes: true });

    return 'Container stopped and removed successfully';
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return `Error stopping container: ${message}`;
  }
}

export function scheduleSessionCleanup(sessionId: string): void {
  // clear existing timer if any
  const existingTimer = sessionCleanupTimers.get(sessionId);

  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // schedule new cleanup
  const timer = setTimeout(async () => {
    const session = sessions.get(sessionId);

    if (session && session.terminals.size === 0) {
      console.log(`Cleaning up inactive session ${sessionId}`);
      await deleteSession(sessionId);
    }
  }, SESSION_TIMEOUT_MS);

  sessionCleanupTimers.set(sessionId, timer);
}

export function cancelSessionCleanup(sessionId: string): void {
  const timer = sessionCleanupTimers.get(sessionId);

  if (timer) {
    clearTimeout(timer);
    sessionCleanupTimers.delete(sessionId);
  }
}

export function updateSessionActivity(sessionId: string): void {
  const session = sessions.get(sessionId);

  if (session) {
    session.lastActivity = new Date();
  }
}

export function addTerminalToSession(sessionId: string, terminalId: string): TerminalSession {
  const session = sessions.get(sessionId);

  if (!session) {
    throw new Error(`Session ${sessionId} not found`);
  }

  const terminal: TerminalSession = {
    id: terminalId,
  };

  session.terminals.set(terminalId, terminal);
  cancelSessionCleanup(sessionId);

  return terminal;
}

export function removeTerminalFromSession(sessionId: string, terminalId: string): void {
  const session = sessions.get(sessionId);

  if (!session) {
    return;
  }

  const terminal = session.terminals.get(terminalId);

  if (terminal?.stream) {
    terminal.stream.end();
  }

  session.terminals.delete(terminalId);

  // if no more terminals, schedule cleanup
  if (session.terminals.size === 0) {
    scheduleSessionCleanup(sessionId);
  }
}
