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

function CopyButton({ value }: Readonly<{ value: string }>) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <button
      type="button"
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

function getDialogSizeClass(colCount: number): string {
  if (colCount <= 4) return 'sm:max-w-lg';
  if (colCount <= 8) return 'sm:max-w-[min(95vw,900px)]';
  if (colCount <= 16) return 'sm:max-w-[min(95vw,1200px)]';
  return 'sm:max-w-[min(96vw,1500px)]';
}

function getDialogGridClass(colCount: number): string {
  if (colCount <= 4) return 'grid-cols-1';
  if (colCount <= 8) return 'grid-cols-1 sm:grid-cols-2';
  if (colCount <= 16) return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
}

function selectValueFor(currentValue: unknown): string {
  if (currentValue === null || currentValue === undefined) return '';
  if (typeof currentValue === 'object') return JSON.stringify(currentValue);
  return String(currentValue);
}

function looksLikeJsonLiteral(s: string): boolean {
  return (s.startsWith('{') && s.endsWith('}')) || (s.startsWith('[') && s.endsWith(']'));
}

type CoerceResult = { ok: true; value: unknown } | { ok: false };

function coerceFieldValue(value: unknown, colType: string): CoerceResult {
  if (isBooleanType(colType)) {
    return { ok: true, value: value === true || value === 'true' };
  }
  const treatAsJson = isJsonType(colType) || (typeof value === 'object' && value !== null);
  if (treatAsJson && typeof value === 'string') {
    try {
      return { ok: true, value: JSON.parse(value.trim()) };
    } catch {
      return { ok: false };
    }
  }
  if (!treatAsJson && typeof value === 'string') {
    const trimmed = value.trim();
    if (looksLikeJsonLiteral(trimmed)) {
      try {
        return { ok: true, value: JSON.parse(trimmed) };
      } catch {
        return { ok: true, value };
      }
    }
  }
  return { ok: true, value };
}

interface SingleFieldEditorProps {
  isNull: boolean;
  isEnum: boolean;
  enumValues: string[];
  isBool: boolean;
  isJson: boolean;
  isLargeText: boolean;
  value: unknown;
  displayValue: string;
  onChange: (value: unknown) => void;
  onEnterSave: () => void;
}

