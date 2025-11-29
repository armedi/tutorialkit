import { classNames } from './utils/classnames.js';

type Status = 'connected' | 'disconnected' | 'connecting' | 'error';

interface Props {
  status: Status;
  onClick?: () => void;
  className?: string;
}

export function ConnectionStatus({ status, onClick, className }: Props) {
  const statusConfig = {
    connected: {
      icon: 'i-ph-check-circle-duotone',
      color: 'text-green-500',
      label: 'Connected',
    },
    disconnected: {
      icon: 'i-ph-plug-duotone',
      color: 'text-gray-400',
      label: 'Disconnected',
    },
    connecting: {
      icon: 'i-svg-spinners-90-ring-with-bg',
      color: 'text-blue-500',
      label: 'Connecting',
    },
    error: {
      icon: 'i-ph-warning-circle-duotone',
      color: 'text-red-500',
      label: 'Error',
    },
  };

  const config = statusConfig[status];

  return (
    <button
      type="button"
      onClick={onClick}
      className={classNames(
        'flex items-center gap-1.5 px-2 py-1 rounded text-xs',
        'hover:bg-tk-elements-topBar-backgroundColor/50',
        'transition-colors',
        className,
      )}
      title={`Backend: ${config.label}. Click to configure.`}
    >
      <span className={classNames('inline-block scale-110', config.icon, config.color)} />
      <span className="text-tk-elements-topBar-textColor/70">{config.label}</span>
    </button>
  );
}
