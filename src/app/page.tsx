"use client";

import { useState } from "react";
import { Database, BookOpen, Terminal, Shield, HelpCircle, Container, Heart } from "lucide-react";
import { ConnectionForm } from "@/components/connection/connection-form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";

export default function Home() {
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      <div className="container mx-auto px-4 py-12">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-3 mb-3">
            <div className="p-3 bg-primary rounded-xl">
              <Database className="h-8 w-8 text-primary-foreground" />
            </div>
            <h1 className="text-4xl font-bold">DB Studio</h1>
          </div>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Universal database analyzer for PostgreSQL, MongoDB & ClickHouse
          </p>
        </div>

        {/* Connection Form */}
        <div className="max-w-lg mx-auto">
          <ConnectionForm />
        </div>

        {/* Help Button */}
        <div className="text-center mt-4">
          <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm" className="gap-2">
                <HelpCircle className="h-4 w-4" />
                Quick Start Guide
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[85vh]">
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <BookOpen className="h-5 w-5" />
                  Quick Start Guide
                </DialogTitle>
              </DialogHeader>
              <ScrollArea className="max-h-[calc(85vh-100px)] pr-4">
                <div className="space-y-6">
                  {/* Connection Strings */}
                  <Tabs defaultValue="postgresql" className="w-full">
                    <TabsList className="grid w-full grid-cols-2">
                      <TabsTrigger value="postgresql">PostgreSQL</TabsTrigger>
                      <TabsTrigger value="mongodb">MongoDB</TabsTrigger>
                    </TabsList>
                    <TabsContent value="postgresql" className="space-y-3 mt-3">
                      <div>
                        <p className="text-sm font-medium mb-2">
                          Connection String Format:
                        </p>
                        <code className="block bg-muted p-3 rounded-md text-xs break-all">
                          postgresql://username:password@host:port/database
                        </code>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-2">Examples:</p>
                        <div className="space-y-2 text-xs">
                          <code className="block bg-muted p-2 rounded">
                            postgresql://postgres:mypass@localhost:5432/mydb
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            postgresql://user:pass@db.example.com:5432/production
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            postgresql://postgres:pass@localhost:5432/mydb?schema=public
                          </code>
                        </div>
                      </div>
                    </TabsContent>
                    <TabsContent value="mongodb" className="space-y-3 mt-3">
                      <div>
                        <p className="text-sm font-medium mb-2">
                          Connection String Format:
                        </p>
                        <code className="block bg-muted p-3 rounded-md text-xs break-all">
                          mongodb://username:password@host:port/database
                        </code>
                      </div>
                      <div>
                        <p className="text-sm font-medium mb-2">Examples:</p>
                        <div className="space-y-2 text-xs">
                          <code className="block bg-muted p-2 rounded">
                            mongodb://localhost:27017/mydb
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            mongodb://user:pass@localhost:27017/mydb?authSource=admin
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            mongodb+srv://user:pass@cluster.mongodb.net/mydb
                          </code>
                        </div>
                      </div>
                    </TabsContent>
                  </Tabs>

                  {/* How to Use */}
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Terminal className="h-4 w-4" />
                      How to Use
                    </p>
                    <ol className="text-sm text-muted-foreground space-y-2 list-decimal list-inside">
                      <li>Select your database type (PostgreSQL or MongoDB)</li>
                      <li>Enter a friendly name for your connection</li>
                      <li>Paste your connection string</li>
                      <li>Click &quot;Test Connection&quot; to verify</li>
                      <li>Click &quot;Connect&quot; to start exploring</li>
                    </ol>
                  </div>

                  {/* Features */}
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Features
                    </p>
                    <ul className="text-sm text-muted-foreground space-y-2">
                      <li>
                        <strong>Data Tab:</strong> Browse and edit table data
                        with pagination, sorting, and export to CSV
                      </li>
                      <li>
                        <strong>Query Tab:</strong> Write and execute SQL or
                        MongoDB queries with syntax highlighting
                      </li>
                      <li>
                        <strong>Schema Tab:</strong> Visualize database schema
                        as interactive ER diagrams
                      </li>
                      <li>
                        <strong>Read-Only Mode:</strong> Enable to prevent
                        accidental writes to your database
                      </li>
                      <li>
                        <strong>Dark/Light Theme:</strong> Switch between themes
                        based on your preference
                      </li>
                    </ul>
                  </div>

                  {/* Docker Usage */}
                  <div className="border-t pt-4">
                    <p className="text-sm font-medium mb-3 flex items-center gap-2">
                      <Container className="h-4 w-4" />
                      Running with Docker
                    </p>
                    <div className="space-y-3 text-sm">
                      <div>
                        <p className="text-muted-foreground mb-2">
                          <strong>Connect to databases on your host machine:</strong>
                        </p>
                        <p className="text-xs text-muted-foreground mb-1">
                          Use <code className="bg-muted px-1 rounded">host.docker.internal</code> instead of <code className="bg-muted px-1 rounded">localhost</code>
                        </p>
                        <div className="space-y-1 text-xs">
                          <code className="block bg-muted p-2 rounded">
                            postgresql://user:pass@host.docker.internal:5432/mydb
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            mongodb://user:pass@host.docker.internal:27017/mydb
                          </code>
                        </div>
                      </div>
                      <div>
                        <p className="text-muted-foreground mb-2">
                          <strong>Using docker-compose with test databases:</strong>
                        </p>
                        <code className="block bg-muted p-2 rounded text-xs mb-2">
                          docker compose --profile with-db up -d
                        </code>
                        <p className="text-xs text-muted-foreground mb-1">Then connect using:</p>
                        <div className="space-y-1 text-xs">
                          <code className="block bg-muted p-2 rounded">
                            postgresql://postgres:postgres@postgres:5432/testdb
                          </code>
                          <code className="block bg-muted p-2 rounded">
                            mongodb://mongo:mongo@mongodb:27017
                          </code>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </DialogContent>
          </Dialog>
        </div>

        {/* Features */}
        <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
          <div className="text-center p-6">
            <div className="w-12 h-12 bg-blue-500/10 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-blue-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Multi-Database Support</h3>
            <p className="text-sm text-muted-foreground">
              Connect to PostgreSQL, MongoDB or ClickHouse with a unified interface.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-green-500/10 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-green-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Schema Visualization</h3>
            <p className="text-sm text-muted-foreground">
              View ER diagrams and explore table relationships visually.
            </p>
          </div>

          <div className="text-center p-6">
            <div className="w-12 h-12 bg-purple-500/10 rounded-lg flex items-center justify-center mx-auto mb-4">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-6 w-6 text-purple-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                />
              </svg>
            </div>
            <h3 className="font-semibold mb-2">Read-Only Mode</h3>
            <p className="text-sm text-muted-foreground">
              Safely browse production databases with write protection enabled.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-4 text-center">
          <p className="text-sm text-muted-foreground mb-4">
            Your connection credentials are stored locally and never sent to any external server.
          </p>
          <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <span>Made with</span>
            <Heart className="h-3 w-3 text-red-500 fill-red-500" />
            <span>by</span>
            <a
              href="https://github.com/rutvikraut2001"
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-foreground hover:text-primary transition-colors"
            >
              Rutvik
            </a>
            <span className="mx-1 text-muted-foreground/40">•</span>
            <a
              href="https://github.com/rutvikraut2001/dbpilot"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground transition-colors inline-flex items-center gap-1"
            >
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
              GitHub
            </a>
            <span className="mx-1 text-muted-foreground/40">•</span>
            <span>© {new Date().getFullYear()}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
