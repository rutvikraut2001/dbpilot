'use client';

import { useRef, useEffect, useState, useCallback } from 'react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';

// Import Monaco CSS
import 'monaco-editor/min/vs/editor/editor.main.css';

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language: string;
}

// Simple Monaco editor without workers (works reliably with any bundler)
export function MonacoEditor({ value, onChange, language }: MonacoEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<unknown>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [monaco, setMonaco] = useState<typeof import('monaco-editor') | null>(null);

  // Load Monaco
  useEffect(() => {
    let cancelled = false;

    const loadMonaco = async () => {
      try {
        // Dynamically import monaco-editor
        const monacoModule = await import('monaco-editor');

        if (cancelled) return;

        setMonaco(monacoModule);
        setIsLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('Failed to load Monaco:', err);
        setLoadError('Failed to load editor. Please refresh the page.');
        setIsLoading(false);
      }
    };

    loadMonaco();

    return () => {
      cancelled = true;
    };
  }, []);

  // Create editor when Monaco is loaded and container is ready
  useEffect(() => {
    if (!monaco || !containerRef.current || editorRef.current) return;

    const editor = monaco.editor.create(containerRef.current, {
      value: value,
      language: language,
      theme: 'vs-dark',
      minimap: { enabled: false },
      fontSize: 14,
      lineNumbers: 'on',
      scrollBeyondLastLine: false,
      wordWrap: 'on',
      automaticLayout: true,
      tabSize: 2,
    });

    editor.onDidChangeModelContent(() => {
      onChange(editor.getValue());
    });

    editorRef.current = editor;

    return () => {
      editor.dispose();
      editorRef.current = null;
    };
  }, [monaco, language]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update value when it changes externally
  useEffect(() => {
    if (!editorRef.current || !monaco) return;
    const editor = editorRef.current as ReturnType<typeof monaco.editor.create>;
    if (editor.getValue() !== value) {
      editor.setValue(value);
    }
  }, [value, monaco]);

  // Update language when it changes
  useEffect(() => {
    if (!editorRef.current || !monaco) return;
    const editor = editorRef.current as ReturnType<typeof monaco.editor.create>;
    const model = editor.getModel();
    if (model) {
      monaco.editor.setModelLanguage(model, language);
    }
  }, [language, monaco]);

  const handleRetry = useCallback(() => {
    window.location.reload();
  }, []);

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 p-4">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <span className="text-center">{loadError}</span>
        <button
          onClick={handleRetry}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading editor...
      </div>
    );
  }

  return <div ref={containerRef} className="h-full w-full" />;
}
