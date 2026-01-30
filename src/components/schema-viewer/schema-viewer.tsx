'use client';

import { useEffect, useState, useCallback, useMemo, memo, useRef } from 'react';
import {
  ReactFlow,
  Node,
  Edge,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  MarkerType,
  Panel,
  BackgroundVariant,
  ConnectionLineType,
  Handle,
  Position,
  useReactFlow,
  ReactFlowProvider,
  getNodesBounds,
  getViewportForBounds,
} from '@xyflow/react';
import { toPng, toSvg } from 'html-to-image';
import '@xyflow/react/dist/style.css';
import { RefreshCw, Download, Search, X, Info, List, Image, FileCode } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useStudioStore } from '@/lib/stores/studio';
import { useActiveConnection } from '@/lib/stores/connection';
import { Relationship, ColumnInfo } from '@/lib/adapters/types';

interface TableNodeData extends Record<string, unknown> {
  label: string;
  columns: ColumnInfo[];
  rowCount?: number;
  isHighlighted?: boolean;
}

const TableNodeComponent = memo(function TableNodeComponent({ data }: { data: TableNodeData }) {
  const pkColumns = data.columns.filter(col => col.isPrimaryKey);
  const fkColumns = data.columns.filter(col => col.isForeignKey);
  const regularColumns = data.columns.filter(col => !col.isPrimaryKey && !col.isForeignKey);

  // Calculate handle positions for each column type
  let handleIndex = 0;
  const getHandleOffset = () => {
    const offset = 44 + handleIndex * 26; // Start after header + column row height
    handleIndex++;
    return offset;
  };

  // Reset for PK handles
  handleIndex = 0;
  const pkHandleOffsets = pkColumns.map(() => getHandleOffset());

  // Continue for FK handles (after PK section + border)
  if (pkColumns.length > 0) handleIndex = pkColumns.length;
  const fkHandleOffsets = fkColumns.map(() => getHandleOffset());

  return (
    <Card className={`min-w-[240px] shadow-lg border-2 transition-colors relative ${data.isHighlighted ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
      {/* Default target handle (fallback - left side center) */}
      <Handle
        type="target"
        position={Position.Left}
        id="default-target"
        style={{
          top: '50%',
          background: '#94a3b8',
          width: 8,
          height: 8,
          border: '2px solid #64748b',
          opacity: pkColumns.length > 0 ? 0 : 1,
        }}
      />

      {/* Default source handle (fallback - right side center) */}
      <Handle
        type="source"
        position={Position.Right}
        id="default-source"
        style={{
          top: '50%',
          background: '#94a3b8',
          width: 8,
          height: 8,
          border: '2px solid #64748b',
          opacity: fkColumns.length > 0 ? 0 : 1,
        }}
      />

      {/* Target handles for Primary Keys (left side - where relationships come IN) */}
      {pkColumns.map((col, idx) => (
        <Handle
          key={`target-${col.name}`}
          type="target"
          position={Position.Left}
          id={`${col.name}-target`}
          style={{
            top: pkHandleOffsets[idx],
            background: '#f59e0b',
            width: 10,
            height: 10,
            border: '2px solid #d97706',
          }}
        />
      ))}

      {/* Source handles for Foreign Keys (right side - where relationships go OUT) */}
      {fkColumns.map((col, idx) => (
        <Handle
          key={`source-${col.name}`}
          type="source"
          position={Position.Right}
          id={`${col.name}-source`}
          style={{
            top: fkHandleOffsets[idx],
            background: '#3b82f6',
            width: 10,
            height: 10,
            border: '2px solid #2563eb',
          }}
        />
      ))}

      <CardHeader className="py-2 px-3 bg-primary text-primary-foreground rounded-t-lg">
        <CardTitle className="text-sm font-semibold flex items-center justify-between">
          <span className="truncate">{data.label}</span>
          {data.rowCount !== undefined && (
            <Badge variant="secondary" className="text-xs ml-2 shrink-0">
              {data.rowCount.toLocaleString()}
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {/* Show loading state or empty message when no columns */}
        {data.columns.length === 0 ? (
          <div className="px-3 py-2 text-xs text-muted-foreground text-center">
            Loading columns...
          </div>
        ) : (
          <>
            {/* Primary Keys */}
            {pkColumns.length > 0 && (
              <div className="border-b border-dashed">
                {pkColumns.map((col) => (
                  <div
                    key={col.name}
                    className="px-3 py-1.5 text-xs flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-950/30 relative"
                  >
                    <span className="flex items-center gap-1.5 font-medium pl-2">
                      <span className="text-amber-600 dark:text-amber-400 text-[10px] font-bold">PK</span>
                      {col.name}
                    </span>
                    <span className="text-muted-foreground text-[10px]">{col.type}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Foreign Keys */}
            {fkColumns.length > 0 && (
              <div className="border-b border-dashed">
                {fkColumns.map((col) => (
                  <div
                    key={col.name}
                    className="px-3 py-1.5 text-xs flex items-center justify-between gap-2 bg-blue-50 dark:bg-blue-950/30 relative"
                  >
                    <span className="flex items-center gap-1.5 pl-2">
                      <span className="text-blue-600 dark:text-blue-400 text-[10px] font-bold">FK</span>
                      {col.name}
                      {col.foreignKeyRef && (
                        <span className="text-[9px] text-muted-foreground">
                          → {col.foreignKeyRef.table}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground text-[10px] pr-2">{col.type}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Regular Columns - Show ALL columns */}
            <div>
              {regularColumns.map((col) => (
                <div
                  key={col.name}
                  className="px-3 py-1 text-xs flex items-center justify-between gap-2"
                >
                  <span className="truncate pl-2">
                    {col.name}
                    {!col.nullable && <span className="text-red-500 ml-0.5">*</span>}
                  </span>
                  <span className="text-muted-foreground text-[10px] shrink-0">{col.type}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
});

// Define node types outside component to prevent recreation
const nodeTypes = {
  tableNode: TableNodeComponent,
};

type SchemaNode = Node<TableNodeData, 'tableNode'>;

// Wrapper component to provide ReactFlow context
export function SchemaViewer() {
  return (
    <ReactFlowProvider>
      <SchemaViewerInner />
    </ReactFlowProvider>
  );
}

function SchemaViewerInner() {
  const activeConnection = useActiveConnection();
  const { tables } = useStudioStore();
  const { setCenter } = useReactFlow();

  const [nodes, setNodes, onNodesChange] = useNodesState<SchemaNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [tableSchemas, setTableSchemas] = useState<Map<string, ColumnInfo[]>>(new Map());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedTable, setHighlightedTable] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Filter tables based on search query
  const filteredTables = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase();
    return tables.filter(t => t.name.toLowerCase().includes(query)).slice(0, 8);
  }, [tables, searchQuery]);

  // Handle table selection from search
  const handleSelectTable = useCallback((tableName: string) => {
    setSearchQuery('');
    setShowSuggestions(false);
    setHighlightedTable(tableName);

    // Find the node and zoom to it
    const node = nodes.find(n => n.id === tableName);
    if (node) {
      // Center view on the selected node
      setTimeout(() => {
        setCenter(node.position.x + 120, node.position.y + 100, { zoom: 1, duration: 500 });
      }, 100);

      // Clear highlight after 3 seconds
      setTimeout(() => {
        setHighlightedTable(null);
      }, 3000);
    }
  }, [nodes, setCenter]);

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery('');
    setShowSuggestions(false);
    setHighlightedTable(null);
  }, []);

  const fetchRelationships = useCallback(async () => {
    if (!activeConnection) return;

    setIsLoading(true);

    try {
      const response = await fetch(
        `/api/schema?connectionId=${activeConnection.id}`
      );
      const data = await response.json();

      if (data.relationships) {
        setRelationships(data.relationships);
      }
    } catch (error) {
      console.error('Failed to fetch relationships:', error);
    } finally {
      setIsLoading(false);
    }
  }, [activeConnection]);

  // Use ref to track which schemas are being fetched to prevent duplicate requests
  const fetchingRef = useRef<Set<string>>(new Set());
  const tableSchemasRef = useRef<Map<string, ColumnInfo[]>>(new Map());

  // Keep ref in sync with state
  useEffect(() => {
    tableSchemasRef.current = tableSchemas;
  }, [tableSchemas]);

  const fetchTableSchema = useCallback(
    async (tableName: string) => {
      if (!activeConnection) return;

      // Check if already fetched or currently fetching
      if (tableSchemasRef.current.has(tableName) || fetchingRef.current.has(tableName)) {
        return;
      }

      // Mark as fetching
      fetchingRef.current.add(tableName);

      try {
        const response = await fetch(
          `/api/schema?connectionId=${activeConnection.id}&table=${encodeURIComponent(tableName)}`
        );
        const data = await response.json();

        if (data.schema) {
          setTableSchemas((prev) => new Map(prev).set(tableName, data.schema));
        }
      } catch (error) {
        console.error(`Failed to fetch schema for ${tableName}:`, error);
      } finally {
        fetchingRef.current.delete(tableName);
      }
    },
    [activeConnection]
  );

  useEffect(() => {
    fetchRelationships();
  }, [fetchRelationships]);

  useEffect(() => {
    // Fetch schemas for all tables
    tables.forEach((table) => {
      fetchTableSchema(table.name);
    });
  }, [tables, fetchTableSchema]);

  // Build nodes when data changes (separate from edge styling)
  useEffect(() => {
    if (tables.length === 0) return;

    // Create a better layout - tables with relationships in the center
    const tablesWithRelations = new Set<string>();
    relationships.forEach(rel => {
      tablesWithRelations.add(rel.sourceTable);
      tablesWithRelations.add(rel.targetTable);
    });

    const relatedTables = tables.filter(t => tablesWithRelations.has(t.name));
    const standaloneTables = tables.filter(t => !tablesWithRelations.has(t.name));

    // Layout related tables in a grid at the top
    const nodeWidth = 260;
    const nodeHeight = 280;
    const padding = 80;

    const relatedCols = Math.max(3, Math.ceil(Math.sqrt(relatedTables.length)));

    const newNodes: SchemaNode[] = [];

    // Add related tables first
    relatedTables.forEach((table, index) => {
      const row = Math.floor(index / relatedCols);
      const col = index % relatedCols;

      newNodes.push({
        id: table.name,
        type: 'tableNode' as const,
        position: {
          x: col * (nodeWidth + padding),
          y: row * (nodeHeight + padding),
        },
        data: {
          label: table.name,
          columns: tableSchemas.get(table.name) || [],
          rowCount: table.rowCount,
          isHighlighted: highlightedTable === table.name,
        },
      });
    });

    // Add standalone tables below
    const standaloneStartY = relatedTables.length > 0
      ? (Math.ceil(relatedTables.length / relatedCols)) * (nodeHeight + padding) + 100
      : 0;
    const standaloneCols = Math.max(4, Math.ceil(Math.sqrt(standaloneTables.length)));

    standaloneTables.forEach((table, index) => {
      const row = Math.floor(index / standaloneCols);
      const col = index % standaloneCols;

      newNodes.push({
        id: table.name,
        type: 'tableNode' as const,
        position: {
          x: col * (nodeWidth + padding),
          y: standaloneStartY + row * (nodeHeight + padding),
        },
        data: {
          label: table.name,
          columns: tableSchemas.get(table.name) || [],
          rowCount: table.rowCount,
          isHighlighted: highlightedTable === table.name,
        },
      });
    });

    setNodes(newNodes);
  }, [tables, relationships, tableSchemas, highlightedTable, setNodes]);

  // Build edges separately (also react to selectedEdge changes)
  useEffect(() => {
    if (relationships.length === 0) {
      setEdges([]);
      return;
    }

    const newEdges: Edge[] = relationships.map((rel) => {
      const edgeId = `edge-${rel.sourceTable}-${rel.sourceColumn}-${rel.targetTable}-${rel.targetColumn}`;
      const isSelected = selectedEdge === edgeId;

      // Get relationship type label
      const relTypeLabel = rel.type === 'one-to-one' ? '1:1' : rel.type === 'many-to-many' ? 'N:N' : '1:N';

      return {
        id: edgeId,
        source: rel.sourceTable,
        target: rel.targetTable,
        sourceHandle: `${rel.sourceColumn}-source`, // Connect from FK column
        targetHandle: `${rel.targetColumn}-target`, // Connect to PK column
        type: 'smoothstep',
        animated: isSelected,
        label: `${relTypeLabel}`,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: isSelected ? '#6366f1' : 'var(--label-bg, rgba(255, 255, 255, 0.95))',
          stroke: isSelected ? '#4f46e5' : 'var(--label-border, #e2e8f0)',
          strokeWidth: 1,
        },
        labelStyle: {
          fontSize: 11,
          fontWeight: 600,
          fill: isSelected ? '#ffffff' : 'var(--label-text, #64748b)',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? '#6366f1' : '#3b82f6',
          width: 16,
          height: 16,
        },
        markerStart: {
          type: MarkerType.Arrow,
          color: isSelected ? '#6366f1' : '#f59e0b',
          width: 12,
          height: 12,
        },
        style: {
          stroke: isSelected ? '#6366f1' : '#94a3b8',
          strokeWidth: isSelected ? 3 : 2,
        },
      };
    });

    setEdges(newEdges);
  }, [relationships, selectedEdge, setEdges]);

  const handleEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    setSelectedEdge(prev => prev === edge.id ? null : edge.id);
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedEdge(null);
  }, []);

  const [isExporting, setIsExporting] = useState(false);
  const { getNodes } = useReactFlow();

  const handleExportImage = useCallback(async (format: 'png' | 'svg' = 'png') => {
    const viewport = document.querySelector('.react-flow__viewport') as HTMLElement;
    if (!viewport || nodes.length === 0) return;

    setIsExporting(true);

    try {
      // Get current nodes from React Flow
      const currentNodes = getNodes();

      // Calculate bounds of all nodes with padding
      const nodesBounds = getNodesBounds(currentNodes);
      const padding = 80;

      // Calculate dimensions - ensure minimum size
      const imageWidth = Math.max(800, nodesBounds.width + padding * 2);
      const imageHeight = Math.max(600, nodesBounds.height + padding * 2);

      // Get viewport transformation that fits all nodes
      const transform = getViewportForBounds(
        nodesBounds,
        imageWidth,
        imageHeight,
        0.5, // minZoom
        2,   // maxZoom
        padding
      );

      // Export options
      const exportOptions = {
        backgroundColor: '#ffffff',
        width: imageWidth,
        height: imageHeight,
        style: {
          width: `${imageWidth}px`,
          height: `${imageHeight}px`,
          transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
        },
        // Ensure all CSS is captured
        cacheBust: true,
        // Filter out interactive UI elements from export
        filter: (node: Element) => {
          // Include all nodes by default
          if (!(node instanceof HTMLElement)) return true;
          const classList = node.classList;
          if (!classList || classList.length === 0) return true;
          // Exclude minimap, controls, panel, and attribution
          const excludeClasses = [
            'react-flow__minimap',
            'react-flow__controls',
            'react-flow__panel',
            'react-flow__attribution',
          ];
          return !excludeClasses.some(cls => classList.contains(cls));
        },
      };

      let dataUrl: string;
      let filename: string;

      if (format === 'svg') {
        dataUrl = await toSvg(viewport, exportOptions);
        filename = `schema_${activeConnection?.name || 'database'}.svg`;
      } else {
        dataUrl = await toPng(viewport, {
          ...exportOptions,
          pixelRatio: 2, // Higher quality for PNG
        });
        filename = `schema_${activeConnection?.name || 'database'}.png`;
      }

      // Create download link
      const link = document.createElement('a');
      link.download = filename;
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Failed to export schema:', error);
      alert('Failed to export schema. Please try again.');
    } finally {
      setIsExporting(false);
    }
  }, [nodes, activeConnection?.name, getNodes]);

  // Stats summary
  const stats = useMemo(() => {
    const tablesWithFK = new Set(relationships.map(r => r.sourceTable)).size;
    const tablesWithPK = tables.filter(t => {
      const schema = tableSchemas.get(t.name);
      return schema?.some(c => c.isPrimaryKey);
    }).length;

    return {
      totalTables: tables.length,
      totalRelationships: relationships.length,
      tablesWithFK,
      tablesWithPK,
    };
  }, [tables, relationships, tableSchemas]);

  // Memoize minimap node color function
  const minimapNodeColor = useCallback((node: Node) => {
    const data = node.data as TableNodeData;
    if (data.isHighlighted) return '#6366f1';
    return '#64748b';
  }, []);

  if (tables.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground">
        No tables found in the database
      </div>
    );
  }

  return (
    <div className="h-full w-full schema-viewer">
      <style jsx global>{`
        .schema-viewer {
          --label-bg: rgba(255, 255, 255, 0.95);
          --label-border: #e2e8f0;
          --label-text: #64748b;
        }
        .dark .schema-viewer {
          --label-bg: rgba(30, 30, 30, 0.95);
          --label-border: #374151;
          --label-text: #9ca3af;
        }
        .react-flow__edge-path {
          stroke-linecap: round;
        }
        .react-flow__edge.selected .react-flow__edge-path {
          stroke: #6366f1 !important;
        }
      `}</style>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgeClick={handleEdgeClick}
        onPaneClick={handlePaneClick}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2}
        connectionLineType={ConnectionLineType.SmoothStep}
        defaultEdgeOptions={{
          type: 'smoothstep',
        }}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          className="!bg-background"
          color="currentColor"
          style={{ opacity: 0.3 }}
          gap={20}
          size={1}
        />
        <Controls className="!bg-background !border !rounded-lg !shadow-sm" />
        <MiniMap
          nodeColor={minimapNodeColor}
          maskColor="rgba(0, 0, 0, 0.1)"
          className="!bg-background !border !rounded-lg !shadow-sm"
          pannable
          zoomable
        />

        {/* Top Right - Search and Actions */}
        <Panel position="top-right" className="flex gap-2 items-start">
          {/* Search Box */}
          <div className="relative">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search tables..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value);
                  setShowSuggestions(true);
                }}
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => {
                  // Delay to allow clicking on suggestions
                  setTimeout(() => setShowSuggestions(false), 200);
                }}
                className="pl-8 pr-8 h-9 w-[200px] bg-background text-sm"
              />
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6"
                  onClick={handleClearSearch}
                >
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Suggestions Dropdown */}
            {showSuggestions && filteredTables.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 max-h-[300px] overflow-auto">
                {filteredTables.map((table) => (
                  <button
                    key={table.name}
                    className="w-full px-3 py-2 text-left text-sm hover:bg-muted flex items-center gap-2 transition-colors"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      handleSelectTable(table.name);
                    }}
                  >
                    <span className="font-medium">{table.name}</span>
                    {table.rowCount !== undefined && (
                      <Badge variant="secondary" className="text-[10px] ml-auto">
                        {table.rowCount.toLocaleString()} rows
                      </Badge>
                    )}
                  </button>
                ))}
              </div>
            )}

            {/* No results message */}
            {showSuggestions && searchQuery && filteredTables.length === 0 && (
              <div className="absolute top-full left-0 right-0 mt-1 bg-background border rounded-md shadow-lg z-50 p-3 text-sm text-muted-foreground text-center">
                No tables found
              </div>
            )}
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={fetchRelationships}
            disabled={isLoading}
            className="bg-background"
          >
            <RefreshCw className={isLoading ? 'h-4 w-4 animate-spin mr-1' : 'h-4 w-4 mr-1'} />
            Refresh
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="bg-background" disabled={isExporting}>
                {isExporting ? (
                  <RefreshCw className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Download className="h-4 w-4 mr-1" />
                )}
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleExportImage('png')}>
                <Image className="h-4 w-4 mr-2" />
                Export as PNG
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleExportImage('svg')}>
                <FileCode className="h-4 w-4 mr-2" />
                Export as SVG
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </Panel>

        {/* Top Left - Legend and Overview Popovers */}
        <Panel position="top-left" className="flex gap-2">
          {/* Legend Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="bg-background">
                <Info className="h-4 w-4 mr-1" />
                Legend
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-auto p-3">
              <div className="text-xs font-medium mb-2">Legend</div>
              <div className="flex flex-col gap-2 text-xs">
                {/* Column Types */}
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-amber-500 border-2 border-amber-600"></div>
                    <span className="text-muted-foreground">PK (Primary Key)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <div className="w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-blue-600"></div>
                    <span className="text-muted-foreground">FK (Foreign Key)</span>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="text-red-500">*</span>
                    <span className="text-muted-foreground">Required</span>
                  </div>
                </div>
                {/* Relationship Types */}
                <Separator className="my-1" />
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <div className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[9px] font-semibold text-slate-600 dark:text-slate-400">1:N</div>
                    <span className="text-muted-foreground">One-to-Many</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[9px] font-semibold text-slate-600 dark:text-slate-400">1:1</div>
                    <span className="text-muted-foreground">One-to-One</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 border text-[9px] font-semibold text-slate-600 dark:text-slate-400">N:N</div>
                    <span className="text-muted-foreground">Many-to-Many</span>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Overview Popover */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="bg-background">
                <List className="h-4 w-4 mr-1" />
                Overview
              </Button>
            </PopoverTrigger>
            <PopoverContent side="bottom" align="start" className="w-80 p-3">
              <div className="text-xs font-medium mb-2">Database Overview</div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Tables:</span>
                  <span className="font-medium">{stats.totalTables}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Relations:</span>
                  <span className="font-medium">{stats.totalRelationships}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">With FK:</span>
                  <span className="font-medium">{stats.tablesWithFK}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">With PK:</span>
                  <span className="font-medium">{stats.tablesWithPK}</span>
                </div>
              </div>

              {relationships.length > 0 && (
                <>
                  <Separator className="my-2" />
                  <div className="text-xs font-medium mb-1">Relationships</div>
                  <ScrollArea className="max-h-[200px]">
                    <div className="space-y-1">
                      {relationships.map((rel) => {
                        const edgeId = `edge-${rel.sourceTable}-${rel.sourceColumn}-${rel.targetTable}-${rel.targetColumn}`;
                        const relTypeLabel = rel.type === 'one-to-one' ? '1:1' : rel.type === 'many-to-many' ? 'N:N' : '1:N';
                        return (
                          <div
                            key={edgeId}
                            className={`text-[10px] p-1.5 rounded cursor-pointer transition-colors ${
                              selectedEdge === edgeId
                                ? 'bg-primary/10 text-primary border border-primary/30'
                                : 'hover:bg-muted'
                            }`}
                            onClick={() => setSelectedEdge(selectedEdge === edgeId ? null : edgeId)}
                          >
                            <div className="flex items-center gap-1.5">
                              <span className="px-1 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[8px] font-bold shrink-0">
                                {relTypeLabel}
                              </span>
                              <div className="flex items-center gap-0.5 flex-wrap">
                                <span className="font-medium">{rel.sourceTable}</span>
                                <span className="text-blue-600 dark:text-blue-400">.{rel.sourceColumn}</span>
                                <span className="mx-0.5 text-muted-foreground">→</span>
                                <span className="font-medium">{rel.targetTable}</span>
                                <span className="text-amber-600 dark:text-amber-400">.{rel.targetColumn}</span>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </ScrollArea>
                </>
              )}
            </PopoverContent>
          </Popover>
        </Panel>
      </ReactFlow>
    </div>
  );
}
