import type { DatabaseType } from '@/lib/adapters/types';

type ErrorCategory = 'refused' | 'dns' | 'timeout' | 'dropped' | 'permission' | 'auth' | 'unreachable' | 'unknown';

export interface ConnectionDiagnostics {
  category: ErrorCategory;
  userMessage: string;
  suggestions: string[];
  isRetryable: boolean;
}

interface ConnectionStrategy {
  connectionString: string;
  label: string;
}

function parseHost(connectionString: string): string {
  try {
    // Handle protocols like postgresql://, mongodb://, redis://, clickhouse://
    const urlLike = connectionString.replace(/^\w+:\/\//, 'http://');
    const url = new URL(urlLike);
    return url.hostname;
  } catch {
    return '';
  }
}

function replaceHost(connectionString: string, oldHost: string, newHost: string): string {
  // Replace the hostname in the connection string
  return connectionString.replace(oldHost, newHost);
}

function isLocalhostVariant(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname.toLowerCase());
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function diagnoseConnectionError(error: unknown, dbType: DatabaseType, connectionString: string): ConnectionDiagnostics {
  const message = error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();

  if (lower.includes('econnrefused')) {
    return {
      category: 'refused',
      userMessage: 'Database is not listening on this host:port. Check if the database server is running.',
      suggestions: [
        'Try using 127.0.0.1 instead of localhost',
        'If running in Docker, try host.docker.internal',
        'Verify the port number is correct',
      ],
      isRetryable: true,
    };
  }

  if (lower.includes('enotfound')) {
    return {
      category: 'dns',
      userMessage: 'Hostname could not be resolved.',
      suggestions: [
        'Check spelling of hostname',
        'Try using IP address directly',
        'Check DNS settings',
      ],
      isRetryable: true,
    };
  }

  if (lower.includes('etimedout')) {
    return {
      category: 'timeout',
      userMessage: 'Connection timed out.',
      suggestions: [
        'Check firewall rules',
        'Verify the host is reachable',
        'If using Docker, check network mode',
      ],
      isRetryable: true,
    };
  }

  if (lower.includes('socket hang up') || lower.includes('connection closed') || lower.includes('econnreset')) {
    return {
      category: 'dropped',
      userMessage: 'Connection was dropped unexpectedly.',
      suggestions: [
        'Database may have reached max_connections limit',
        'Try reconnecting',
        'Check database server logs',
      ],
      isRetryable: true,
    };
  }

  if (lower.includes('eacces') || lower.includes('permission denied')) {
    return {
      category: 'permission',
      userMessage: 'Permission denied.',
      suggestions: [
        'If using Docker, ensure proper network access',
        'Check that the port is not restricted',
      ],
      isRetryable: false,
    };
  }

  if (lower.includes('authentication failed') || lower.includes('password') || lower.includes('auth') || lower.includes('wrongpass')) {
    return {
      category: 'auth',
      userMessage: 'Authentication failed.',
      suggestions: [
        'Check username and password',
        'Verify the credentials are correct for this database',
      ],
      isRetryable: false,
    };
  }

  if (lower.includes('ehostunreach')) {
    return {
      category: 'unreachable',
      userMessage: 'Host is unreachable.',
      suggestions: [
        'If database is in Docker, try host.docker.internal',
        'Check network connectivity',
      ],
      isRetryable: true,
    };
  }

  return {
    category: 'unknown',
    userMessage: 'Connection failed.',
    suggestions: [
      'Check the connection string format',
      'Verify the database server is running',
      'Check network connectivity',
    ],
    isRetryable: true,
  };
}

export function buildConnectionStrategies(
  type: DatabaseType,
  connectionString: string
): ConnectionStrategy[] {
  const strategies: ConnectionStrategy[] = [];
  const hostname = parseHost(connectionString);

  // Always include original
  strategies.push({ connectionString, label: 'Original' });

  if (isLocalhostVariant(hostname)) {
    // Add IPv4 explicit if not already 127.0.0.1
    if (hostname !== '127.0.0.1') {
      strategies.push({
        connectionString: replaceHost(connectionString, hostname, '127.0.0.1'),
        label: 'IPv4 explicit',
      });
    }

    // Add Docker host
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, 'host.docker.internal'),
      label: 'Docker host',
    });

    // For PostgreSQL, try Unix socket
    if (type === 'postgresql') {
      strategies.push({
        connectionString: connectionString.includes('?')
          ? `${connectionString}&host=/var/run/postgresql`
          : `${connectionString}?host=/var/run/postgresql`,
        label: 'Unix socket',
      });
    }
  } else if (hostname === 'host.docker.internal') {
    // Try localhost instead
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, 'localhost'),
      label: 'Localhost',
    });
  }

  return strategies;
}
