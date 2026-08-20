import type { DatabaseType } from '@/lib/adapters/types';

type ErrorCategory = 'refused' | 'dns' | 'timeout' | 'dropped' | 'permission' | 'auth' | 'not-found' | 'unreachable' | 'unknown';

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

/** Where the MySQL and MariaDB packages put their Unix socket. */
const MYSQL_SOCKET_PATHS = [
  '/var/run/mysqld/mysqld.sock',
  '/tmp/mysql.sock',
] as const;

/** Append a query parameter, picking `?` or `&` as the string requires. */
function withParam(connectionString: string, key: string, value: string): string {
  const separator = connectionString.includes('?') ? '&' : '?';
  return `${connectionString}${separator}${key}=${value}`;
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

  if (lower.includes('enotfound') || lower.includes('eai_again') || lower.includes('getaddrinfo')) {
    return {
      category: 'dns',
      userMessage: 'Hostname could not be resolved.',
      suggestions: [
        'Check spelling of hostname',
        'Try using IP address directly (127.0.0.1 or 172.17.0.1 for Docker)',
        'Check DNS settings',
        'If using Docker, try host.docker.internal or 172.17.0.1',
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

  // MySQL 8 defaults to caching_sha2_password. An old client, or a server
  // reached over a plaintext connection, fails here with credentials that are
  // perfectly correct — so this must not be reported as a wrong password.
  if (
    lower.includes('er_not_supported_auth_mode') ||
    lower.includes('does not support authentication protocol') ||
    lower.includes('auth_gssapi_client') ||
    lower.includes('unknown authentication plugin')
  ) {
    return {
      category: 'auth',
      userMessage:
        'The server requires an authentication plugin this client cannot use. The credentials themselves may be fine.',
      suggestions: [
        "For MySQL 8, grant the user mysql_native_password: ALTER USER 'user'@'%' IDENTIFIED WITH mysql_native_password BY 'password'",
        'Or enable TLS on the connection so caching_sha2_password can complete (add ?ssl-mode=REQUIRED)',
        'Verify the server version supports the plugin the user is defined with',
      ],
      isRetryable: false,
    };
  }

  // ER_BAD_DB_ERROR. The host and credentials worked; only the database name is
  // wrong, and retrying other hosts would waste the user's time.
  if (lower.includes('unknown database')) {
    return {
      category: 'not-found',
      userMessage: 'The server is reachable but the named database does not exist.',
      suggestions: [
        'Check the database name after the last / in the connection string',
        'List the available databases with SHOW DATABASES',
        'MySQL database names are case-sensitive on Linux',
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

  if (lower.includes('ehostunreach') || lower.includes('enetunreach')) {
    return {
      category: 'unreachable',
      userMessage: 'Host is unreachable.',
      suggestions: [
        'If database is in Docker, try host.docker.internal or 172.17.0.1',
        'Check network connectivity',
        'Try using 127.0.0.1 or 0.0.0.0 instead',
      ],
      isRetryable: true,
    };
  }

  return {
    category: 'unknown',
    userMessage: `Connection failed: ${message || 'Unknown error'}`,
    suggestions: [
      'Check the connection string format',
      'Verify the database server is running',
      'Check network connectivity',
      'If running via Docker with sudo, try 127.0.0.1, 0.0.0.0, or 172.17.0.1 as host',
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

    // Add 0.0.0.0 (Docker often binds to this)
    if (hostname !== '0.0.0.0') {
      strategies.push({
        connectionString: replaceHost(connectionString, hostname, '0.0.0.0'),
        label: 'All interfaces',
      });
    }

    // Add Docker host
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, 'host.docker.internal'),
      label: 'Docker host',
    });

    // Add Docker bridge gateway
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, '172.17.0.1'),
      label: 'Docker bridge gateway',
    });

    // For PostgreSQL, try Unix socket
    if (type === 'postgresql') {
      strategies.push({
        connectionString: withParam(connectionString, 'host', '/var/run/postgresql'),
        label: 'Unix socket',
      });
    }

    // A distribution-packaged MySQL often listens on its socket only, with
    // skip-networking or a bind-address that excludes the loopback the user
    // typed. Both common socket paths are worth a try before giving up.
    if (type === 'mysql') {
      for (const socket of MYSQL_SOCKET_PATHS) {
        strategies.push({
          connectionString: withParam(connectionString, 'socket', socket),
          label: `Unix socket (${socket})`,
        });
      }
    }
  } else if (hostname === 'host.docker.internal') {
    // Try localhost and Docker bridge
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, 'localhost'),
      label: 'Localhost',
    });
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, '127.0.0.1'),
      label: 'IPv4 explicit',
    });
    strategies.push({
      connectionString: replaceHost(connectionString, hostname, '172.17.0.1'),
      label: 'Docker bridge gateway',
    });
  }

  return strategies;
}
