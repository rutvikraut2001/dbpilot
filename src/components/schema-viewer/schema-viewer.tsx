'use client';

import { useEffect, useState, useCallback, useMemo, memo } from 'react';
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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { RefreshCw, Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
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

  return (
    <Card className={`min-w-[220px] shadow-lg border-2 transition-colors ${data.isHighlighted ? 'border-primary ring-2 ring-primary/20' : 'border-border'}`}>
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
        <ScrollArea className="max-h-[250px]">
          {/* Primary Keys */}
          {pkColumns.length > 0 && (
            <div className="border-b border-dashed">
              {pkColumns.map((col) => (
                <div
                  key={col.name}
                  className="px-3 py-1.5 text-xs flex items-center justify-between gap-2 bg-amber-50 dark:bg-amber-950/30"
                >
                  <span className="flex items-center gap-1.5 font-medium">
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
                  className="px-3 py-1.5 text-xs flex items-center justify-between gap-2 bg-blue-50 dark:bg-blue-950/30"
                >
                  <span className="flex items-center gap-1.5">
                    <span className="text-blue-600 dark:text-blue-400 text-[10px] font-bold">FK</span>
                    {col.name}
                    {col.foreignKeyRef && (
                      <span className="text-[9px] text-muted-foreground">
                        → {col.foreignKeyRef.table}
                      </span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-[10px]">{col.type}</span>
                </div>
              ))}
            </div>
          )}

          {/* Regular Columns */}
          <div>
            {regularColumns.slice(0, 10).map((col) => (
              <div
                key={col.name}
                className="px-3 py-1 text-xs flex items-center justify-between gap-2"
              >
                <span className="truncate">
                  {col.name}
                  {!col.nullable && <span className="text-red-500 ml-0.5">*</span>}
                </span>
                <span className="text-muted-foreground text-[10px] shrink-0">{col.type}</span>
              </div>
            ))}
            {regularColumns.length > 10 && (
              <div className="px-3 py-1.5 text-xs text-muted-foreground text-center bg-muted/50">
                +{regularColumns.length - 10} more columns
              </div>
            )}
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
});

// Define node types outside component to prevent recreation
const nodeTypes = {
  tableNode: TableNodeComponent,
};

type SchemaNode = Node<TableNodeData, 'tableNode'>;

export function SchemaViewer() {
  const activeConnection = useActiveConnection();
  const { tables } = useStudioStore();

  const [nodes, setNodes, onNodesChange] = useNodesState<SchemaNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [relationships, setRelationships] = useState<Relationship[]>([]);
  const [tableSchemas, setTableSchemas] = useState<Map<string, ColumnInfo[]>>(new Map());
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);

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

  const fetchTableSchema = useCallback(
    async (tableName: string) => {
      if (!activeConnection || tableSchemas.has(tableName)) return;

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
      }
    },
    [activeConnection, tableSchemas]
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
          isHighlighted: false,
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
          isHighlighted: false,
        },
      });
    });

    setNodes(newNodes);
  }, [tables, relationships, tableSchemas, setNodes]);

  // Build edges separately (also react to selectedEdge changes)
  useEffect(() => {
    if (relationships.length === 0) {
      setEdges([]);
      return;
    }

    const newEdges: Edge[] = relationships.map((rel, index) => {
      const edgeId = `edge-${rel.sourceTable}-${rel.sourceColumn}-${rel.targetTable}-${rel.targetColumn}`;
      const isSelected = selectedEdge === edgeId;

      return {
        id: edgeId,
        source: rel.sourceTable,
        target: rel.targetTable,
        type: 'smoothstep',
        animated: isSelected,
        label: `${rel.sourceColumn} → ${rel.targetColumn}`,
        labelBgPadding: [8, 4] as [number, number],
        labelBgBorderRadius: 4,
        labelBgStyle: {
          fill: 'var(--label-bg, rgba(255, 255, 255, 0.95))',
          stroke: 'var(--label-border, #e2e8f0)',
          strokeWidth: 1,
        },
        labelStyle: {
          fontSize: 10,
          fontWeight: 500,
          fill: 'var(--label-text, #64748b)',
        },
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: isSelected ? '#6366f1' : '#64748b',
          width: 20,
          height: 20,
        },
        style: {
          stroke: isSelected ? '#6366f1' : '#64748b',
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

  const handleExportImage = useCallback(() => {
    const svg = document.querySelector('.react-flow__viewport');
    if (!svg) return;

    const svgData = new XMLSerializer().serializeToString(svg);
    const blob = new Blob([svgData], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schema_${activeConnection?.name || 'database'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  }, [activeConnection?.name]);

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

        {/* Top Right - Actions */}
        <Panel position="top-right" className="flex gap-2">
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
          <Button variant="outline" size="sm" onClick={handleExportImage} className="bg-background">
            <Download className="h-4 w-4 mr-1" />
            Export
          </Button>
        </Panel>

        {/* Bottom Left - Stats */}
        <Panel position="bottom-left" className="bg-background/95 backdrop-blur p-3 rounded-lg border shadow-sm max-w-xs">
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
              <ScrollArea className="max-h-[120px]">
                <div className="space-y-1">
                  {relationships.map((rel) => {
                    const edgeId = `edge-${rel.sourceTable}-${rel.sourceColumn}-${rel.targetTable}-${rel.targetColumn}`;
                    return (
                      <div
                        key={edgeId}
                        className={`text-[10px] p-1.5 rounded cursor-pointer transition-colors ${
                          selectedEdge === edgeId
                            ? 'bg-primary/10 text-primary'
                            : 'hover:bg-muted'
                        }`}
                        onClick={() => setSelectedEdge(selectedEdge === edgeId ? null : edgeId)}
                      >
                        <span className="font-medium">{rel.sourceTable}</span>
                        <span className="text-muted-foreground">.{rel.sourceColumn}</span>
                        <span className="mx-1">→</span>
                        <span className="font-medium">{rel.targetTable}</span>
                        <span className="text-muted-foreground">.{rel.targetColumn}</span>
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            </>
          )}
        </Panel>

        {/* Legend */}
        <Panel position="top-left" className="bg-background/95 backdrop-blur p-2 rounded-lg border shadow-sm text-xs">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <div className="w-5 h-3 bg-amber-100 dark:bg-amber-950/50 border border-amber-300 dark:border-amber-700 rounded text-[8px] flex items-center justify-center font-bold text-amber-700 dark:text-amber-400">PK</div>
              <span className="text-muted-foreground">Primary Key</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="w-5 h-3 bg-blue-100 dark:bg-blue-950/50 border border-blue-300 dark:border-blue-700 rounded text-[8px] flex items-center justify-center font-bold text-blue-700 dark:text-blue-400">FK</div>
              <span className="text-muted-foreground">Foreign Key</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-red-500">*</span>
              <span className="text-muted-foreground">Required</span>
            </div>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}
