import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { v4 as uuidv4 } from 'uuid';
import { parse as parseYaml } from 'yaml';
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

  // Create temp directory
  await fs.mkdir(tempDir, { recursive: true });

  // Write all files to temp directory
  await writeFilesToDir(tempDir, files);

  const session: Session = {
    id: sessionId,
    tempDir,
    createdAt: new Date(),
    lastActivity: new Date(),
    terminals: new Map(),
  };

  sessions.set(sessionId, session);

  // Start container via docker-compose
  const output = await startContainer(session);

  return { session, output };
}

export async function writeFilesToDir(
  dir: string,
  files: Record<string, string | { base64: string }>,
): Promise<void> {
  for (const [filePath, content] of Object.entries(files)) {
    const fullPath = path.join(dir, filePath);
    const dirPath = path.dirname(fullPath);

    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    // Write file content
    if (typeof content === 'string') {
      await fs.writeFile(fullPath, content, 'utf-8');
    } else {
      // Base64 encoded binary content
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
  return new Promise((resolve, reject) => {
    const output: string[] = [];

    // Check if docker-compose.yml exists
    const composeFile = path.join(session.tempDir, 'docker-compose.yml');

    const proc = spawn('docker', ['compose', 'up', '-d', '--build'], {
      cwd: session.tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data) => {
      output.push(data.toString());
    });

    proc.stderr?.on('data', (data) => {
      output.push(data.toString());
    });

    proc.on('close', async (code) => {
      const outputStr = output.join('');

      if (code === 0) {
        // Get container ID
        try {
          const containerId = await getContainerId(session.tempDir);
          session.containerId = containerId;
          resolve(outputStr);
        } catch (error) {
          resolve(outputStr); // Still resolve, container might be running
        }
      } else {
        // Return output even on failure - let frontend see the error
        resolve(outputStr);
      }
    });

    proc.on('error', (error) => {
      reject(error);
    });
  });
}

async function getContainerId(tempDir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    const proc = spawn('docker', ['compose', 'ps', '-q'], {
      cwd: tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let output = '';
    proc.stdout?.on('data', (data) => {
      output += data.toString();
    });

    proc.on('close', () => {
      const containerId = output.trim().split('\n')[0];
      resolve(containerId || undefined);
    });

    proc.on('error', () => {
      resolve(undefined);
    });
  });
}

export async function getSessionInfo(sessionId: string): Promise<SessionInfo | null> {
  const session = sessions.get(sessionId);
  if (!session) {
    return null;
  }

  const ports = await getSessionPorts(sessionId);

  // Check if container is running
  let status: SessionInfo['status'] = 'running';
  if (!session.containerId) {
    const containerId = await getContainerId(session.tempDir);
    if (containerId) {
      session.containerId = containerId;
    } else {
      status = 'stopped';
    }
  }

  return {
    id: session.id,
    status,
    ports,
  };
}

export async function getSessionPorts(sessionId: string): Promise<PortMapping[]> {
  const session = sessions.get(sessionId);
  if (!session) {
    return [];
  }

  // Parse docker-compose.yml to get port mappings
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
    // Format: "hostPort:containerPort" or "hostPort:containerPort/protocol"
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

  // Clear cleanup timer
  const timer = sessionCleanupTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    sessionCleanupTimers.delete(sessionId);
  }

  // Close all terminal connections
  for (const terminal of session.terminals.values()) {
    if (terminal.stream) {
      terminal.stream.end();
    }
  }

  // Stop container via docker-compose
  const output = await stopContainer(session);

  // Clean up temp directory
  try {
    await fs.rm(session.tempDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }

  sessions.delete(sessionId);

  return output;
}

async function stopContainer(session: Session): Promise<string> {
  return new Promise((resolve) => {
    const output: string[] = [];

    const proc = spawn('docker', ['compose', 'down', '--volumes', '--remove-orphans'], {
      cwd: session.tempDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    proc.stdout?.on('data', (data) => {
      output.push(data.toString());
    });

    proc.stderr?.on('data', (data) => {
      output.push(data.toString());
    });

    proc.on('close', () => {
      resolve(output.join(''));
    });

    proc.on('error', () => {
      resolve(output.join(''));
    });
  });
}

export function scheduleSessionCleanup(sessionId: string): void {
  // Clear existing timer if any
  const existingTimer = sessionCleanupTimers.get(sessionId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  // Schedule new cleanup
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

  // If no more terminals, schedule cleanup
  if (session.terminals.size === 0) {
    scheduleSessionCleanup(sessionId);
  }
}
