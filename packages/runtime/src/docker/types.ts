export interface DockerRuntimeConfig {
  backendUrl: string;
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

export interface TerminalMessage {
  type: 'start' | 'input' | 'resize' | 'exec' | 'output' | 'exit' | 'error' | 'exec-complete';
  data?: string;
  code?: number | null;
  message?: string;
  cols?: number;
  rows?: number;
  size?: { cols: number; rows: number };
  command?: string;
}

export type Files = Record<string, string | Uint8Array>;
