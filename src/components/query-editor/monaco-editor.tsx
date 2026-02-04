'use client';

import { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Editor, { loader, OnMount } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

// Configure Monaco to use the local bundled version (not CDN)
loader.config({ monaco });

interface MonacoEditorProps {
  value: string;
  onChange: (value: string | undefined) => void;
  language: string;
}

export function MonacoEditor({ value, onChange, language }: MonacoEditorProps) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);

  const handleEditorMount: OnMount = (editor) => {
    editorRef.current = editor;
  };

  useEffect(() => {
    return () => {
      editorRef.current?.dispose();
    };
  }, []);

  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      onChange={onChange}
      onMount={handleEditorMount}
      theme="vs-dark"
      loading={
        <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading editor...
        </div>
      }
      options={{
        minimap: { enabled: false },
        fontSize: 14,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        automaticLayout: true,
        tabSize: 2,
        quickSuggestions: true,
        suggestOnTriggerCharacters: true,
      }}
    />
  );
}
