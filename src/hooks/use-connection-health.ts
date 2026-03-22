'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

export type ConnectionHealthStatus = 'healthy' | 'unhealthy' | 'reconnecting' | 'disconnected';

interface UseConnectionHealthOptions {
  connectionId: string | null;
  connectionType?: string;
  connectionString?: string;
  pollIntervalMs?: number;
  maxRetries?: number;
}

interface UseConnectionHealthResult {
  status: ConnectionHealthStatus;
  reconnect: () => Promise<void>;
}

export function useConnectionHealth({
  connectionId,
  connectionType,
  connectionString,
  pollIntervalMs = 30000,
  maxRetries = 3,
}: UseConnectionHealthOptions): UseConnectionHealthResult {
  const [status, setStatus] = useState<ConnectionHealthStatus>('healthy');
  const retryCount = useRef(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkHealth = useCallback(async () => {
    if (!connectionId) {
      setStatus('disconnected');
      return;
    }

    try {
      const response = await fetch(`/api/connect?connectionId=${connectionId}`);
      const data = await response.json();

      if (data.exists && data.healthy) {
        if (status === 'unhealthy' || status === 'reconnecting') {
          retryCount.current = 0;
        }
        setStatus('healthy');
      } else {
        setStatus('unhealthy');
      }
    } catch {
      setStatus('unhealthy');
    }
  }, [connectionId, status]);

  const reconnect = useCallback(async () => {
    if (!connectionId || !connectionType || !connectionString) return;

    setStatus('reconnecting');

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const response = await fetch('/api/connect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type: connectionType,
            connectionString,
            connectionId,
          }),
        });

        const data = await response.json();
        if (data.success) {
          setStatus('healthy');
          retryCount.current = 0;
          return;
        }
      } catch {
        // Continue retrying
      }

      // Exponential backoff
      if (attempt < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
      }
    }

    setStatus('disconnected');
  }, [connectionId, connectionType, connectionString, maxRetries]);

  // Auto-reconnect when unhealthy
  useEffect(() => {
    if (status === 'unhealthy' && retryCount.current < maxRetries) {
      retryCount.current++;
      reconnect();
    }
  }, [status, maxRetries, reconnect]);

  // Polling
  useEffect(() => {
    if (!connectionId) return;

    // Initial check
    checkHealth();

    intervalRef.current = setInterval(checkHealth, pollIntervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [connectionId, pollIntervalMs, checkHealth]);

  return { status, reconnect };
}
