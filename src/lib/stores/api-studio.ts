import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Collection,
  Environment,
  HistoryEntry,
  HttpRequest,
  OpenRequestTab,
  SidebarTab,
  Folder,
} from '../api-studio/types';
import { createCollection, createEnvironment, createFolder, createRequest, requestsEqual } from '../api-studio/factory';
import { MAX_HISTORY_ENTRIES } from '../api-studio/constants';
import { newId } from '../api-studio/ids';

interface ApiStudioState {
  collections: Collection[];
  environments: Environment[];
  activeEnvironmentId: string | null;
  history: HistoryEntry[];

  // Ephemeral (not persisted)
  openTabs: OpenRequestTab[];
  activeTabId: string | null;
  sidebarTab: SidebarTab;
  sidebarOpen: boolean;
  flowOpen: boolean;

  _hasHydrated: boolean;
  setHasHydrated: (v: boolean) => void;

  // Collections
  addCollection: (name: string) => string;
  importCollection: (collection: Collection) => void;
  renameCollection: (id: string, name: string) => void;
  deleteCollection: (id: string) => void;

  // Folders
  addFolder: (collectionId: string, parentFolderId: string, name: string) => string;
  renameFolder: (collectionId: string, folderId: string, name: string) => void;
  deleteFolder: (collectionId: string, folderId: string) => void;

  // Requests
  addRequest: (collectionId: string, parentFolderId: string, init?: Partial<HttpRequest>) => string;
  updateRequest: (collectionId: string, requestId: string, updates: Partial<HttpRequest>) => void;
  deleteRequest: (collectionId: string, requestId: string) => void;
  duplicateRequest: (collectionId: string, requestId: string) => string | null;
  getRequest: (collectionId: string, requestId: string) => HttpRequest | undefined;

  // Tabs
  openRequestTab: (collectionId: string, requestId: string) => void;
  openScratchTab: () => string;
  closeTab: (tabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateDraft: (tabId: string, patch: Partial<HttpRequest>) => void;
  saveActiveDraft: () => void;

  // Environments
  addEnvironment: (name: string) => string;
  updateEnvironment: (id: string, updates: Partial<Omit<Environment, 'id' | 'createdAt'>>) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnvironment: (id: string | null) => void;

  // History
  pushHistory: (entry: Omit<HistoryEntry, 'id'>) => void;
  clearHistory: () => void;

  // UI
  setSidebarTab: (tab: SidebarTab) => void;
  setSidebarOpen: (open: boolean) => void;
  setFlowOpen: (open: boolean) => void;
}

const scratchCollectionId = 'col_scratch';

function ensureScratchCollection(collections: Collection[]): Collection[] {
  if (collections.find((c) => c.id === scratchCollectionId)) return collections;
  const now = Date.now();
  const root = createFolder('__root__', 'fld_scratch_root');
  const scratch: Collection = {
    id: scratchCollectionId,
    name: 'Scratchpad',
    description: 'Ad-hoc requests that do not belong to a saved collection.',
    rootFolder: root,
    requests: {},
    folders: { [root.id]: root },
    variables: [],
    createdAt: now,
    updatedAt: now,
  };
  return [scratch, ...collections];
}

function removeFromFolders(folders: Record<string, Folder>, requestId: string) {
  for (const f of Object.values(folders)) {
    const i = f.requestIds.indexOf(requestId);
    if (i >= 0) f.requestIds.splice(i, 1);
  }
}

function detachFolderFromParent(folders: Record<string, Folder>, folderId: string) {
  for (const f of Object.values(folders)) {
    const i = f.folderIds.indexOf(folderId);
    if (i >= 0) f.folderIds.splice(i, 1);
  }
}

function collectDescendantIds(folders: Record<string, Folder>, folderId: string): { folders: string[]; requests: string[] } {
  const out = { folders: [] as string[], requests: [] as string[] };
  const stack = [folderId];
  while (stack.length) {
    const id = stack.pop()!;
    const f = folders[id];
    if (!f) continue;
    out.folders.push(id);
    out.requests.push(...f.requestIds);
    stack.push(...f.folderIds);
  }
  return out;
}

export const useApiStudioStore = create<ApiStudioState>()(
  persist(
    (set, get) => ({
      collections: ensureScratchCollection([]),
      environments: [],
      activeEnvironmentId: null,
      history: [],

      openTabs: [],
      activeTabId: null,
      sidebarTab: 'collections',
      sidebarOpen: true,
      flowOpen: false,

      _hasHydrated: false,
      setHasHydrated: (v) => set({ _hasHydrated: v }),

      addCollection: (name) => {
        const c = createCollection(name);
        set((s) => ({ collections: [...s.collections, c] }));
        return c.id;
      },

      importCollection: (collection) => {
        set((s) => ({ collections: [...s.collections, collection] }));
      },

      renameCollection: (id, name) => {
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === id ? { ...c, name, updatedAt: Date.now() } : c
          ),
        }));
      },

