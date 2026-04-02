"use client";

import React, { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  User,
  Mail,
  Key,
  Coins,
  Activity,
  TrendingUp,
  Copy,
  Check,
  LogOut,
  Bot,
  Shield,
  Code,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { copyToClipboard } from "@/lib/utils/clipboard";

interface ModelInfo {
  alias: string;
  isActive: boolean;
  quota: {
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  };
  todayUsage: {
    totalTokens: number;
    requestCount: number;
  };
}

interface DashboardData {
  user: {
    name: string;
    email: string;
    apiKey: string;
    isAdmin: boolean;
  };
  today: {
    totalTokens: number;
    requestCount: number;
  };
  dailyTrend: Array<{ date: string; totalTokens: number; requestCount: number }>;
  models: ModelInfo[];
  baseUrl: string;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function formatTooltipNumber(value: unknown): string {
  const raw = Array.isArray(value) ? (value.length > 0 ? value[0] : null) : value;
  const num = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(num) ? formatNum(num) : "N/A";
}

function MaskedApiKey({ apiKey, baseUrl }: { apiKey: string; baseUrl: string }) {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const handleCopy = async (text: string, label: string) => {
    const ok = await copyToClipboard(text);
    if (ok) {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          Base URL:
        </span>
        <code className="text-sm bg-[hsl(var(--muted))] px-2 py-1 rounded font-mono">
          {baseUrl}
        </code>
        <button
          onClick={() => handleCopy(baseUrl, "url")}
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          title="Copy Base URL"
        >
          {copied === "url" ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          API Key:
        </span>
        <code
          className="text-sm bg-[hsl(var(--muted))] px-2 py-1 rounded font-mono cursor-pointer"
          onClick={() => setRevealed(!revealed)}
          title="Click to toggle"
        >
          {revealed ? apiKey : apiKey.slice(0, 8) + "••••••••••••••••••••"}
        </code>
        <button
          onClick={() => handleCopy(apiKey, "key")}
          className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]"
          title="Copy API Key"
        >
          {copied === "key" ? (
            <Check className="h-3.5 w-3.5 text-green-600" />
          ) : (
            <Copy className="h-3.5 w-3.5" />
          )}
        </button>
      </div>
    </div>
  );
}

function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    const ok = await copyToClipboard(code);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
          {label}
        </span>
        <button
          onClick={handleCopy}
          className="text-xs text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] flex items-center gap-1"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" /> Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" /> Copy
            </>
          )}
        </button>
      </div>
      <pre className="bg-[hsl(var(--muted))] rounded-lg p-4 overflow-x-auto text-sm font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/auth/dashboard")
      .then((r) => {
        if (!r.ok) throw new Error("Unauthorized");
        return r.json();
      })
      .then(setData)
      .catch(() => router.push("/login"))
      .finally(() => setLoading(false));
  }, [router]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[hsl(var(--background))]">
        <div className="text-[hsl(var(--muted-foreground))]">Loading...</div>
      </div>
    );
  }

  if (!data) return null;

  const modelAliases = data.models
    .filter((m) => m.isActive)
    .map((m) => m.alias);
  const firstModel = modelAliases[0] || "your-model";

  const nonStreamCode = `from openai import OpenAI

client = OpenAI(
    base_url="${data.baseUrl}",
    api_key="${data.user.apiKey}",
)

response = client.chat.completions.create(
    model="${firstModel}",
    messages=[
        {"role": "user", "content": "Hello!"}
    ],
)

print(response.choices[0].message.content)`;

  const streamCode = `from openai import OpenAI

client = OpenAI(
    base_url="${data.baseUrl}",
    api_key="${data.user.apiKey}",
)

stream = client.chat.completions.create(
    model="${firstModel}",
    messages=[
        {"role": "user", "content": "Hello!"}
    ],
    stream=True,
)

for chunk in stream:
    if chunk.choices[0].delta.content is not None:
        print(chunk.choices[0].delta.content, end="")`;

  return (
    <div className="min-h-screen bg-[hsl(var(--background))]">
      {/* Header */}
      <header className="border-b bg-[hsl(var(--card))]">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="h-6 w-6 text-[hsl(var(--primary))]" />
            <span className="text-lg font-bold">LLM Gateway</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-[hsl(var(--muted-foreground))]">
              {data.user.name}
            </span>
            {data.user.isAdmin && (
              <Badge variant="secondary" className="text-xs">
                Admin
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={handleLogout}>
              <LogOut className="h-4 w-4 mr-1" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Basic Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Basic Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-center gap-3">
                <User className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    Username
                  </p>
                  <p className="font-medium">{data.user.name}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Mail className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
                <div>
                  <p className="text-sm text-[hsl(var(--muted-foreground))]">
                    Email
                  </p>
                  <p className="font-medium">{data.user.email}</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Usage Statistics */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="h-5 w-5" />
              Usage Statistics
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Coins className="h-4 w-4 text-orange-500" />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    Today&apos;s Tokens
                  </span>
                </div>
                <p className="text-2xl font-bold">
                  {formatNum(data.today.totalTokens)}
                </p>
              </div>
              <div className="rounded-lg border p-4">
                <div className="flex items-center gap-2 mb-1">
                  <Activity className="h-4 w-4 text-blue-500" />
                  <span className="text-sm text-[hsl(var(--muted-foreground))]">
                    Today&apos;s Requests
                  </span>
                </div>
                <p className="text-2xl font-bold">
                  {formatNum(data.today.requestCount)}
                </p>
              </div>
            </div>

            {data.dailyTrend.length > 0 && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1">
                    <TrendingUp className="h-3.5 w-3.5" />
                    7-Day Request Trend
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={data.dailyTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value) => [formatTooltipNumber(value), "Requests"]}
                        labelFormatter={(l) => `Date: ${l}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="requestCount"
                        stroke="hsl(221.2, 83.2%, 53.3%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div>
                  <p className="text-sm font-medium text-[hsl(var(--muted-foreground))] mb-2 flex items-center gap-1">
                    <Coins className="h-3.5 w-3.5" />
                    7-Day Token Trend
                  </p>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={data.dailyTrend}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 11 }}
                        tickFormatter={(v) => v.slice(5)}
                      />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
                      <Tooltip
                        formatter={(value) => [formatTooltipNumber(value), "Tokens"]}
                        labelFormatter={(l) => `Date: ${l}`}
                      />
                      <Line
                        type="monotone"
                        dataKey="totalTokens"
                        stroke="hsl(25, 95%, 53%)"
                        strokeWidth={2}
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Quota & Models */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Quota & Authorized Models
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.models.length === 0 ? (
              <p className="text-[hsl(var(--muted-foreground))] text-sm">
                No models authorized. Please contact admin.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Model
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Status
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Today Usage
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Tokens/Day
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Requests/Day
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Requests/Min
                      </th>
                      <th className="text-left py-2 px-3 font-medium text-[hsl(var(--muted-foreground))]">
                        Time Window
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model) => (
                      <tr key={model.alias} className="border-b last:border-0">
                        <td className="py-2 px-3 font-mono text-sm">
                          {model.alias}
                        </td>
                        <td className="py-2 px-3">
                          <Badge
                            variant={model.isActive ? "default" : "secondary"}
                          >
                            {model.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-[hsl(var(--muted-foreground))]">
                          {formatNum(model.todayUsage.requestCount)} req /{" "}
                          {formatNum(model.todayUsage.totalTokens)} tok
                        </td>
                        <td className="py-2 px-3">
                          {model.quota.maxTokensPerDay
                            ? formatNum(model.quota.maxTokensPerDay)
                            : "∞"}
                        </td>
                        <td className="py-2 px-3">
                          {model.quota.maxRequestsPerDay
                            ? formatNum(model.quota.maxRequestsPerDay)
                            : "∞"}
                        </td>
                        <td className="py-2 px-3">
                          {model.quota.maxRequestsPerMin ?? "∞"}
                        </td>
                        <td className="py-2 px-3 text-[hsl(var(--muted-foreground))]">
                          {model.quota.allowedTimeStart && model.quota.allowedTimeEnd
                            ? `${model.quota.allowedTimeStart} - ${model.quota.allowedTimeEnd}`
                            : "All day"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* API Access Info */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Key className="h-5 w-5" />
              API Access
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <MaskedApiKey apiKey={data.user.apiKey} baseUrl={data.baseUrl} />
            {modelAliases.length > 0 && (
              <div>
                <span className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
                  Authorized Models:
                </span>
                <div className="flex flex-wrap gap-2 mt-1">
                  {modelAliases.map((alias) => (
                    <Badge key={alias} variant="outline">
                      {alias}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Usage Examples */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Code className="h-5 w-5" />
              Usage Examples
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="non-stream" className="w-full">
              <TabsList>
                <TabsTrigger value="non-stream">Non-Streaming</TabsTrigger>
                <TabsTrigger value="stream">Streaming</TabsTrigger>
              </TabsList>
              <TabsContent value="non-stream" className="mt-4">
                <CodeBlock
                  label="Python (openai library) — Non-Streaming"
                  code={nonStreamCode}
                />
              </TabsContent>
              <TabsContent value="stream" className="mt-4">
                <CodeBlock
                  label="Python (openai library) — Streaming"
                  code={streamCode}
                />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
