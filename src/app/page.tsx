"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import {
  Database,
  BookOpen,
  Terminal,
  Shield,
  Container,
  Heart,
  Zap,
  Eye,
  GitBranch,
  Code2,
  Key,
  MessageSquare,
  Send,
  Loader2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import { ConnectionForm } from "@/components/connection/connection-form";
import { SavedConnections } from "@/components/connection/saved-connections";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useConnectionStore } from "@/lib/stores/connection";
import { toast } from "sonner";

const FEATURES = [
  {
    icon: Eye,
    title: "Smart Data Browser",
    description:
      "Browse, edit, and export data with inline editing, JSON expansion, and click-to-copy IDs.",
    color: "text-blue-500",
    bg: "bg-blue-500/10",
  },
  {
    icon: Code2,
    title: "Query Editor",
    description:
      "Monaco-powered editor with syntax highlighting for SQL, MongoDB queries, and Redis commands.",
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
  },
  {
    icon: GitBranch,
    title: "Schema Visualizer",
    description:
      "Interactive ER diagrams with PK/FK relationships, auto-layout, and export capabilities.",
    color: "text-violet-500",
    bg: "bg-violet-500/10",
  },
  {
    icon: Key,
    title: "Redis Browser",
    description:
      "Browse keys by pattern, inspect types, TTL, and memory usage. Flush with one click.",
    color: "text-orange-500",
    bg: "bg-orange-500/10",
  },
  {
    icon: Shield,
    title: "Read-Only Mode",
    description:
      "Server-enforced write protection. Safely browse production databases without risk.",
    color: "text-green-500",
    bg: "bg-green-500/10",
  },
  {
    icon: Zap,
    title: "Smart Connect",
    description:
      "Auto-tries multiple connection strategies. SSH tunneling, Docker host fallback built-in.",
    color: "text-pink-500",
    bg: "bg-pink-500/10",
  },
];

const DB_BADGES = [
  {
    name: "PostgreSQL",
    color: "bg-blue-500/15 text-blue-600 dark:text-blue-400 border-blue-500/25",
  },
  {
    name: "MongoDB",
    color:
      "bg-green-500/15 text-green-600 dark:text-green-400 border-green-500/25",
  },
  {
    name: "ClickHouse",
    color:
      "bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/25",
  },
  {
    name: "Redis",
    color: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/25",
  },
];

const leftFeatures = FEATURES.slice(0, 3);
const rightFeatures = FEATURES.slice(3, 6);