      deleteCollection: (id) => {
        if (id === scratchCollectionId) return;
        set((s) => ({
          collections: s.collections.filter((c) => c.id !== id),
          openTabs: s.openTabs.filter((t) => t.collectionId !== id),
          activeTabId: s.openTabs.find((t) => t.id === s.activeTabId)?.collectionId === id
            ? null
            : s.activeTabId,
        }));
      },

      addFolder: (collectionId, parentFolderId, name) => {
        const folder = createFolder(name);
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            const parent = c.folders[parentFolderId] ?? c.rootFolder;
            const updatedParent = { ...parent, folderIds: [...parent.folderIds, folder.id] };
            const isRoot = parent.id === c.rootFolder.id;
            return {
              ...c,
              folders: { ...c.folders, [folder.id]: folder, [parent.id]: updatedParent },
              rootFolder: isRoot ? updatedParent : c.rootFolder,
              updatedAt: Date.now(),
            };
          }),
        }));
        return folder.id;
      },

      renameFolder: (collectionId, folderId, name) => {
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId || !c.folders[folderId]) return c;
            return {
              ...c,
              folders: { ...c.folders, [folderId]: { ...c.folders[folderId], name } },
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      deleteFolder: (collectionId, folderId) => {
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            if (folderId === c.rootFolder.id) return c;
            const { folders: folderIds, requests: requestIds } = collectDescendantIds(c.folders, folderId);
            const foldersCopy = { ...c.folders };
            detachFolderFromParent(foldersCopy, folderId);
            for (const f of folderIds) delete foldersCopy[f];
            const requestsCopy = { ...c.requests };
            for (const r of requestIds) delete requestsCopy[r];
            return {
              ...c,
              folders: foldersCopy,
              requests: requestsCopy,
              rootFolder: foldersCopy[c.rootFolder.id] ?? c.rootFolder,
              updatedAt: Date.now(),
            };
          }),
          openTabs: s.openTabs.filter((t) => {
            if (t.collectionId !== collectionId) return true;
            const c = s.collections.find((col) => col.id === collectionId);
            return c ? c.requests[t.requestId] !== undefined : true;
          }),
        }));
      },

      addRequest: (collectionId, parentFolderId, init) => {
        const req = createRequest(init);
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            const parent = c.folders[parentFolderId] ?? c.rootFolder;
            const updatedParent = { ...parent, requestIds: [...parent.requestIds, req.id] };
            const isRoot = parent.id === c.rootFolder.id;
            return {
              ...c,
              requests: { ...c.requests, [req.id]: req },
              folders: { ...c.folders, [parent.id]: updatedParent },
              rootFolder: isRoot ? updatedParent : c.rootFolder,
              updatedAt: Date.now(),
            };
          }),
        }));
        return req.id;
      },

      updateRequest: (collectionId, requestId, updates) => {
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId || !c.requests[requestId]) return c;
            const merged = { ...c.requests[requestId], ...updates } as HttpRequest;
            return {
              ...c,
              requests: { ...c.requests, [requestId]: merged },
              updatedAt: Date.now(),
            };
          }),
        }));
      },

      deleteRequest: (collectionId, requestId) => {
        set((s) => {
          const collections = s.collections.map((c) => {
            if (c.id !== collectionId || !c.requests[requestId]) return c;
            const foldersCopy = { ...c.folders };
            removeFromFolders(foldersCopy, requestId);
            const requestsCopy = { ...c.requests };
            delete requestsCopy[requestId];
            return {
              ...c,
              folders: foldersCopy,
              requests: requestsCopy,
              rootFolder: foldersCopy[c.rootFolder.id] ?? c.rootFolder,
              updatedAt: Date.now(),
            };
          });
          const openTabs = s.openTabs.filter(
            (t) => !(t.collectionId === collectionId && t.requestId === requestId)
          );
          const activeTabId = openTabs.find((t) => t.id === s.activeTabId)?.id ?? openTabs[0]?.id ?? null;
          return { collections, openTabs, activeTabId };
        });
      },

      duplicateRequest: (collectionId, requestId) => {
        const state = get();
        const c = state.collections.find((col) => col.id === collectionId);
        if (!c) return null;
        const src = c.requests[requestId];
        if (!src) return null;
        const clone = createRequest({ ...src, name: `${src.name} (copy)` });
        const parent = Object.values(c.folders).find((f) => f.requestIds.includes(requestId)) ?? c.rootFolder;
        set((s) => ({
          collections: s.collections.map((col) => {
            if (col.id !== collectionId) return col;
            const updatedParent = { ...col.folders[parent.id], requestIds: [...col.folders[parent.id].requestIds, clone.id] };
            const isRoot = parent.id === col.rootFolder.id;
            return {
              ...col,
              requests: { ...col.requests, [clone.id]: clone },
              folders: { ...col.folders, [parent.id]: updatedParent },
              rootFolder: isRoot ? updatedParent : col.rootFolder,
              updatedAt: Date.now(),
            };
          }),
        }));
        return clone.id;
      },

      getRequest: (collectionId, requestId) => {
        const c = get().collections.find((col) => col.id === collectionId);
        return c?.requests[requestId];
      },

      openRequestTab: (collectionId, requestId) => {
        const state = get();
        const existing = state.openTabs.find((t) => t.collectionId === collectionId && t.requestId === requestId);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const req = state.getRequest(collectionId, requestId);
        if (!req) return;
        const tab: OpenRequestTab = {
          id: newId('tab'),
          collectionId,
          requestId,
          draft: { ...req, params: [...req.params], headers: [...req.headers], captures: [...req.captures], body: { ...req.body } },
          dirty: false,
        };
        set((s) => ({ openTabs: [...s.openTabs, tab], activeTabId: tab.id }));
      },

      openScratchTab: () => {
        const state = get();
        let scratch = state.collections.find((c) => c.id === scratchCollectionId);
        if (!scratch) {
          set((s) => ({ collections: ensureScratchCollection(s.collections) }));
          scratch = get().collections.find((c) => c.id === scratchCollectionId)!;
        }
        const req = createRequest({ name: 'Untitled Request' });
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== scratchCollectionId) return c;
            const updatedRoot = { ...c.rootFolder, requestIds: [...c.rootFolder.requestIds, req.id] };
            return {
              ...c,
              requests: { ...c.requests, [req.id]: req },
              folders: { ...c.folders, [c.rootFolder.id]: updatedRoot },
              rootFolder: updatedRoot,
              updatedAt: Date.now(),
            };
          }),
        }));
        const tab: OpenRequestTab = {
          id: newId('tab'),
          collectionId: scratchCollectionId,
          requestId: req.id,
          draft: req,
          dirty: false,
        };
        set((s) => ({ openTabs: [...s.openTabs, tab], activeTabId: tab.id }));
        return tab.id;
      },

      closeTab: (tabId) => {
        set((s) => {
          const openTabs = s.openTabs.filter((t) => t.id !== tabId);
          let activeTabId = s.activeTabId;
          if (s.activeTabId === tabId) {
            const idx = s.openTabs.findIndex((t) => t.id === tabId);
            activeTabId = openTabs[Math.min(idx, openTabs.length - 1)]?.id ?? null;
          }
          return { openTabs, activeTabId };
        });
      },

      setActiveTab: (tabId) => set({ activeTabId: tabId }),

      updateDraft: (tabId, patch) => {
        set((s) => ({
          openTabs: s.openTabs.map((t) => {
            if (t.id !== tabId) return t;
            const draft = { ...t.draft, ...patch } as HttpRequest;
            const stored = s.collections.find((c) => c.id === t.collectionId)?.requests[t.requestId];
            const dirty = stored ? !requestsEqual(draft, stored) : true;
            return { ...t, draft, dirty };
          }),
        }));
      },

      saveActiveDraft: () => {
        const state = get();
        const tab = state.openTabs.find((t) => t.id === state.activeTabId);
        if (!tab) return;
        state.updateRequest(tab.collectionId, tab.requestId, tab.draft);
        set((s) => ({
          openTabs: s.openTabs.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)),
        }));
      },

      addEnvironment: (name) => {
        const env = createEnvironment(name);
        set((s) => ({ environments: [...s.environments, env] }));
        return env.id;
      },

      updateEnvironment: (id, updates) => {
        set((s) => ({
          environments: s.environments.map((e) => (e.id === id ? { ...e, ...updates } : e)),
        }));
      },

      deleteEnvironment: (id) => {
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id),
          activeEnvironmentId: s.activeEnvironmentId === id ? null : s.activeEnvironmentId,
        }));
      },

      setActiveEnvironment: (id) => set({ activeEnvironmentId: id }),

      pushHistory: (entry) => {
        set((s) => ({
          history: [
            { id: newId('hist'), ...entry },
            ...s.history.slice(0, MAX_HISTORY_ENTRIES - 1),
          ],
        }));
      },

      clearHistory: () => set({ history: [] }),

      setSidebarTab: (tab) => set({ sidebarTab: tab }),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setFlowOpen: (open) => set({ flowOpen: open }),
    }),
    {
      name: 'db-studio-api-studio',
      version: 1,
      partialize: (s) => ({
        collections: s.collections,
        environments: s.environments,
        activeEnvironmentId: s.activeEnvironmentId,
        history: s.history,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.collections = ensureScratchCollection(state.collections ?? []);
          state.setHasHydrated(true);
        }
      },
    }
  )
);

// Selectors
export const useApiHasHydrated = () => useApiStudioStore((s) => s._hasHydrated);

export const useActiveApiTab = () => {
  const activeTabId = useApiStudioStore((s) => s.activeTabId);
  const openTabs = useApiStudioStore((s) => s.openTabs);
  return openTabs.find((t) => t.id === activeTabId) ?? null;
};

export const useActiveApiEnvironment = () => {
  const id = useApiStudioStore((s) => s.activeEnvironmentId);
  const envs = useApiStudioStore((s) => s.environments);
  return envs.find((e) => e.id === id) ?? null;
};

export const SCRATCH_COLLECTION_ID = scratchCollectionId;
