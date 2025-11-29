import { useState, useEffect } from 'react';
import { classNames } from './utils/classnames.js';

const BACKEND_URL_KEY = 'tutorialkit:backendUrl';
const DEFAULT_BACKEND_URL = 'http://localhost:3001';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onConnect: (url: string) => void;
  initialUrl?: string;
  error?: string;
}

export function BackendConfigModal({ isOpen, onClose, onConnect, initialUrl, error }: Props) {
  const [url, setUrl] = useState(initialUrl || DEFAULT_BACKEND_URL);
  const [isConnecting, setIsConnecting] = useState(false);
  const [connectionError, setConnectionError] = useState<string | undefined>(error);

  useEffect(() => {
    if (error) {
      setConnectionError(error);
    }
  }, [error]);

  if (!isOpen) {
    return null;
  }

  const handleConnect = async () => {
    setIsConnecting(true);
    setConnectionError(undefined);

    try {
      const response = await fetch(`${url}/health`);
      const data = await response.json();

      if (data.status === 'ok') {
        localStorage.setItem(BACKEND_URL_KEY, url);
        onConnect(url);
      } else {
        setConnectionError(data.docker?.error || data.message || 'Backend health check failed');
      }
    } catch (err) {
      setConnectionError(`Cannot connect to ${url}. Make sure the backend is running.`);
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-tk-elements-app-backgroundColor border border-tk-elements-app-borderColor rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-xl font-semibold text-tk-elements-app-textColor mb-4">
          Configure Backend
        </h2>

        <p className="text-sm text-tk-elements-app-textColor/70 mb-4">
          TutorialKit requires a local backend server to run Docker containers.
          Enter the URL of your backend server below.
        </p>

        <div className="mb-4">
          <label className="block text-sm font-medium text-tk-elements-app-textColor mb-2">
            Backend URL
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={DEFAULT_BACKEND_URL}
            className={classNames(
              'w-full px-3 py-2 rounded-md border text-sm',
              'bg-tk-elements-app-backgroundColor',
              'text-tk-elements-app-textColor',
              'border-tk-elements-app-borderColor',
              'focus:outline-none focus:ring-2 focus:ring-tk-elements-app-borderColor',
            )}
          />
        </div>

        {connectionError && (
          <div className="mb-4 p-3 rounded-md bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-300 text-sm">
            {connectionError}
          </div>
        )}

        <div className="flex justify-between items-center">
          <p className="text-xs text-tk-elements-app-textColor/50">
            Run: <code className="bg-tk-elements-app-borderColor px-1 rounded">tutorialkit-backend start</code>
          </p>

          <div className="flex gap-2">
            {initialUrl && (
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm rounded-md border border-tk-elements-app-borderColor text-tk-elements-app-textColor hover:bg-tk-elements-app-borderColor/20"
              >
                Cancel
              </button>
            )}
            <button
              onClick={handleConnect}
              disabled={isConnecting || !url}
              className={classNames(
                'px-4 py-2 text-sm rounded-md',
                'bg-tk-elements-primaryButton-backgroundColor',
                'text-tk-elements-primaryButton-textColor',
                'hover:bg-tk-elements-primaryButton-backgroundColorHover',
                'disabled:opacity-50 disabled:cursor-not-allowed',
              )}
            >
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function getStoredBackendUrl(): string | null {
  if (typeof localStorage !== 'undefined') {
    return localStorage.getItem(BACKEND_URL_KEY);
  }

  return null;
}

export function setStoredBackendUrl(url: string): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(BACKEND_URL_KEY, url);
  }
}
