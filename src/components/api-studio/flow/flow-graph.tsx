'use client';

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  MarkerType,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';
import { METHOD_COLORS } from '@/lib/api-studio/constants';
import type { Collection, HttpMethod, HttpRequest } from '@/lib/api-studio/types';
import { useApiStudioStore } from '@/lib/stores/api-studio';

interface RequestNodeData extends Record<string, unknown> {
  label: string;
  method: HttpMethod;
  collectionId: string;
  requestId: string;
}

function RequestNode({ data }: NodeProps) {
  const d = data as RequestNodeData;
  const color = METHOD_COLORS[d.method];
  return (
    <div className={`rounded-md border px-3 py-2 min-w-40 bg-background shadow-sm ${color.border}`}>
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-2">
        <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${color.text} ${color.bg} ${color.border} border`}>
          {d.method}
        </span>
        <span className="text-xs font-medium truncate max-w-48">{d.label}</span>
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { request: RequestNode };

interface VarEdge {
  producerId: string;
  consumerId: string;
  variable: string;
}

function tokensIn(str: string): Set<string> {
  const out = new Set<string>();
  const rx = /\{\{\s*([\w.\-]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = rx.exec(str))) out.add(m[1]);
  return out;
}

function collectTokensFromRequest(r: HttpRequest): Set<string> {
  const out = new Set<string>();
  for (const t of tokensIn(r.url)) out.add(t);
  for (const p of r.params) {
    for (const t of tokensIn(p.value)) out.add(t);
    for (const t of tokensIn(p.key)) out.add(t);
  }
  for (const h of r.headers) {
    for (const t of tokensIn(h.value)) out.add(t);
  }
  if (r.body.raw) for (const t of tokensIn(r.body.raw)) out.add(t);
  for (const kv of r.body.urlencoded ?? []) for (const t of tokensIn(kv.value)) out.add(t);
  for (const kv of r.body.formData ?? []) for (const t of tokensIn(kv.value)) out.add(t);
  if (r.auth.token) for (const t of tokensIn(r.auth.token)) out.add(t);
  if (r.auth.username) for (const t of tokensIn(r.auth.username)) out.add(t);
  if (r.auth.password) for (const t of tokensIn(r.auth.password)) out.add(t);
  if (r.auth.apiKey?.value) for (const t of tokensIn(r.auth.apiKey.value)) out.add(t);
  return out;
}

function buildGraph(collections: Collection[]): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];

  // producer map: variable name -> [{ collectionId, requestId, requestName }]
  const producers = new Map<string, { collectionId: string; requestId: string; requestName: string }[]>();

  for (const c of collections) {
    for (const rid of Object.keys(c.requests)) {
      const r = c.requests[rid];
      for (const cap of r.captures) {
        if (!cap.name) continue;
        const list = producers.get(cap.name) ?? [];
        list.push({ collectionId: c.id, requestId: rid, requestName: r.name });
        producers.set(cap.name, list);
      }
    }
  }

  const varEdges: VarEdge[] = [];
  const nodeIds = new Set<string>();

  // column layout per collection
  let colIndex = 0;
  for (const c of collections) {
    const ids = Object.keys(c.requests);
    if (ids.length === 0) continue;
    let row = 0;
    for (const rid of ids) {
      const r = c.requests[rid];
      const nodeId = `${c.id}:${rid}`;
      nodeIds.add(nodeId);
      nodes.push({
        id: nodeId,
        type: 'request',
        position: { x: colIndex * 280, y: row * 80 },
        data: {
          label: r.name || 'Untitled',
          method: r.method,
          collectionId: c.id,
          requestId: rid,
        } as RequestNodeData,
      });
      row++;

      const tokens = collectTokensFromRequest(r);
      for (const token of tokens) {
        const sources = producers.get(token);
        if (!sources) continue;
        for (const src of sources) {
          if (src.requestId === rid) continue;
          varEdges.push({
            producerId: `${src.collectionId}:${src.requestId}`,
            consumerId: nodeId,
            variable: token,
          });
        }
      }
    }
    colIndex++;
  }

  const seen = new Set<string>();
  for (const e of varEdges) {
    const key = `${e.producerId}→${e.consumerId}:${e.variable}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!nodeIds.has(e.producerId) || !nodeIds.has(e.consumerId)) continue;
    edges.push({
      id: key,
      source: e.producerId,
      target: e.consumerId,
      label: `{{${e.variable}}}`,
      animated: true,
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--color-api-mid)' },
      labelStyle: { fontSize: 10, fill: 'var(--color-api-mid)' },
    });
  }

  return { nodes, edges };
}

export function FlowGraph({ onClose }: Readonly<{ onClose: () => void }>) {
  const collections = useApiStudioStore((s) => s.collections);
  const openRequestTab = useApiStudioStore((s) => s.openRequestTab);
  const setFlowOpen = useApiStudioStore((s) => s.setFlowOpen);

  const { nodes, edges } = useMemo(() => buildGraph(collections), [collections]);

  const onNodeClick = useCallback(
    (_: unknown, node: Node) => {
      const d = node.data as RequestNodeData;
      openRequestTab(d.collectionId, d.requestId);
      setFlowOpen(false);
      onClose();
    },
    [openRequestTab, setFlowOpen, onClose]
  );

  return (
    <div className="absolute inset-0 bg-background flex flex-col z-20">
      <div className="flex items-center justify-between px-3 py-2 border-b">
        <div>
          <h3 className="text-sm font-semibold api-text">Flow Graph</h3>
          <p className="text-[11px] text-muted-foreground">
            Arrows show variables captured by one request and consumed by another. Click a node to
            open it.
          </p>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose}>
          <X className="h-4 w-4 mr-1" /> Close
        </Button>
      </div>
      <div className="flex-1 min-h-0">
        {nodes.length === 0 ? (
          <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
            Create some requests first, then define response captures to see the flow.
          </div>
        ) : (
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            onNodeClick={onNodeClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Dots} gap={16} />
            <MiniMap pannable zoomable />
            <Controls />
          </ReactFlow>
        )}
      </div>
    </div>
  );
}
