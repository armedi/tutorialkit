import Docker from 'dockerode';

let docker: Docker | null = null;

export function getDocker(): Docker {
  if (!docker) {
    docker = new Docker();
  }
  return docker;
}

export async function checkDockerHealth(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const docker = getDocker();
    const info = await docker.version();
    return {
      available: true,
      version: info.Version,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return {
      available: false,
      error: `Docker daemon is not available. ${message}. Please ensure Docker Desktop is running or the Docker daemon is started.`,
    };
  }
}
