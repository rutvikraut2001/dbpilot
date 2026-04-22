'use client';

import { useState } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FolderPlus,
  FilePlus,
  MoreHorizontal,
  Trash2,
  FolderClosed,
  FolderOpen,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { MethodPill } from '../method-pill';
import { useApiStudioStore, SCRATCH_COLLECTION_ID } from '@/lib/stores/api-studio';
import type { Collection, Folder } from '@/lib/api-studio/types';
import { cn } from '@/lib/utils';

function FolderNode({
  collection,
  folder,
  depth,
  expanded,
  toggle,
}: Readonly<{
  collection: Collection;
  folder: Folder;
  depth: number;
  expanded: Record<string, boolean>;
  toggle: (id: string) => void;
}>) {
  const addFolder = useApiStudioStore((s) => s.addFolder);
  const addRequest = useApiStudioStore((s) => s.addRequest);
  const deleteFolder = useApiStudioStore((s) => s.deleteFolder);
  const openRequestTab = useApiStudioStore((s) => s.openRequestTab);
  const deleteRequest = useApiStudioStore((s) => s.deleteRequest);
  const duplicateRequest = useApiStudioStore((s) => s.duplicateRequest);

  const isRoot = folder.id === collection.rootFolder.id;
  const open = isRoot ? true : expanded[folder.id];

  return (
    <div>
      {!isRoot && (
        <div
          className="group flex items-center gap-1 px-1 py-1 text-sm hover:bg-muted rounded cursor-pointer"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <button
            type="button"
            onClick={() => toggle(folder.id)}
            className="p-0.5"
            aria-label={open ? 'Collapse folder' : 'Expand folder'}
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
          {open ? (
            <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <FolderClosed className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          <span className="flex-1 truncate">{folder.name}</span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="opacity-0 group-hover:opacity-100"
                aria-label="Folder menu"
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                onClick={() => addRequest(collection.id, folder.id, {})}
              >
                <FilePlus className="h-3.5 w-3.5 mr-2" /> Add request
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => addFolder(collection.id, folder.id, 'New folder')}
              >
                <FolderPlus className="h-3.5 w-3.5 mr-2" /> Add subfolder
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onClick={() => deleteFolder(collection.id, folder.id)}
                variant="destructive"
              >
                <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete folder
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {open && (
        <div>
          {folder.folderIds.map((childId) => {
            const child = collection.folders[childId];
            if (!child) return null;
            return (
              <FolderNode
                key={child.id}
                collection={collection}
                folder={child}
                depth={depth + 1}
                expanded={expanded}
                toggle={toggle}
              />
            );
          })}
          {folder.requestIds.map((rid) => {
            const req = collection.requests[rid];
            if (!req) return null;
            return (
              <div
                key={rid}
                className="group flex items-center gap-2 px-1 py-1 text-sm hover:bg-muted rounded cursor-pointer"
                style={{ paddingLeft: (depth + 1) * 12 + 4 }}
                onClick={() => openRequestTab(collection.id, rid)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') openRequestTab(collection.id, rid);
                }}
                role="button"
                tabIndex={0}
              >
                <MethodPill method={req.method} className="shrink-0" />
                <span className="flex-1 truncate">{req.name || 'Untitled'}</span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="opacity-0 group-hover:opacity-100"
                      aria-label="Request menu"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        duplicateRequest(collection.id, rid);
                      }}
                    >
                      Duplicate
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteRequest(collection.id, rid);
                      }}
                      variant="destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          })}
          {!isRoot && folder.folderIds.length === 0 && folder.requestIds.length === 0 && (
            <p
              className="text-[11px] text-muted-foreground italic py-1"
              style={{ paddingLeft: (depth + 1) * 12 + 4 }}
            >
              Empty folder
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export function CollectionsTree({
  onNewCollection,
  onImport,
}: Readonly<{
  onNewCollection: () => void;
  onImport: () => void;
}>) {
  const collections = useApiStudioStore((s) => s.collections);
  const deleteCollection = useApiStudioStore((s) => s.deleteCollection);
  const addRequest = useApiStudioStore((s) => s.addRequest);
  const addFolder = useApiStudioStore((s) => s.addFolder);

  const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({
    [SCRATCH_COLLECTION_ID]: true,
  });
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  const toggleCollection = (id: string) =>
    setExpandedCollections((e) => ({ ...e, [id]: !e[id] }));
  const toggleFolder = (id: string) =>
    setExpandedFolders((e) => ({ ...e, [id]: !e[id] }));

  return (
    <div className="p-2 space-y-1">
      <div className="flex items-center gap-1 pb-1">
        <Button size="sm" variant="outline" onClick={onNewCollection} className="flex-1">
          <FolderPlus className="h-3.5 w-3.5 mr-1" /> New
        </Button>
        <Button size="sm" variant="outline" onClick={onImport} className="flex-1">
          Import
        </Button>
      </div>
      {collections.map((c) => {
        const open = expandedCollections[c.id] ?? false;
        const isScratch = c.id === SCRATCH_COLLECTION_ID;
        return (
          <div key={c.id} className="border rounded-md">
            <div
              className="group flex items-center gap-1 px-2 py-1.5 text-sm font-medium cursor-pointer hover:bg-muted rounded-t-md"
              onClick={() => toggleCollection(c.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') toggleCollection(c.id);
              }}
              role="button"
              tabIndex={0}
            >
              {open ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              <span
                className={cn(
                  'flex-1 truncate',
                  isScratch && 'api-text'
                )}
              >
                {c.name}
              </span>
              <span className="text-[10px] text-muted-foreground">
                {Object.keys(c.requests).length}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="opacity-0 group-hover:opacity-100"
                    aria-label="Collection menu"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      addRequest(c.id, c.rootFolder.id, {});
                    }}
                  >
                    <FilePlus className="h-3.5 w-3.5 mr-2" /> Add request
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation();
                      addFolder(c.id, c.rootFolder.id, 'New folder');
                    }}
                  >
                    <FolderPlus className="h-3.5 w-3.5 mr-2" /> Add folder
                  </DropdownMenuItem>
                  {!isScratch && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          deleteCollection(c.id);
                        }}
                        variant="destructive"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete collection
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            {open && (
              <div className="pb-1 border-t">
                <FolderNode
                  collection={c}
                  folder={c.folders[c.rootFolder.id] ?? c.rootFolder}
                  depth={0}
                  expanded={expandedFolders}
                  toggle={toggleFolder}
                />
                {Object.keys(c.requests).length === 0 && (
                  <p className="text-[11px] text-muted-foreground italic px-3 py-2">
                    No requests yet. Add one from the ••• menu.
                  </p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
