import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConnectionConfig } from '../adapters/types';

interface ConnectionState {
  // Saved connections (persisted to localStorage)
  connections: ConnectionConfig[];

  // Currently active connection
  activeConnectionId: string | null;

  // Read-only mode for production safety.
  // The server is authoritative; this mirrors it so the UI can never display a
  // weaker state than is actually being enforced.
  readOnlyMode: boolean;

  // True when the deployment sets FORCE_READ_ONLY — write access cannot be
  // enabled at all. Never persisted; always read from the server.
  forceReadOnly: boolean;

  // Hydration state (for SSR/refresh handling)
  _hasHydrated: boolean;

  // Actions
  addConnection: (connection: Omit<ConnectionConfig, 'id'>) => string;
  updateConnection: (id: string, updates: Partial<ConnectionConfig>) => void;
  removeConnection: (id: string) => void;
  setActiveConnection: (id: string | null) => void;
  toggleReadOnlyMode: () => Promise<void>;
  setReadOnlyMode: (value: boolean) => Promise<void>;
  syncReadOnlyMode: (connectionId: string) => Promise<void>;
  getConnection: (id: string) => ConnectionConfig | undefined;
  getActiveConnection: () => ConnectionConfig | undefined;
  setHasHydrated: (state: boolean) => void;
}

// Generate a simple unique ID
const generateId = () => `conn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set, get) => ({
      connections: [],
      activeConnectionId: null,
      // Safe default, and the same default the server applies to a connection
      // it has no recorded state for.
      readOnlyMode: true,
      forceReadOnly: false,
      _hasHydrated: false,

      setHasHydrated: (state: boolean) => {
        set({ _hasHydrated: state });
      },

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

      toggleReadOnlyMode: async () => {
        const { readOnlyMode, setReadOnlyMode } = get();
        await setReadOnlyMode(!readOnlyMode);
      },

      /**
       * Request a read-only setting from the server and adopt whatever it
       * returns. The server's answer wins in both directions: if it refuses to
       * enable writes (FORCE_READ_ONLY) or the request fails, the UI stays on
       * the safe value rather than showing a permission the server won't honor.
       */
      setReadOnlyMode: async (value) => {
        const { activeConnectionId } = get();

        if (!activeConnectionId) {
          set({ readOnlyMode: value });
          return;
        }

        try {
          const response = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              connectionId: activeConnectionId,
              readOnly: value,
            }),
          });

          const data = await response.json().catch(() => ({}));

          if (typeof data.readOnly === 'boolean') {
            set({
              readOnlyMode: data.readOnly,
              forceReadOnly: data.forceReadOnly === true,
            });
            return;
          }

          // Server gave us nothing usable — fail closed.
          set({ readOnlyMode: true });
        } catch (error) {
          console.error('Failed to sync read-only mode with server:', error);
          set({ readOnlyMode: true });
        }
      },

      /**
       * Adopt the server's current read-only state for a connection.
       * Called after connect/reconnect so a locally-persisted preference can
       * never disagree with what the server is enforcing.
       */
      syncReadOnlyMode: async (connectionId) => {
        try {
          const response = await fetch(
            `/api/settings?connectionId=${encodeURIComponent(connectionId)}`
          );
          const data = await response.json().catch(() => ({}));

          if (typeof data.readOnly === 'boolean') {
            set({
              readOnlyMode: data.readOnly,
              forceReadOnly: data.forceReadOnly === true,
            });
          }
        } catch (error) {
          console.error('Failed to read read-only mode from server:', error);
        }
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
      // Persist active connection ID so user stays connected after refresh.
      //
      // `readOnlyMode` is deliberately NOT persisted. Restoring it from
      // localStorage means the UI would render a write-enabled state before the
      // server has confirmed one — which is how the toggle came to disagree with
      // actual server enforcement. It now starts read-only and is corrected by
      // syncReadOnlyMode() once the server answers.
      partialize: (state) => ({
        connections: state.connections,
        activeConnectionId: state.activeConnectionId,
      }),
      version: 2,
      // `partialize` governs what gets written, not what gets read — a blob saved
      // by an earlier version still carries `readOnlyMode`, and the default merge
      // would restore it. Pin the permission fields to their in-memory defaults
      // so a stale `false` can never re-enable writes in the UI before the
      // server has been asked.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<ConnectionState>;
        return {
          ...current,
          ...saved,
          readOnlyMode: current.readOnlyMode,
          forceReadOnly: current.forceReadOnly,
        };
      },
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    }
  )
);

// Selectors for convenience.
//
// Each one subscribes to a single slice. Calling `useConnectionStore()` with no
// selector subscribes to the whole store, so any write — toggling read-only,
// adding a connection, the hydration flag flipping — re-renders every consumer.
// `useActiveConnection` is used by nearly every component, so that mattered.
export const useActiveConnection = () => {
  const connections = useConnectionStore((state) => state.connections);
  const activeConnectionId = useConnectionStore(
    (state) => state.activeConnectionId
  );
  // Returns an element of `connections`, so the reference is stable as long as
  // the array is — no memo needed for consumers using it in dependency arrays.
  return connections.find((conn) => conn.id === activeConnectionId);
};

export const useConnections = () => useConnectionStore((state) => state.connections);
export const useReadOnlyMode = () => useConnectionStore((state) => state.readOnlyMode);
export const useForceReadOnly = () => useConnectionStore((state) => state.forceReadOnly);
export const useHasHydrated = () => useConnectionStore((state) => state._hasHydrated);
