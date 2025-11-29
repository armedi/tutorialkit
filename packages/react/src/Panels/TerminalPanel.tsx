import { useStore } from '@nanostores/react';
import type { TutorialStore } from '@tutorialkit/runtime';
import type { TerminalPanelType } from '@tutorialkit/types';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { TerminalRef } from '../core/Terminal/index.js';
import { classNames } from '../utils/classnames.js';

const Terminal = lazy(() => import('../core/Terminal/index.js'));

interface TerminalErrorOverlayProps {
  terminalId: string;
  tutorialStore: TutorialStore;
}

function TerminalErrorOverlay({ terminalId, tutorialStore }: TerminalErrorOverlayProps) {
  const containerErrorAtom = tutorialStore.getTerminalContainerError(terminalId);
  const [containerError, setContainerError] = useState<string | undefined>(undefined);
  const [isRetrying, setIsRetrying] = useState(false);
  const [isRestarting, setIsRestarting] = useState(false);
  const [retryError, setRetryError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!containerErrorAtom) {
      return;
    }

    // get initial value
    setContainerError(containerErrorAtom.get());

    // subscribe to changes
    const unsubscribe = containerErrorAtom.subscribe((error) => {
      setContainerError(error);

      if (!error) {
        setRetryError(undefined);
      }
    });

    return unsubscribe;
  }, [containerErrorAtom]);

  const handleRetry = useCallback(async () => {
    setIsRetrying(true);
    setRetryError(undefined);

    try {
      await tutorialStore.retryTerminalConnection(terminalId);
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'Retry failed');
    } finally {
      setIsRetrying(false);
    }
  }, [tutorialStore, terminalId]);

  const handleRestart = useCallback(async () => {
    setIsRestarting(true);
    setRetryError(undefined);

    try {
      await tutorialStore.restartSession();
    } catch (error) {
      setRetryError(error instanceof Error ? error.message : 'Restart failed');
    } finally {
      setIsRestarting(false);
    }
  }, [tutorialStore]);

  if (!containerError && !retryError) {
    return null;
  }

  const errorMessage = retryError || containerError;
  const isLoading = isRetrying || isRestarting;

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-tk-elements-panel-backgroundColor/90 z-10">
      <div className="flex flex-col items-center gap-4 p-6 max-w-md text-center">
        <div className="i-ph-warning-circle-duotone text-4xl text-yellow-500" />
        <div className="text-tk-elements-panel-textColor">
          <p className="font-medium mb-2">
            {isRetrying ? 'Reconnecting to container...' : isRestarting ? 'Restarting session...' : 'Container Error'}
          </p>
          {!isLoading && <p className="text-sm opacity-75">{errorMessage}</p>}
        </div>
        {!isLoading && (
          <div className="flex gap-3">
            <button
              type="button"
              className="px-4 py-2 text-sm font-medium rounded-md bg-tk-elements-primaryButton-backgroundColor text-tk-elements-primaryButton-textColor hover:bg-tk-elements-primaryButton-backgroundColorHover transition-colors"
              onClick={handleRetry}
            >
              Retry Connection
            </button>
            <button
              type="button"
              className="px-4 py-2 text-sm font-medium rounded-md bg-tk-elements-secondaryButton-backgroundColor text-tk-elements-secondaryButton-textColor border border-tk-elements-secondaryButton-borderColor hover:bg-tk-elements-secondaryButton-backgroundColorHover transition-colors"
              onClick={handleRestart}
            >
              Restart Session
            </button>
          </div>
        )}
        {isLoading && (
          <div className="i-svg-spinners-90-ring-with-bg text-2xl text-tk-elements-primaryButton-backgroundColor" />
        )}
      </div>
    </div>
  );
}

interface TerminalPanelProps {
  theme: 'dark' | 'light';
  tutorialStore: TutorialStore;
}

const ICON_MAP = new Map<TerminalPanelType, string>([
  ['output', 'i-ph-newspaper-duotone'],
  ['terminal', 'i-ph-terminal-window-duotone'],
]);

