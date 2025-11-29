/**
 * Check if the browser supports the Docker-based runtime.
 * The Docker runtime requires WebSocket support which is available in all modern browsers.
 */
export function isDockerRuntimeSupported() {
  try {
    return 'WebSocket' in globalThis;
  } catch {
    return false;
  }
}

/**
 * @deprecated Use isDockerRuntimeSupported instead
 */
export function isWebContainerSupported() {
  return isDockerRuntimeSupported();
}
