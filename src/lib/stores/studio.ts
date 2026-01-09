import { create } from 'zustand';
import { TableInfo, ColumnInfo, QueryResult } from '../adapters/types';

export type TabType = 'data' | 'schema' | 'query' | 'analytics';

interface QueryTab {
  id: string;
  name: string;
  query: string;
  result: QueryResult | null;
  isExecuting: boolean;
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

  // Query tabs
  queryTabs: QueryTab[];
  activeQueryTabId: string | null;

  // Query history
  queryHistory: { query: string; timestamp: number; database: string }[];

  // Sidebar state
  sidebarOpen: boolean;
  sidebarWidth: number;
  tableFilter: string;

  // Error state
  error: string | null;

  // Actions
  setTables: (tables: TableInfo[]) => void;
  setSelectedTable: (table: string | null) => void;
  setTableSchema: (schema: ColumnInfo[]) => void;
  setIsLoadingTables: (loading: boolean) => void;
  setIsLoadingSchema: (loading: boolean) => void;
  setActiveTab: (tab: TabType) => void;
  setSidebarOpen: (open: boolean) => void;
  setSidebarWidth: (width: number) => void;
  setTableFilter: (filter: string) => void;
  setError: (error: string | null) => void;

  // Query tab actions
  addQueryTab: () => string;
  removeQueryTab: (id: string) => void;
  setActiveQueryTab: (id: string) => void;
  updateQueryTab: (id: string, updates: Partial<QueryTab>) => void;
  addToHistory: (query: string, database: string) => void;

  // Reset state (for disconnection)
  reset: () => void;
}

const generateTabId = () => `query_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

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
  queryTabs: [initialQueryTab],
  activeQueryTabId: initialQueryTab.id,
  queryHistory: [],
  sidebarOpen: true,
  sidebarWidth: 280,
  tableFilter: '',
  error: null,
};

export const useStudioStore = create<StudioState>()((set, get) => ({
  ...initialState,

  setTables: (tables) => set({ tables }),

  setSelectedTable: (table) => set({ selectedTable: table }),

  setTableSchema: (schema) => set({ tableSchema: schema }),

  setIsLoadingTables: (loading) => set({ isLoadingTables: loading }),

  setIsLoadingSchema: (loading) => set({ isLoadingSchema: loading }),

  setActiveTab: (tab) => set({ activeTab: tab }),

  setSidebarOpen: (open) => set({ sidebarOpen: open }),

  setSidebarWidth: (width) => set({ sidebarWidth: Math.max(200, Math.min(500, width)) }),

  setTableFilter: (filter) => set({ tableFilter: filter }),

  setError: (error) => set({ error }),

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

  addToHistory: (query, database) => {
    set((state) => ({
      queryHistory: [
        { query, timestamp: Date.now(), database },
        ...state.queryHistory.slice(0, 99), // Keep last 100
      ],
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
      queryTabs: [newTab],
      activeQueryTabId: newTab.id,
    });
  },
}));

// Selectors
export const useSelectedTable = () => useStudioStore((state) => state.selectedTable);
export const useTables = () => useStudioStore((state) => state.tables);
export const useFilteredTables = () => {
  const tables = useStudioStore((state) => state.tables);
  const filter = useStudioStore((state) => state.tableFilter);

  if (!filter) return tables;

  const lowerFilter = filter.toLowerCase();
  return tables.filter((table) => table.name.toLowerCase().includes(lowerFilter));
};
