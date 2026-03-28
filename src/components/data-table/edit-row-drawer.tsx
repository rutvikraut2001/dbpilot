'use client';

import { useState, useCallback } from 'react';
import { Loader2, Copy, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ColumnInfo } from '@/lib/adapters/types';
import { toast } from 'sonner';

type RowData = Record<string, unknown>;

function CopyButton({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded hover:bg-muted transition-colors shrink-0"
      title="Copy to clipboard"
    >
      {copied ? (
        <Check className="h-3.5 w-3.5 text-green-500" />
      ) : (
        <Copy className="h-3.5 w-3.5 text-muted-foreground" />
      )}
    </button>
  );
}

function isBooleanType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'boolean' || t === 'bool';
}

function isJsonType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'json' || t === 'jsonb' || t === 'object';
}

function isLargeTextType(type: string): boolean {
  const t = type.toLowerCase();
  return t === 'text' || t === 'longtext' || t === 'mediumtext';
}

function isEnumType(col: ColumnInfo): boolean {
  return Array.isArray(col.enumValues) && col.enumValues.length > 0;
}

function formatDisplayValue(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function getPKValues(row: RowData, schema: ColumnInfo[]): Record<string, unknown> {
  const primaryKeys = schema.filter((col) => col.isPrimaryKey);
  const pkValues = primaryKeys.reduce<Record<string, unknown>>((acc, col) => {
    acc[col.name] = row[col.name];
    return acc;
  }, {});

  if (primaryKeys.length === 0) {
    const idCol = schema.find((c) => c.name === '_id' || c.name === 'id');
    if (idCol) {
      pkValues[idCol.name] = row[idCol.name];
    }
  }
  return pkValues;
}

// ─── Single Field Edit Dialog ──────────────────────────────────────────────

interface EditSingleFieldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  row: RowData;
  columnName: string;
  columnType: string;
  schema: ColumnInfo[];
  connectionId: string;
  readOnly: boolean;
  onSaved: () => void;
}

