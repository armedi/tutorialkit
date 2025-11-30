import Docker from 'dockerode';
import DockerodeCompose from 'dockerode-compose';

let docker: Docker | null = null;

export function getDocker(): Docker {
  if (!docker) {
    docker = new Docker();
  }

  return docker;
}

/**
 * Create a dockerode-compose instance for a compose file.
 *
 * @param composePath - Absolute path to the docker-compose.yml file
 * @param projectName - Unique project name for this compose stack
 */
export function createCompose(composePath: string, projectName: string): DockerodeCompose {
  const dockerInstance = getDocker();
  return new DockerodeCompose(dockerInstance, composePath, projectName);
}

/**
 * Get a container by its compose project name.
 * Returns the first container found with the matching project label.
 *
 * @param projectName - The compose project name
 * @param serviceName - Optional service name to filter by (defaults to 'app')
 */
export async function getContainerByProject(
  projectName: string,
  serviceName: string = 'app',
): Promise<Docker.Container | undefined> {
  const dockerInstance = getDocker();

  const containers = await dockerInstance.listContainers({
    all: true,
    filters: {
      label: [`com.docker.compose.project=${projectName}`, `com.docker.compose.service=${serviceName}`],
    },
  });

  if (containers.length === 0) {
    return undefined;
  }

  return dockerInstance.getContainer(containers[0].Id);
}

/**
 * Get a container by its compose project name with retry logic.
 * Polls up to maxRetries times with a delay between attempts.
 * This is useful after compose.up() when container labels may not be immediately available.
 *
 * @param projectName - The compose project name
 * @param serviceName - Optional service name to filter by (defaults to 'app')
 * @param maxRetries - Maximum number of retry attempts (default: 5)
 * @param delayMs - Delay between retries in milliseconds (default: 500)
 */
export async function getContainerByProjectWithRetry(
  projectName: string,
  serviceName: string = 'app',
  maxRetries: number = 5,
  delayMs: number = 500,
): Promise<Docker.Container | undefined> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const container = await getContainerByProject(projectName, serviceName);

    if (container) {
      return container;
    }

    if (attempt < maxRetries - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  return undefined;
}

/**
 * Get all containers for a compose project.
 *
 * @param projectName - The compose project name
 */
export async function getContainersByProject(projectName: string): Promise<Docker.Container[]> {
  const dockerInstance = getDocker();

  const containers = await dockerInstance.listContainers({
    all: true,
    filters: {
      label: [`com.docker.compose.project=${projectName}`],
    },
  });

  return containers.map((info) => dockerInstance.getContainer(info.Id));
}

export async function checkDockerHealth(): Promise<{
  available: boolean;
  version?: string;
  error?: string;
}> {
  try {
    const dockerInstance = getDocker();
    const info = await dockerInstance.version();

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
