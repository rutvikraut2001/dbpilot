import { useMemo } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { TableInfo, ColumnInfo, QueryResult } from '../adapters/types';

export type TabType =
  | 'data'
  | 'schema'
  | 'query'
  | 'indexes'
  | 'structure'
  | 'analytics';

export interface DataTab {
  id: string;
  tableName: string;
  filter?: { column: string; value: unknown };
  label: string;
}

interface QueryTab {
  id: string;
  name: string;
  query: string;
  result: QueryResult | null;
  isExecuting: boolean;
  /**
   * Identifies the in-flight execution so it can be cancelled. Set while
   * running, cleared when it settles.
   */
  runId?: string;
  /**
   * Whether the last result came from a highlighted selection rather than the
   * whole editor. Surfaced in the results header: running a fragment can return
   * a perfectly valid answer to a query the user did not think they ran.
   */
  ranSelection?: boolean;
}

export interface QueryHistoryEntry {
  id: string;
  query: string;
  timestamp: number;
  database: string;
  /** Server-reported execution time, when the query reached the server. */
  durationMs?: number;
  rowCount?: number;
  success: boolean;
  error?: string;
}

export interface SavedQuery {
  id: string;
  name: string;
  query: string;
  createdAt: number;
}

interface StudioState {
  // Tables/Collections
  tables: TableInfo[];
  selectedTable: string | null;
  tableSchema: ColumnInfo[];
  isLoadingTables: boolean;
  isLoadingSchema: boolean;

  // Active tab in the main panel
  activeTab: TabType;

  // Schema viewer focus: when set, the ER diagram shows only this table + its
  // directly related tables. The nonce lets repeated "Show diagram" clicks on the
  // same table re-trigger the focus effect.
  schemaFocusTable: string | null;
  schemaFocusNonce: number;

  // Data tabs
  dataTabs: DataTab[];
  activeDataTabId: string | null;

  // Query tabs
  queryTabs: QueryTab[];
  activeQueryTabId: string | null;

  // Query history
  queryHistory: QueryHistoryEntry[];

  // Named queries the user chose to keep. Deliberately not scoped to a
  // connection — a query worth saving is usually worth reusing elsewhere.
  savedQueries: SavedQuery[];

  // Sidebar state
  sidebarOpen: boolean;
  sidebarWidth: number;
  tableFilter: string;

  // Error state
  error: string | null;

  // Which connection the persisted tabs belong to. Tabs name tables, so
  // restoring them against a different database would show tabs for tables that
  // may not exist there.
  persistedForConnectionId: string | null;

  // Actions
  setTables: (tables: TableInfo[]) => void;
  setSelectedTable: (table: string | null) => void;
  setTableSchema: (schema: ColumnInfo[]) => void;
  setIsLoadingTables: (loading: boolean) => void;
  setIsLoadingSchema: (loading: boolean) => void;
  setActiveTab: (tab: TabType) => void;
  setSchemaFocusTable: (table: string | null) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setTableFilter: (filter: string) => void;
  setError: (error: string | null) => void;

  // Data tab actions
  openTableTab: (tableName: string) => string;
  addDataTab: (tableName: string, filter?: { column: string; value: unknown }) => string;
  removeDataTab: (id: string) => void;
  clearAllDataTabs: () => void;
  setActiveDataTab: (id: string) => void;

  // Query tab actions
  addQueryTab: () => string;
  removeQueryTab: (id: string) => void;
  setActiveQueryTab: (id: string) => void;
  updateQueryTab: (id: string, updates: Partial<QueryTab>) => void;
  addToHistory: (entry: Omit<QueryHistoryEntry, 'id' | 'timestamp'>) => void;
  clearHistory: () => void;

  // Saved query actions
  saveQuery: (name: string, query: string) => string;
  removeSavedQuery: (id: string) => void;

  // Reset state (for disconnection)
  reset: () => void;

  // Called once the studio knows which connection is active. Keeps restored
  // tabs only if they belong to that same connection.
  hydrateForConnection: (connectionId: string) => void;
}

const generateTabId = (prefix = 'tab') => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

const initialQueryTab: QueryTab = {
  id: generateTabId(),
  name: 'Query 1',
  query: '',
  result: null,
  isExecuting: false,
};

