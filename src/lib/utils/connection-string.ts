export const LOCALHOST_VARIANTS = ['localhost', '127.0.0.1', '::1'];
export const DOCKER_HOST = 'host.docker.internal';

/**
 * Return the Docker-friendly equivalent of a hostname, or null if no rewrite applies.
 * - localhost / 127.0.0.1 / ::1  →  host.docker.internal
 * - host.docker.internal         →  localhost (reverse direction)
 * - anything else                →  null
 *
 * Pure hostname-only helper. Use alongside `getAlternateConnectionString` for
 * full connection-string rewrites, or directly against a URL's `hostname`.
 */
export function alternateHost(hostname: string): string | null {
  if (LOCALHOST_VARIANTS.includes(hostname)) return DOCKER_HOST;
  if (hostname === DOCKER_HOST) return 'localhost';
  return null;
}

/**
 * Rewrite an http(s) URL's hostname from localhost → host.docker.internal.
 * Only applies when the hostname is a localhost variant. Returns the rewritten
 * URL string plus the original hostname for audit/reporting. Returns null if
 * no rewrite is appropriate (remote host, or unparseable URL).
 */
export function rewriteHttpUrlForDockerHost(url: string): { url: string; from: string; to: string } | null {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (!LOCALHOST_VARIANTS.includes(u.hostname)) return null;
    const from = u.hostname;
    u.hostname = DOCKER_HOST;
    return { url: u.toString(), from, to: DOCKER_HOST };
  } catch {
    return null;
  }
}

/**
 * Parse the URL from a connection string safely.
 * Handles mongodb+srv:// and other non-standard protocols by normalizing them for parsing.
 */
function parseConnectionUrl(connectionString: string): URL | null {
  try {
    return new URL(connectionString);
  } catch {
    // Try normalizing mongodb+srv:// → mongodb:// for parsing purposes
    const normalized = connectionString.replace(/^([a-z][a-z0-9+.-]*)\+[a-z]+:\/\//i, '$1://');
    try {
      return new URL(normalized);
    } catch {
      return null;
    }
  }
}

/**
 * Return an alternate connection string swapping between localhost and host.docker.internal.
 * Returns null if not applicable (e.g., remote host, already tried, non-URL format).
 */
export function getAlternateConnectionString(connectionString: string): string | null {
  const url = parseConnectionUrl(connectionString);

  if (url) {
    if (LOCALHOST_VARIANTS.includes(url.hostname)) {
      return connectionString.replace(
        new RegExp(`([@/])(${url.hostname})([:/?]|$)`, 'g'),
        `$1${DOCKER_HOST}$3`
      );
    }
    if (url.hostname === DOCKER_HOST) {
      return connectionString.replace(
        new RegExp(`([@/])(${DOCKER_HOST})([:/?]|$)`, 'g'),
        `$1localhost$3`
      );
    }
    return null;
  }

  // Fallback for non-URL connection strings (e.g., "localhost:6379")
  for (const variant of LOCALHOST_VARIANTS) {
    if (connectionString.includes(variant)) {
      return connectionString.replace(variant, DOCKER_HOST);
    }
  }
  if (connectionString.includes(DOCKER_HOST)) {
    return connectionString.replace(DOCKER_HOST, 'localhost');
  }

  return null;
}

/**
 * Redirect a connection string's host:port to a local tunnel port.
 * Used to transparently route DB connections through an SSH tunnel.
 */
export function redirectToTunnel(connectionString: string, localPort: number): string {
  const url = parseConnectionUrl(connectionString);
  if (!url) return connectionString;

  // Preserve the original protocol including +srv suffixes
  const originalProtocol = connectionString.match(/^([a-z][a-z0-9+.-]*):/i)?.[1] ?? url.protocol.replace(':', '');

  url.hostname = '127.0.0.1';
  url.port = localPort.toString();

  // Reconstruct with original protocol
  const reconstructed = url.toString();
  const normalizedProtocol = url.protocol.replace(':', '');
  if (normalizedProtocol !== originalProtocol) {
    return reconstructed.replace(`${normalizedProtocol}://`, `${originalProtocol}://`);
  }
  return reconstructed;
}

/**
 * Parse the hostname from a connection string.
 */ 
export function parseHostname(connectionString: string): string {
  const url = parseConnectionUrl(connectionString);
  return url?.hostname || 'localhost';
}

/**
 * Parse the port from a connection string.
 */
export function parsePort(connectionString: string, defaultPort: number): number {
  const url = parseConnectionUrl(connectionString);
  if (url?.port) return parseInt(url.port);
  return defaultPort;
}

/**
 * Default ports by database type.
 */
export const DB_DEFAULT_PORTS: Record<string, number> = {
  postgresql: 5432,
  mongodb: 27017,
  clickhouse: 8123,
  redis: 6379,
};