export default function Home() {
  const router = useRouter();
  const { setTheme } = useTheme();
  const [guideOpen, setGuideOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const {
    connections,
    removeConnection,
    updateConnection,
    setActiveConnection,
  } = useConnectionStore();
  const [connectingId, setConnectingId] = useState<string | null>(null);

  // Feedback form state
  const [feedbackName, setFeedbackName] = useState("");
  const [feedbackEmail, setFeedbackEmail] = useState("");
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [feedbackType, setFeedbackType] = useState<
    "suggestion" | "bug" | "other"
  >("suggestion");
  const [isSendingFeedback, setIsSendingFeedback] = useState(false);

  const handleQuickConnect = async (connectionId: string) => {
    const connection = connections.find((c) => c.id === connectionId);
    if (!connection) return;

    setConnectingId(connectionId);

    try {
      const response = await fetch("/api/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: connection.type,
          connectionString: connection.connectionString,
          connectionId,
          sshTunnel: connection.sshTunnel,
        }),
      });

      const result = await response.json();

      if (result.success) {
        if (result.effectiveConnectionString) {
          updateConnection(connectionId, {
            connectionString: result.effectiveConnectionString,
          });
        }
        setActiveConnection(connectionId);
        router.push("/studio");
      } else {
        toast.error(result.message || "Connection failed", {
          description: result.diagnostics?.suggestions?.join(". ") || undefined,
          duration: 8000,
        });
      }
    } catch {
      toast.error("Failed to connect");
    } finally {
      setConnectingId(null);
    }
  };

  const handleEditConnection = (id: string, name: string) => {
    updateConnection(id, { name });
  };

  const handleSendFeedback = async () => {
    if (!feedbackMessage.trim()) {
      toast.error("Please enter a message");
      return;
    }

    setIsSendingFeedback(true);

    try {
      const subject = encodeURIComponent(
        `[DB Studio ${feedbackType}] from ${feedbackName || "Anonymous"}`,
      );
      const body = encodeURIComponent(
        `Type: ${feedbackType}\nFrom: ${feedbackName || "Anonymous"}\nEmail: ${feedbackEmail || "Not provided"}\n\n${feedbackMessage}`,
      );

      window.open(
        `mailto:rutvikraut2001@gmail.com?subject=${subject}&body=${body}`,
        "_blank",
      );

      toast.success("Feedback form opened in your email client");
      setFeedbackOpen(false);
      setFeedbackName("");
      setFeedbackEmail("");
      setFeedbackMessage("");
    } catch {
      toast.error("Failed to open feedback form");
    } finally {
      setIsSendingFeedback(false);
    }
  };

  const FeatureItem = ({ feature }: { feature: (typeof FEATURES)[number] }) => (
    <div className="cloud-card group p-4 pt-5">
      <div className="flex items-start gap-3 relative z-10">
        <div
          className={`w-10 h-10 ${feature.bg} rounded-xl flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform duration-300`}
        >
          <feature.icon className={`h-5 w-5 ${feature.color}`} />
        </div>
        <div className="min-w-0">
          <h3 className="font-semibold text-sm mb-1">{feature.title}</h3>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {feature.description}
          </p>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen relative">
      {/* Sky background */}
      <div className="fixed inset-0 -z-10 sky-bg">
        <div className="absolute inset-0 stars-pattern" />
      </div>

      <div className="relative flex flex-col min-h-screen">
        {/* Header — fixed so it stays visible on scroll */}
        <header className="border-b bg-white/70 dark:bg-slate-900/80 backdrop-blur-md fixed top-0 left-0 right-0 z-50">
          <div className="container mx-auto px-4 h-14 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-1.5 aurora-gradient rounded-lg">
                <Database className="h-4 w-4 text-white" />
              </div>
              <span className="font-semibold text-lg tracking-tight">
                DB Studio
              </span>
              <Badge
                variant="outline"
                className="text-[10px] px-1.5 py-0 h-5 font-mono border-aurora-start/30 text-aurora-start"
              >
                v1.0
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              <Dialog open={guideOpen} onOpenChange={setGuideOpen}>
                <DialogTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1.5 text-muted-foreground"
                  >
                    <BookOpen className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Docs</span>
                  </Button>
                </DialogTrigger>
                <DialogContent className="max-w-2xl max-h-[85vh]">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <BookOpen className="h-5 w-5" />
                      Quick Start Guide
                    </DialogTitle>
                    <DialogDescription>
                      Connection strings and usage instructions for all
                      supported databases.
                    </DialogDescription>
                  </DialogHeader>
                  <ScrollArea className="max-h-[calc(85vh-120px)] pr-4">
                    <div className="space-y-6">
                      <Tabs defaultValue="postgresql" className="w-full">
                        <TabsList className="grid w-full grid-cols-4">
                          <TabsTrigger value="postgresql">
                            PostgreSQL
                          </TabsTrigger>
                          <TabsTrigger value="mongodb">MongoDB</TabsTrigger>
                          <TabsTrigger value="clickhouse">
                            ClickHouse
                          </TabsTrigger>
                          <TabsTrigger value="redis">Redis</TabsTrigger>
                        </TabsList>
                        <TabsContent
                          value="postgresql"
                          className="space-y-3 mt-3"
                        >
                          <code className="block bg-muted p-3 rounded-md text-xs font-mono break-all">
                            postgresql://username:password@host:port/database
                          </code>
                          <div className="space-y-1.5 text-xs font-mono">
                            <code className="block bg-muted p-2 rounded">
                              postgresql://postgres:mypass@localhost:5432/mydb
                            </code>
                            <code className="block bg-muted p-2 rounded">
                              postgresql://user:pass@db.example.com:5432/production
                            </code>
                          </div>
                        </TabsContent>
                        <TabsContent value="mongodb" className="space-y-3 mt-3">
                          <code className="block bg-muted p-3 rounded-md text-xs font-mono break-all">
                            mongodb://username:password@host:port/database
                          </code>
                          <div className="space-y-1.5 text-xs font-mono">
                            <code className="block bg-muted p-2 rounded">
                              mongodb://localhost:27017/mydb
                            </code>
                            <code className="block bg-muted p-2 rounded">
                              mongodb+srv://user:pass@cluster.mongodb.net/mydb
                            </code>
                          </div>
                        </TabsContent>
                        <TabsContent
                          value="clickhouse"
                          className="space-y-3 mt-3"
                        >
                          <code className="block bg-muted p-3 rounded-md text-xs font-mono break-all">
                            clickhouse://username:password@host:port/database
                          </code>
                          <div className="space-y-1.5 text-xs font-mono">
                            <code className="block bg-muted p-2 rounded">
                              clickhouse://default:password@localhost:8123/default
                            </code>
                          </div>
                        </TabsContent>
                        <TabsContent value="redis" className="space-y-3 mt-3">
                          <code className="block bg-muted p-3 rounded-md text-xs font-mono break-all">
                            redis://username:password@host:port/db-number
                          </code>
                          <div className="space-y-1.5 text-xs font-mono">
                            <code className="block bg-muted p-2 rounded">
                              redis://localhost:6379/0
                            </code>
                            <code className="block bg-muted p-2 rounded">
                              redis://:password@localhost:6379/2
                            </code>
                          </div>
                          <p className="text-xs text-muted-foreground mt-2">
                            Query examples:{" "}
                            <code className="bg-muted px-1 rounded">
                              GET mykey
                            </code>
                            ,{" "}
                            <code className="bg-muted px-1 rounded">
                              HGETALL user:1001
                            </code>
                          </p>
                        </TabsContent>
                      </Tabs>

                      <Separator />

                      <div>
                        <p className="text-sm font-medium mb-3 flex items-center gap-2">
                          <Terminal className="h-4 w-4" /> How to Use
                        </p>
                        <ol className="text-sm text-muted-foreground space-y-1.5 list-decimal list-inside">
                          <li>Select your database type</li>
                          <li>
                            Enter a connection name and paste your connection
                            string
                          </li>
                          <li>
                            Click &quot;Test Connection&quot; to verify, then
                            &quot;Connect&quot;
                          </li>
                        </ol>
                      </div>

                      <Separator />

                      <div>
                        <p className="text-sm font-medium mb-3 flex items-center gap-2">
                          <Container className="h-4 w-4" /> Docker Usage
                        </p>
                        <p className="text-xs text-muted-foreground mb-2">
                          Use{" "}
                          <code className="bg-muted px-1 rounded font-mono">
                            host.docker.internal
                          </code>{" "}
                          for host DBs. Multiple strategies tried automatically.
                        </p>
                        <code className="block bg-muted p-2 rounded text-xs font-mono">
                          docker compose --profile with-db up -d
                        </code>
                      </div>
                    </div>
                  </ScrollArea>
                </DialogContent>
              </Dialog>

              <Button
                variant="ghost"
                size="sm"
                className="gap-1.5 text-muted-foreground"
                onClick={() => setFeedbackOpen(true)}
              >
                <MessageSquare className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Feedback</span>
              </Button>

              <a
                href="https://github.com/rutvikraut2001/dbpilot"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground transition-colors flex items-center gap-3"
              >
                <svg
                  className="h-4 w-4"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
              </a>

              {/* Theme toggle */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
                    <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
                    <span className="sr-only">Toggle theme</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setTheme("light")}>
                    <Sun className="h-4 w-4 mr-2" />
                    Light
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("dark")}>
                    <Moon className="h-4 w-4 mr-2" />
                    Dark
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setTheme("system")}>
                    <Monitor className="h-4 w-4 mr-2" />
                    System
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>

        {/* Main content: features flanking the connect card */}
        <main className="flex-1 pt-14">
          {/* Mobile features - shown above card on small screens */}
          <div className="lg:hidden container mx-auto px-4 pt-8 pb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 max-w-lg mx-auto">
              {FEATURES.map((feature, i) => (
                <div key={feature.title} className={`float-drift-${i + 1}`}>
                  <FeatureItem feature={feature} />
                </div>
              ))}
            </div>
          </div>

          {/* Desktop: features flanking center */}
          <div className="flex items-center justify-center min-h-[calc(100vh-3.5rem)] gap-6 xl:gap-12 px-4">
            {/* Left features - floating clouds */}
            <div className="hidden lg:flex flex-col gap-14 w-72">
              {leftFeatures.map((feature, i) => (
                <div key={feature.title} className={`float-drift-${i + 1}`}>
                  <FeatureItem feature={feature} />
                </div>
              ))}
            </div>

            {/* Center: heading + card */}
            <div className="w-full max-w-lg py-8">
              {/* Heading OUTSIDE the card */}
              <div className="text-center mb-6">
                <h1 className="text-3xl font-bold tracking-tight mb-2">
                  Connect to your <span className="aurora-text">database</span>
                </h1>
                <div className="flex items-center justify-center gap-2 mt-3">
                  {DB_BADGES.map((db) => (
                    <Badge
                      key={db.name}
                      variant="outline"
                      className={`text-xs font-medium ${db.color}`}
                    >
                      {db.name}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Card with just saved connections + form */}
              <Card className="border-border/50 bg-card/80 backdrop-blur-sm overflow-hidden">
                <div className="h-1 aurora-gradient" />
                <CardContent className="p-6 space-y-4">
                  {connections.length > 0 && (
                    <>
                      <SavedConnections
                        connections={connections}
                        onConnect={handleQuickConnect}
                        onEdit={handleEditConnection}
                        onDelete={removeConnection}
                        loadingId={connectingId}
                      />
                      <div className="relative">
                        <Separator />
                        <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-card px-3 text-xs text-muted-foreground">
                          or new connection
                        </span>
                      </div>
                    </>
                  )}

                  <ConnectionForm onConnected={() => router.push("/studio")} />
                </CardContent>
              </Card>
            </div>

            {/* Right features - floating clouds */}
            <div className="hidden lg:flex flex-col gap-14 w-72">
              {rightFeatures.map((feature, i) => (
                <div key={feature.title} className={`float-drift-${i + 4}`}>
                  <FeatureItem feature={feature} />
                </div>
              ))}
            </div>
          </div>
        </main>

        {/* Footer */}
        <footer className="border-t bg-background/80 backdrop-blur-sm">
          <div className="container mx-auto px-4 py-6">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="p-1 aurora-gradient rounded">
                  <Database className="h-3 w-3 text-white" />
                </div>
                <span className="font-medium text-foreground">DB Studio</span>
                <span className="text-muted-foreground/40">|</span>
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
              </div>

              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <button
                  onClick={() => setFeedbackOpen(true)}
                  className="hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <MessageSquare className="h-3 w-3" />
                  Send Feedback
                </button>
                <span className="text-muted-foreground/40">|</span>
                <a
                  href="https://github.com/rutvikraut2001/dbpilot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <svg
                    className="h-3 w-3"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                  >
                    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                  </svg>
                  GitHub
                </a>
              </div>
            </div>
          </div>
        </footer>
      </div>

      {/* Feedback Dialog */}
      <Dialog open={feedbackOpen} onOpenChange={setFeedbackOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Send Feedback
            </DialogTitle>
            <DialogDescription>
              Share suggestions, report bugs, or tell us what you think.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="flex gap-2">
              {(["suggestion", "bug", "other"] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFeedbackType(type)}
                  className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                    feedbackType === type
                      ? "aurora-gradient text-white border-transparent"
                      : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/30"
                  }`}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="fb-name" className="text-xs">
                  Name <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="fb-name"
                  placeholder="Your name"
                  value={feedbackName}
                  onChange={(e) => setFeedbackName(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="fb-email" className="text-xs">
                  Email{" "}
                  <span className="text-muted-foreground">(optional)</span>
                </Label>
                <Input
                  id="fb-email"
                  type="email"
                  placeholder="you@example.com"
                  value={feedbackEmail}
                  onChange={(e) => setFeedbackEmail(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="fb-message" className="text-xs">
                Message
              </Label>
              <Textarea
                id="fb-message"
                placeholder="What would you like to tell us?"
                value={feedbackMessage}
                onChange={(e) => setFeedbackMessage(e.target.value)}
                rows={4}
                className="text-sm resize-none"
              />
            </div>

            <Button
              onClick={handleSendFeedback}
              disabled={!feedbackMessage.trim() || isSendingFeedback}
              className="w-full aurora-gradient text-white border-0"
            >
              {isSendingFeedback ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send Feedback
            </Button>

            <p className="text-[10px] text-muted-foreground text-center">
              Opens your default email client with the feedback pre-filled.
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