export function EditSingleFieldDialog({
  open,
  onOpenChange,
  tableName,
  row,
  columnName,
  columnType,
  schema,
  connectionId,
  readOnly,
  onSaved,
}: EditSingleFieldDialogProps) {
  const [value, setValue] = useState<unknown>(() => row[columnName]);
  const [isNull, setIsNull] = useState(() => row[columnName] === null || row[columnName] === undefined);
  const [isSaving, setIsSaving] = useState(false);

  const pkValues = getPKValues(row, schema);
  const colInfo = schema.find((c) => c.name === columnName);
  const colType = columnType.toLowerCase();
  const isBool = isBooleanType(colType);
  const isEnum = colInfo ? isEnumType(colInfo) : false;
  const isJson = isJsonType(colType) || (typeof value === 'object' && value !== null && !isNull);
  const isLargeText = isLargeTextType(colType) || (typeof value === 'string' && value.length > 120);
  const displayValue = formatDisplayValue(isNull ? null : value);

  const handleSave = async () => {
    if (readOnly) return;
    setIsSaving(true);

    try {
      let val = isNull ? null : value;

      if (!isNull) {
        // For booleans, ensure we send a proper boolean
        if (isBool) {
          val = val === true || val === 'true';
        }
        // For JSON fields, validate JSON before sending
        else if (isJson && typeof val === 'string') {
          const trimmed = (val as string).trim();
          try {
            val = JSON.parse(trimmed);
          } catch {
            toast.error('Invalid JSON', { description: 'Please enter valid JSON' });
            setIsSaving(false);
            return;
          }
        }
        // For other string fields, try JSON parse if looks like JSON
        else if (typeof val === 'string') {
          const trimmed = val.trim();
          if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
              (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
            try { val = JSON.parse(trimmed); } catch { /* keep string */ }
          }
        }
      }

      // Send only the changed field, not the entire row
      const updateData: RowData = { [columnName]: val };

      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          table: tableName,
          primaryKey: pkValues,
          data: updateData,
          readOnly,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast.success(`${columnName} updated`);
        onSaved();
        onOpenChange(false);
      } else {
        toast.error('Failed to update', { description: result.error });
      }
    } catch {
      toast.error('Failed to update');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2">
            Edit: <span className="font-mono text-primary">{columnName}</span>
            <span className="text-[10px] font-mono text-muted-foreground font-normal">{columnType}</span>
          </DialogTitle>
          <DialogDescription className="text-xs">
            {tableName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3">
          {colInfo?.nullable && (
            <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={isNull}
                onChange={(e) => {
                  setIsNull(e.target.checked);
                  if (!e.target.checked) setValue(row[columnName] ?? '');
                }}
                className="h-3 w-3 rounded accent-primary"
              />
              Set as NULL
            </label>
          )}

          {isNull ? (
            <div className="h-9 bg-muted/30 rounded-md flex items-center px-3">
              <span className="text-xs text-muted-foreground italic">NULL</span>
            </div>
          ) : isEnum ? (
            <Select value={String(value ?? '')} onValueChange={(v) => setValue(v)}>
              <SelectTrigger className="h-9 text-sm">
                <SelectValue placeholder="Select value..." />
              </SelectTrigger>
              <SelectContent>
                {colInfo!.enumValues!.map((ev) => (
                  <SelectItem key={ev} value={ev}>{ev}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : isBool ? (
            <div className="flex items-center gap-2 h-9">
              <Switch
                checked={value === true || value === 'true'}
                onCheckedChange={(checked) => setValue(checked)}
              />
              <span className="text-sm text-muted-foreground">
                {value === true || value === 'true' ? 'true' : 'false'}
              </span>
            </div>
          ) : isJson ? (
            <Textarea
              value={displayValue}
              onChange={(e) => setValue(e.target.value)}
              className="font-mono text-xs min-h-[120px] resize-y"
              autoFocus
            />
          ) : isLargeText ? (
            <Textarea
              value={displayValue}
              onChange={(e) => setValue(e.target.value)}
              className="text-sm min-h-[80px] resize-y"
              autoFocus
            />
          ) : (
            <Input
              value={displayValue}
              onChange={(e) => setValue(e.target.value)}
              className="text-sm h-9"
              autoFocus
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
          )}
        </div>

        <DialogFooter className="px-5 py-3 border-t">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={isSaving || readOnly}>
            {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Full Row Edit Dialog ──────────────────────────────────────────────────

interface EditRowDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tableName: string;
  row: RowData;
  schema: ColumnInfo[];
  connectionId: string;
  readOnly: boolean;
  onSaved: () => void;
}

export function EditRowDialog({
  open,
  onOpenChange,
  tableName,
  row,
  schema,
  connectionId,
  readOnly,
  onSaved,
}: EditRowDialogProps) {
  const [formData, setFormData] = useState<RowData>(() => ({ ...row }));
  const [nullFields, setNullFields] = useState<Set<string>>(() => {
    const nulls = new Set<string>();
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) nulls.add(key);
    }
    return nulls;
  });
  const [isSaving, setIsSaving] = useState(false);

  const pkValues = getPKValues(row, schema);

  const updateField = useCallback((key: string, value: unknown) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setNullFields((prev) => {
      const next = new Set(prev);
      next.delete(key);
      return next;
    });
  }, []);

  const toggleNull = useCallback((key: string, setNull: boolean) => {
    if (setNull) {
      setNullFields((prev) => new Set(prev).add(key));
      setFormData((prev) => ({ ...prev, [key]: null }));
    } else {
      setNullFields((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      setFormData((prev) => ({ ...prev, [key]: row[key] ?? '' }));
    }
  }, [row]);

  const handleSave = async () => {
    if (readOnly) return;
    setIsSaving(true);

    try {
      const updateData: RowData = {};
      for (const key of Object.keys(formData)) {
        if (nullFields.has(key)) {
          updateData[key] = null;
        } else {
          let value = formData[key];
          const col = columns.find((c) => c.name === key);
          const colType = col?.type.toLowerCase() || '';

          // For booleans, ensure we send a proper boolean
          if (isBooleanType(colType)) {
            value = value === true || value === 'true';
          }
          // For JSON fields, validate and parse
          else if (isJsonType(colType) || (typeof value === 'object' && value !== null)) {
            if (typeof value === 'string') {
              const trimmed = value.trim();
              try {
                value = JSON.parse(trimmed);
              } catch {
                toast.error('Invalid JSON', { description: `Field "${key}" contains invalid JSON` });
                setIsSaving(false);
                return;
              }
            }
          }
          // For other string fields, try JSON parse if looks like JSON
          else if (typeof value === 'string') {
            const trimmed = value.trim();
            if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
                (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
              try { value = JSON.parse(trimmed); } catch { /* keep string */ }
            }
          }
          updateData[key] = value;
        }
      }

      const response = await fetch('/api/data', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          connectionId,
          table: tableName,
          primaryKey: pkValues,
          data: updateData,
          readOnly,
        }),
      });

      const result = await response.json();
      if (result.success) {
        toast.success('Row updated successfully');
        onSaved();
        onOpenChange(false);
      } else {
        toast.error('Failed to update row', { description: result.error });
      }
    } catch {
      toast.error('Failed to update row');
    } finally {
      setIsSaving(false);
    }
  };

  const columns = schema.length > 0
    ? schema
    : Object.keys(row).map((key) => ({
        name: key,
        type: typeof row[key] === 'object' ? 'json' : typeof row[key],
        nullable: true,
        isPrimaryKey: key === 'id' || key === '_id',
        isForeignKey: false,
      } as ColumnInfo));

  const pkColumns = columns.filter((col) => col.isPrimaryKey);
  const editableColumns = columns.filter((col) => !col.isPrimaryKey);
  const hasPKs = pkColumns.length > 0;

  // Dynamic size and grid layout based on column count
  const colCount = editableColumns.length;
  const sizeClass = colCount <= 4
    ? 'max-w-lg'
    : colCount <= 8
      ? 'max-w-2xl'
      : colCount <= 14
        ? 'max-w-4xl'
        : colCount <= 20
          ? 'max-w-5xl'
          : 'max-w-6xl';
  const gridClass = colCount <= 4
    ? 'grid-cols-1'
    : colCount <= 12
      ? 'grid-cols-1 md:grid-cols-2'
      : 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${sizeClass} max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden`}>
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0">
          <DialogTitle className="text-base font-semibold">
            Edit Row — {tableName}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Modify field values below and save changes.
          </DialogDescription>
        </DialogHeader>

        {hasPKs && (
          <div className="px-6 pb-3 flex flex-wrap gap-3 border-b shrink-0">
            {pkColumns.map((col) => {
              const value = formatDisplayValue(row[col.name]);
              return (
                <div key={col.name} className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5">
                  <span className="text-xs text-muted-foreground">{col.name}:</span>
                  <span className="text-xs font-mono">{value}</span>
                  <CopyButton value={value} />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">
          <div className={`grid ${gridClass} gap-x-6 gap-y-4`}>
            {editableColumns.map((col) => {
              const colType = col.type.toLowerCase();
              const isNull = nullFields.has(col.name);
              const currentValue = isNull ? null : formData[col.name];
              const displayValue = formatDisplayValue(currentValue);
              const isEnum = isEnumType(col);
              const isJson = isJsonType(colType) || (typeof currentValue === 'object' && currentValue !== null);
              const isLargeText = isLargeTextType(colType) || (typeof currentValue === 'string' && currentValue.length > 120);
              const isBool = isBooleanType(colType);
              const isWide = isJson || isLargeText;

              return (
                <div key={col.name} className={isWide ? 'md:col-span-2' : ''}>
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <label className="text-sm font-medium">{col.name}</label>
                      <span className="text-[10px] font-mono text-muted-foreground">{col.type}</span>
                      {col.isForeignKey && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20">FK</Badge>
                      )}
                    </div>
                    {col.nullable && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isNull}
                          onChange={(e) => toggleNull(col.name, e.target.checked)}
                          className="h-3 w-3 rounded border-muted-foreground/40 accent-primary"
                        />
                        NULL
                      </label>
                    )}
                  </div>

                  {isNull ? (
                    <div className="h-9 bg-muted/30 rounded-md flex items-center px-3">
                      <span className="text-xs text-muted-foreground italic">NULL</span>
                    </div>
                  ) : isEnum ? (
                    <Select value={String(currentValue ?? '')} onValueChange={(v) => updateField(col.name, v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select value..." />
                      </SelectTrigger>
                      <SelectContent>
                        {col.enumValues!.map((ev) => (
                          <SelectItem key={ev} value={ev}>{ev}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : isBool ? (
                    <div className="flex items-center gap-2 h-9">
                      <Switch
                        checked={currentValue === true || currentValue === 'true'}
                        onCheckedChange={(checked) => updateField(col.name, checked)}
                      />
                      <span className="text-sm text-muted-foreground">
                        {currentValue === true || currentValue === 'true' ? 'true' : 'false'}
                      </span>
                    </div>
                  ) : isJson ? (
                    <Textarea
                      value={displayValue}
                      onChange={(e) => updateField(col.name, e.target.value)}
                      className="font-mono text-xs min-h-[100px] resize-y"
                    />
                  ) : isLargeText ? (
                    <Textarea
                      value={displayValue}
                      onChange={(e) => updateField(col.name, e.target.value)}
                      className="text-sm min-h-[80px] resize-y"
                    />
                  ) : (
                    <Input
                      value={displayValue}
                      onChange={(e) => updateField(col.name, e.target.value)}
                      className="text-sm h-9"
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={isSaving || readOnly}>
            {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save Changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