const initialState = {
  tables: [],
  selectedTable: null,
  tableSchema: [],
  isLoadingTables: false,
  isLoadingSchema: false,
  activeTab: 'data' as TabType,
  schemaFocusTable: null as string | null,
  schemaFocusNonce: 0,
  dataTabs: [] as DataTab[],
  activeDataTabId: null as string | null,
  queryTabs: [initialQueryTab],
  activeQueryTabId: initialQueryTab.id,
  queryHistory: [] as QueryHistoryEntry[],
  savedQueries: [] as SavedQuery[],
  sidebarOpen: true,
  sidebarWidth: 280,
  tableFilter: '',
  error: null,
  persistedForConnectionId: null as string | null,
};

export const useStudioStore = create<StudioState>()(
  persist(
    (set, get) => ({
  ...initialState,

  setTables: (tables) => set({ tables }),

  setSelectedTable: (table) => set({ selectedTable: table }),

  setTableSchema: (schema) => set({ tableSchema: schema }),

  setIsLoadingTables: (loading) => set({ isLoadingTables: loading }),

  setIsLoadingSchema: (loading) => set({ isLoadingSchema: loading }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSchemaFocusTable: (table) =>
    set((state) => ({
      schemaFocusTable: table,
      schemaFocusNonce: state.schemaFocusNonce + 1,
    })),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),

  setTableFilter: (filter) => set({ tableFilter: filter }),

  setError: (error) => set({ error }),

  openTableTab: (tableName) => {
    const { dataTabs } = get();
    // Check if tab already exists (matching tableName, no filter)
    const existing = dataTabs.find(t => t.tableName === tableName && !t.filter);
    if (existing) {
      set({ activeDataTabId: existing.id, selectedTable: tableName, activeTab: 'data' });
      return existing.id;
    }
    // Create new tab
    const newTab: DataTab = {
      id: generateTabId('data'),
      tableName,
      label: tableName,
    };
    set({
      dataTabs: [...dataTabs, newTab],
      activeDataTabId: newTab.id,
      selectedTable: tableName,
      activeTab: 'data',
    });
    return newTab.id;
  },

  addDataTab: (tableName, filter) => {
    const { dataTabs } = get();
    const label = filter
      ? `${tableName} (${filter.column} = ${String(filter.value)})`
      : tableName;
    const newTab: DataTab = {
      id: generateTabId('data'),
      tableName,
      filter,
      label,
    };

    set({
      dataTabs: [...dataTabs, newTab],
      activeDataTabId: newTab.id,
      activeTab: 'data',
    });

    return newTab.id;
  },

  removeDataTab: (id) => {
    const { dataTabs, activeDataTabId } = get();

    const newTabs = dataTabs.filter((tab) => tab.id !== id);
    let newActiveId = activeDataTabId;

    if (activeDataTabId === id) {
      if (newTabs.length > 0) {
        const removedIndex = dataTabs.findIndex((tab) => tab.id === id);
        newActiveId = newTabs[Math.min(removedIndex, newTabs.length - 1)]?.id || null;
      } else {
        newActiveId = null;
      }
    }

    // Update selectedTable based on the new active tab
    const newActiveTab = newTabs.find(t => t.id === newActiveId);
    const newSelectedTable = newActiveTab && !newActiveTab.filter ? newActiveTab.tableName : (newActiveTab ? get().selectedTable : null);

    set({
      dataTabs: newTabs,
      activeDataTabId: newActiveId,
      selectedTable: newSelectedTable,
    });
  },

  clearAllDataTabs: () => {
    set({
      dataTabs: [],
      activeDataTabId: null,
      selectedTable: null,
    });
  },

  setActiveDataTab: (id) => set({ activeDataTabId: id }),

  addQueryTab: () => {
    const { queryTabs } = get();
    const newTab: QueryTab = {
      id: generateTabId(),
      name: `Query ${queryTabs.length + 1}`,
      query: '',
      result: null,
      isExecuting: false,
    };

    set({
      queryTabs: [...queryTabs, newTab],
      activeQueryTabId: newTab.id,
    });

    return newTab.id;
  },

  removeQueryTab: (id) => {
    const { queryTabs, activeQueryTabId } = get();

    // Don't remove if it's the last tab
    if (queryTabs.length <= 1) return;

    const newTabs = queryTabs.filter((tab) => tab.id !== id);
    let newActiveId = activeQueryTabId;

    // If we're removing the active tab, switch to another
    if (activeQueryTabId === id) {
      const removedIndex = queryTabs.findIndex((tab) => tab.id === id);
      newActiveId = newTabs[Math.min(removedIndex, newTabs.length - 1)]?.id || null;
    }

    set({
      queryTabs: newTabs,
      activeQueryTabId: newActiveId,
    });
  },

  setActiveQueryTab: (id) => set({ activeQueryTabId: id }),

  updateQueryTab: (id, updates) => {
    set((state) => ({
      queryTabs: state.queryTabs.map((tab) =>
        tab.id === id ? { ...tab, ...updates } : tab
      ),
    }));
  },

  addToHistory: (entry) => {
    set((state) => ({
      queryHistory: [
        { ...entry, id: generateTabId('hist'), timestamp: Date.now() },
        ...state.queryHistory.slice(0, 99), // Keep last 100
      ],
    }));
  },

  clearHistory: () => set({ queryHistory: [] }),

  saveQuery: (name, query) => {
    const saved: SavedQuery = {
      id: generateTabId('saved'),
      name,
      query,
      createdAt: Date.now(),
    };
    set((state) => ({ savedQueries: [saved, ...state.savedQueries] }));
    return saved.id;
  },

  removeSavedQuery: (id) => {
    set((state) => ({
      savedQueries: state.savedQueries.filter((q) => q.id !== id),
    }));
  },

  reset: () => {
    const newTab: QueryTab = {
      id: generateTabId(),
      name: 'Query 1',
      query: '',
      result: null,
      isExecuting: false,
    };

    set({
      ...initialState,
      dataTabs: [],
      activeDataTabId: null,
      queryTabs: [newTab],
      activeQueryTabId: newTab.id,
      // Saved queries are a library and history is a log; neither belongs to
      // the connection being disconnected.
      savedQueries: get().savedQueries,
      queryHistory: get().queryHistory,
    });
  },

  hydrateForConnection: (connectionId) => {
    const { persistedForConnectionId } = get();
    if (persistedForConnectionId === connectionId) return;

    // Restored tabs belong to a different database — drop them rather than
    // showing tabs for tables that may not exist here.
    const newTab: QueryTab = {
      id: generateTabId(),
      name: 'Query 1',
      query: '',
      result: null,
      isExecuting: false,
    };

    set({
      dataTabs: [],
      activeDataTabId: null,
      selectedTable: null,
      tableSchema: [],
      tableFilter: '',
      queryTabs: [newTab],
      activeQueryTabId: newTab.id,
      error: null,
      persistedForConnectionId: connectionId,
    });
  },
    }),
    {
      name: 'db-studio-workspace',
      // Open tabs, unsaved query text, and the sidebar layout survive a reload;
      // loaded rows, schemas and transient flags do not.
      //
      // Query *results* are deliberately excluded: a result set can be thousands
      // of rows, and localStorage has a few megabytes total.
      partialize: (state) => ({
        dataTabs: state.dataTabs,
        activeDataTabId: state.activeDataTabId,
        selectedTable: state.selectedTable,
        activeTab: state.activeTab,
        queryTabs: state.queryTabs.map((tab) => ({
          ...tab,
          result: null,
          isExecuting: false,
        })),
        activeQueryTabId: state.activeQueryTabId,
        queryHistory: state.queryHistory,
        savedQueries: state.savedQueries,
        sidebarOpen: state.sidebarOpen,
        sidebarWidth: state.sidebarWidth,
        persistedForConnectionId: state.persistedForConnectionId,
      }),
    }
  )
);

// Selectors
export const useQueryHistory = () => useStudioStore((state) => state.queryHistory);
export const useSavedQueries = () => useStudioStore((state) => state.savedQueries);
export const useSelectedTable = () => useStudioStore((state) => state.selectedTable);
export const useTables = () => useStudioStore((state) => state.tables);
export const useFilteredTables = () => {
  const tables = useStudioStore((state) => state.tables);
  const filter = useStudioStore((state) => state.tableFilter);

  // Memoized because the filtered branch allocates a new array on every call.
  // Without this the sidebar received a new array identity on every render,
  // defeating any downstream memoization and re-running the virtualizer's
  // measurement for a list that had not actually changed.
  return useMemo(() => {
    if (!filter) return tables;
    const lowerFilter = filter.toLowerCase();
    return tables.filter((table) =>
      table.name.toLowerCase().includes(lowerFilter)
    );
  }, [tables, filter]);
};
