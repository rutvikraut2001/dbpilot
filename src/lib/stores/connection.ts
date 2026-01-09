import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConnectionConfig, DatabaseType } from '../adapters/types';

interface ConnectionState {
  // Saved connections (persisted to localStorage)
  connections: ConnectionConfig[];

  // Currently active connection
  activeConnectionId: string | null;

  // Read-only mode for production safety
  readOnlyMode: boolean;

  // Actions
  addConnection: (connection: Omit<ConnectionConfig, 'id'>) => string;
  updateConnection: (id: string, updates: Partial<ConnectionConfig>) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
  toggleReadOnlyMode: () => void;
  setReadOnlyMode: (value: boolean) => void;
  getConnection: (id: string) => ConnectionConfig | undefined;
  getActiveConnection: () => ConnectionConfig | undefined;
}

// Generate a simple unique ID
const generateId = () => `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      readOnlyMode: false,

      addConnection: (connection) => {
        const id = generateId();
        const newConnection: ConnectionConfig = { ...connection, id };

        set((state) => ({
          connections: [...state.connections, newConnection],
        }));

        return id;
      },

      updateConnection: (id, updates) => {
        set((state) => ({
          connections: state.connections.map((conn) =>
            conn.id === id ? { ...conn, ...updates } : conn
          ),
        }));
      },

      removeConnection: (id) => {
        set((state) => ({
          connections: state.connections.filter((conn) => conn.id !== id),
          activeConnectionId: state.activeConnectionId === id ? null : state.activeConnectionId,
        }));
      },

      setActiveConnection: (id) => {
        set({ activeConnectionId: id });
      },

      toggleReadOnlyMode: () => {
        set((state) => ({ readOnlyMode: !state.readOnlyMode }));
      },

      setReadOnlyMode: (value) => {
        set({ readOnlyMode: value });
      },

      getConnection: (id) => {
        return get().connections.find((conn) => conn.id === id);
      },

      getActiveConnection: () => {
        const { connections, activeConnectionId } = get();
        return connections.find((conn) => conn.id === activeConnectionId);
      },
    }),
    {
      name: 'db-studio-connections',
      // Don't persist active connection - user should reconnect each session
      partialize: (state) => ({
        connections: state.connections,
        readOnlyMode: state.readOnlyMode,
      }),
    }
  )
);

// Selectors for convenience
export const useActiveConnection = () => {
  const { connections, activeConnectionId } = useConnectionStore();
  return connections.find((conn) => conn.id === activeConnectionId);
};

export const useConnections = () => useConnectionStore((state) => state.connections);
export const useReadOnlyMode = () => useConnectionStore((state) => state.readOnlyMode);