export function TerminalPanel({ theme, tutorialStore }: TerminalPanelProps) {
  const terminalConfig = useStore(tutorialStore.terminalConfig);

  const terminalRefs = useRef<Record<number, TerminalRef>>({});

  const [domLoaded, setDomLoaded] = useState(false);

  // select the terminal tab by default
  const [tabIndex, setTabIndex] = useState(terminalConfig.activePanel);

  useEffect(() => {
    setDomLoaded(true);
  }, []);

  useEffect(() => {
    setTabIndex(terminalConfig.activePanel);
  }, [terminalConfig]);

  useEffect(() => {
    return tutorialStore.themeRef.subscribe(() => {
      for (const ref of Object.values(terminalRefs.current)) {
        ref.reloadStyles();
      }
    });
  }, []);

  return (
    <div className="panel-container transition-theme bg-tk-elements-panel-backgroundColor text-tk-elements-panel-textColor">
      <div className="panel-tabs-header overflow-x-hidden">
        <div className="panel-title w-full">
          <ul
            className="flex h-full transition-theme border-b border-tk-elements-app-borderColor w-full"
            role="tablist"
            aria-orientation="horizontal"
          >
            {terminalConfig.panels.map(({ type, title }, index) => {
              const selected = tabIndex === index;

              return (
                <li key={index}>
                  <button
                    className={classNames(
                      'group h-full px-4 flex items-center gap-1.5 whitespace-nowrap text-sm position-relative transition-theme border-r border-tk-elements-panel-headerTab-borderColor',
                      {
                        'bg-tk-elements-panel-headerTab-backgroundColor text-tk-elements-panel-headerTab-textColor hover:bg-tk-elements-panel-headerTab-backgroundColorHover hover:text-tk-elements-panel-headerTab-textColorHover hover:border-tk-elements-panel-headerTab-borderColorHover':
                          !selected,
                        'bg-tk-elements-panel-headerTab-backgroundColorActive text-tk-elements-panel-headerTab-textColorActive border-tk-elements-panel-headerTab-borderColorActive':
                          selected,
                        'shadow-[0px_1px_0px_0px] shadow-tk-elements-panel-headerTab-backgroundColorActive': selected,
                        'border-l': index > 0,
                      },
                    )}
                    title={title}
                    id={`tk-terminal-tab-${index}`}
                    role="tab"
                    aria-selected={selected}
                    aria-controls={`tk-terminal-tapbanel-${index}`}
                    onClick={() => setTabIndex(index)}
                  >
                    <span
                      className={classNames(`text-tk-elements-panel-headerTab-iconColor ${ICON_MAP.get(type) ?? ''}`, {
                        'group-hover:text-tk-elements-panel-headerTab-iconColorHover': !selected,
                        'text-tk-elements-panel-headerTab-iconColorActive': selected,
                      })}
                    ></span>
                    {title}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <div className="h-full overflow-hidden relative">
        {domLoaded && (
          <Suspense>
            {terminalConfig.panels.map(({ id, type }, index) => (
              <div key={id} className={classNames('relative', tabIndex !== index ? 'hidden h-full' : 'h-full')}>
                <Terminal
                  role="tabpanel"
                  id={`tk-terminal-tapbanel-${index}`}
                  aria-labelledby={`tk-terminal-tab-${index}`}
                  className="h-full"
                  theme={theme}
                  readonly={type === 'output'}
                  ref={(ref) => (terminalRefs.current[index] = ref!)}
                  onTerminalReady={(terminal) => {
                    tutorialStore.attachTerminal(id, terminal);
                  }}
                  onTerminalResize={(cols, rows) => {
                    tutorialStore.onTerminalResize(cols, rows);
                  }}
                />
                {type === 'terminal' && <TerminalErrorOverlay terminalId={id} tutorialStore={tutorialStore} />}
              </div>
            ))}
          </Suspense>
        )}
      </div>
    </div>
  );
}
