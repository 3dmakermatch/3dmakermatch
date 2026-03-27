import { useState, useEffect, useRef, useCallback } from 'react';
import { api } from '../lib/api';

interface WSNotification {
  type: string;
  data: Record<string, unknown>;
  timestamp: string;
}

export function useWebSocket(isAuthenticated: boolean) {
  const [notifications, setNotifications] = useState<WSNotification[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  const connect = useCallback(async () => {
    if (!isAuthenticated) return;
    try {
      const { ticket } = await api<{ ticket: string }>('/ws/ticket', { method: 'POST' });
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/api/v1/ws?ticket=${ticket}`);

      ws.onmessage = (event) => {
        const data = JSON.parse(event.data as string) as WSNotification;
        setNotifications((prev) => [data, ...prev].slice(0, 50));
      };

      ws.onclose = () => {
        // Reconnect after 5s
        setTimeout(() => connect(), 5000);
      };

      wsRef.current = ws;
    } catch {
      // Retry after 10s on error
      setTimeout(() => connect(), 10000);
    }
  }, [isAuthenticated]);

  useEffect(() => {
    connect();
    return () => wsRef.current?.close();
  }, [connect]);

  const clearNotifications = useCallback(() => setNotifications([]), []);

  return { notifications, clearNotifications };
}
