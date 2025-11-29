export interface Session {
  id: string;
  tempDir: string;
  containerId?: string;
  createdAt: Date;
  lastActivity: Date;
  terminals: Map<string, TerminalSession>;
}

export interface TerminalSession {
  id: string;
  execId?: string;
  stream?: NodeJS.ReadWriteStream;
}

export interface CreateSessionRequest {
  files: Record<string, string | { base64: string }>;
}

export interface WriteFilesRequest {
  files: Record<string, string | { base64: string }>;
}

export interface PortMapping {
  containerPort: number;
  hostPort: number;
  protocol: string;
}

export interface SessionInfo {
  id: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  ports: PortMapping[];
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'error';
  docker: {
    available: boolean;
    version?: string;
    error?: string;
  };
  message?: string;
}