function SingleFieldEditor({
  isNull,
  isEnum,
  enumValues,
  isBool,
  isJson,
  isLargeText,
  value,
  displayValue,
  onChange,
  onEnterSave,
}: Readonly<SingleFieldEditorProps>) {
  if (isNull) {
    return (
      <div className="h-9 bg-muted/30 rounded-md flex items-center px-3">
        <span className="text-xs text-muted-foreground italic">NULL</span>
      </div>
    );
  }
  if (isEnum) {
    return (
      <Select value={selectValueFor(value)} onValueChange={onChange}>
        <SelectTrigger className="h-9 text-sm w-full">
          <SelectValue placeholder="Select value..." />
        </SelectTrigger>
        <SelectContent className="max-h-[40vh]">
          {enumValues.map((ev) => (
            <SelectItem key={ev} value={ev}>{ev}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (isBool) {
    const checked = value === true || value === 'true';
    return (
      <div className="flex items-center gap-2 h-9">
        <Switch checked={checked} onCheckedChange={onChange} />
        <span className="text-sm text-muted-foreground">{checked ? 'true' : 'false'}</span>
      </div>
    );
  }
  if (isJson) {
    return (
      <Textarea
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs min-h-[120px] max-h-[50vh] resize-y break-all w-full field-sizing-fixed overflow-auto"
        autoFocus
      />
    );
  }
  if (isLargeText) {
    return (
      <Textarea
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        className="text-sm min-h-20 max-h-[50vh] resize-y break-all w-full field-sizing-fixed overflow-auto"
        autoFocus
      />
    );
  }
  return (
    <Input
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm h-9 w-full min-w-0"
      autoFocus
      onKeyDown={(e) => { if (e.key === 'Enter') onEnterSave(); }}
    />
  );
}

interface FieldEditorProps {
  col: ColumnInfo;
  currentValue: unknown;
  displayValue: string;
  isNull: boolean;
  // Ties the rendered control to its <label htmlFor>, so the field name is
  // announced by screen readers and addressable by name in tests.
  inputId: string;
  onChange: (value: unknown) => void;
}

function FieldEditor({ col, currentValue, displayValue, isNull, inputId, onChange }: Readonly<FieldEditorProps>) {
  if (isNull) {
    return (
      <div id={inputId} className="h-9 bg-muted/30 rounded-md flex items-center px-3">
        <span className="text-xs text-muted-foreground italic">NULL</span>
      </div>
    );
  }

  const enumValues = col.enumValues ?? [];
  if (enumValues.length > 0) {
    return (
      <Select value={selectValueFor(currentValue)} onValueChange={onChange}>
        <SelectTrigger id={inputId} className="h-9 text-sm w-full min-w-0">
          <SelectValue placeholder="Select value..." />
        </SelectTrigger>
        <SelectContent className="max-h-[40vh]">
          {enumValues.map((ev) => (
            <SelectItem key={ev} value={ev}>{ev}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  const colType = col.type.toLowerCase();
  if (isBooleanType(colType)) {
    const checked = currentValue === true || currentValue === 'true';
    return (
      <div className="flex items-center gap-2 h-9">
        <Switch id={inputId} checked={checked} onCheckedChange={onChange} />
        <span className="text-sm text-muted-foreground">{checked ? 'true' : 'false'}</span>
      </div>
    );
  }

  const isJson = isJsonType(colType) || (typeof currentValue === 'object' && currentValue !== null);
  if (isJson) {
    return (
      <Textarea
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        id={inputId}
        className="font-mono text-xs min-h-25 max-h-[40vh] resize-y break-all w-full min-w-0 overflow-auto"
      />
    );
  }

  const isLargeText = isLargeTextType(colType) || (typeof currentValue === 'string' && currentValue.length > 120);
  if (isLargeText) {
    return (
      <Textarea
        value={displayValue}
        onChange={(e) => onChange(e.target.value)}
        id={inputId}
        className="text-sm min-h-20 max-h-[40vh] resize-y break-all w-full min-w-0 overflow-auto"
      />
    );
  }

  return (
    <Input
      id={inputId}
      value={displayValue}
      onChange={(e) => onChange(e.target.value)}
      className="text-sm h-9 w-full min-w-0"
    />
  );
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
}: Readonly<EditSingleFieldDialogProps>) {
  const [value, setValue] = useState<unknown>(() => row[columnName]);
  const [isNull, setIsNull] = useState(() => row[columnName] === null || row[columnName] === undefined);
  const [isSaving, setIsSaving] = useState(false);

  const pkValues = getPKValues(row, schema);
  const colInfo = schema.find((c) => c.name === columnName);
  const colType = columnType.toLowerCase();
  const isBool = isBooleanType(colType);
  const enumValues = colInfo?.enumValues ?? [];
  const isEnum = enumValues.length > 0;
  const isJson = isJsonType(colType) || (typeof value === 'object' && value !== null && !isNull);
  const isLargeText = isLargeTextType(colType) || (typeof value === 'string' && value.length > 120);
  const displayValue = formatDisplayValue(isNull ? null : value);

  const handleSave = async () => {
    if (readOnly) return;
    setIsSaving(true);

    try {
      let val: unknown = null;
      if (!isNull) {
        const result = coerceFieldValue(value, colType);
        if (!result.ok) {
          toast.error('Invalid JSON', { description: 'Please enter valid JSON' });
          setIsSaving(false);
          return;
        }
        val = result.value;
      }

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
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-5 pt-5 pb-3 min-w-0">
          <DialogTitle className="text-sm font-semibold flex items-center gap-2 min-w-0">
            <span className="shrink-0">Edit:</span>
            <span className="font-mono text-primary truncate">{columnName}</span>
            <span className="text-[10px] font-mono text-muted-foreground font-normal shrink-0">{columnType}</span>
          </DialogTitle>
          <DialogDescription className="text-xs truncate">
            {tableName}
          </DialogDescription>
        </DialogHeader>

        <div className="px-5 py-4 space-y-3 min-w-0">
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
              <span>Set as NULL</span>
            </label>
          )}

          <SingleFieldEditor
            isNull={isNull}
            isEnum={isEnum}
            enumValues={enumValues}
            isBool={isBool}
            isJson={isJson}
            isLargeText={isLargeText}
            value={value}
            displayValue={displayValue}
            onChange={setValue}
            onEnterSave={handleSave}
          />
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
}: Readonly<EditRowDialogProps>) {
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

  const columns: ColumnInfo[] = schema.length > 0
    ? schema
    : Object.keys(row).map((key) => ({
        name: key,
        type: typeof row[key] === 'object' ? 'json' : typeof row[key],
        nullable: true,
        isPrimaryKey: key === 'id' || key === '_id',
        isForeignKey: false,
      }));

  const pkColumns = columns.filter((col) => col.isPrimaryKey);
  const editableColumns = columns.filter((col) => !col.isPrimaryKey);
  const hasPKs = pkColumns.length > 0;

  const handleSave = async () => {
    if (readOnly) return;
    setIsSaving(true);

    try {
      const updateData: RowData = {};
      for (const key of Object.keys(formData)) {
        if (nullFields.has(key)) {
          updateData[key] = null;
          continue;
        }
        const col = columns.find((c) => c.name === key);
        const colType = col?.type.toLowerCase() ?? '';
        const result = coerceFieldValue(formData[key], colType);
        if (!result.ok) {
          toast.error('Invalid JSON', { description: `Field "${key}" contains invalid JSON` });
          setIsSaving(false);
          return;
        }
        updateData[key] = result.value;
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

  const colCount = editableColumns.length;
  const sizeClass = getDialogSizeClass(colCount);
  const gridClass = getDialogGridClass(colCount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={`${sizeClass} max-h-[90vh] flex flex-col p-0 gap-0 overflow-hidden`}>
        <DialogHeader className="px-6 pt-6 pb-3 shrink-0 min-w-0">
          <DialogTitle className="text-base font-semibold truncate">
            Edit Row — {tableName}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Modify field values below and save changes.
          </DialogDescription>
        </DialogHeader>

        {hasPKs && (
          <div className="px-6 pb-3 flex flex-wrap gap-2 border-b shrink-0 min-w-0">
            {pkColumns.map((col) => {
              const value = formatDisplayValue(row[col.name]);
              return (
                <div key={col.name} className="flex items-center gap-2 bg-muted/50 rounded-md px-3 py-1.5 max-w-full min-w-0">
                  <span className="text-xs text-muted-foreground shrink-0">{col.name}:</span>
                  <span className="text-xs font-mono truncate">{value}</span>
                  <CopyButton value={value} />
                </div>
              );
            })}
          </div>
        )}

        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden px-6 py-4">
          {editableColumns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 px-4 text-center gap-2">
              <p className="text-sm font-medium">No editable columns</p>
              <p className="text-xs text-muted-foreground max-w-md">
                Every column in this table is part of the primary key (likely a junction/join table).
                To change a row, delete it and insert a new one with the desired key values.
              </p>
            </div>
          ) : (
          <div className={`grid ${gridClass} gap-x-6 gap-y-4`}>
            {editableColumns.map((col) => {
              const colType = col.type.toLowerCase();
              const isNull = nullFields.has(col.name);
              const currentValue = isNull ? null : formData[col.name];
              const displayValue = formatDisplayValue(currentValue);
              const isJson = isJsonType(colType) || (typeof currentValue === 'object' && currentValue !== null);
              const isLargeText = isLargeTextType(colType) || (typeof currentValue === 'string' && currentValue.length > 120);
              const isWide = isJson || isLargeText;

              return (
                <div key={col.name} className={`min-w-0 ${isWide ? 'md:col-span-2 xl:col-span-2' : ''}`}>
                  <div className="flex items-start justify-between gap-2 mb-1.5 min-w-0">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <label
                          htmlFor={`edit-field-${col.name}`}
                          className="text-sm font-medium wrap-break-word leading-tight"
                          title={col.name}
                        >
                          {col.name}
                        </label>
                        {col.isForeignKey && (
                          <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20 shrink-0">FK</Badge>
                        )}
                      </div>
                      <div
                        className="text-[10px] font-mono text-muted-foreground leading-tight mt-0.5 truncate"
                        title={col.type}
                      >
                        {col.type}
                      </div>
                    </div>
                    {col.nullable && (
                      <label className="flex items-center gap-1 text-[11px] text-muted-foreground cursor-pointer select-none shrink-0 mt-0.5">
                        <input
                          type="checkbox"
                          checked={isNull}
                          onChange={(e) => toggleNull(col.name, e.target.checked)}
                          className="h-3 w-3 rounded border-muted-foreground/40 accent-primary"
                        />
                        <span>NULL</span>
                      </label>
                    )}
                  </div>

                  <FieldEditor
                    col={col}
                    currentValue={currentValue}
                    displayValue={displayValue}
                    isNull={isNull}
                    inputId={`edit-field-${col.name}`}
                    onChange={(v) => updateField(col.name, v)}
                  />
                </div>
              );
            })}
          </div>
          )}
        </div>

        <DialogFooter className="px-6 py-4 border-t shrink-0 bg-background">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
            {editableColumns.length === 0 ? 'Close' : 'Cancel'}
          </Button>
          {editableColumns.length > 0 && (
            <Button onClick={handleSave} disabled={isSaving || readOnly}>
              {isSaving && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Save Changes
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
