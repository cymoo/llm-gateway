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
  Users2,
} from "lucide-react";
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
  group: {
    name: string;
    isDefault: boolean;
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

  const baseUrlHost = (() => {
    try {
      return new URL(data.baseUrl).hostname;
    } catch {
      return "";
    }
  })();
  const defaultNoProxy = "localhost;127.0.0.1";
  const noProxy = baseUrlHost && !defaultNoProxy.split(";").includes(baseUrlHost)
    ? `${defaultNoProxy};${baseUrlHost}`
    : defaultNoProxy;

  const nonStreamCode = `import os
from openai import OpenAI

os.environ['no_proxy'] = '${noProxy}'

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

  const streamCode = `import os
from openai import OpenAI

os.environ['no_proxy'] = '${noProxy}'

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
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/40 dark:from-slate-950 dark:via-slate-900 dark:to-indigo-950/30">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-white/60 bg-white/80 backdrop-blur-md dark:border-slate-800/60 dark:bg-slate-900/80">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm">
              <Bot className="h-4.5 w-4.5 text-white" />
            </div>
            <span className="text-lg font-bold tracking-tight bg-gradient-to-r from-slate-900 to-slate-600 bg-clip-text text-transparent dark:from-white dark:to-slate-300">
              LLM Gateway
            </span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 bg-slate-100/80 dark:bg-slate-800/80 rounded-full px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {data.user.name}
              </span>
              {data.user.isAdmin && (
                <Badge variant="secondary" className="text-xs h-5 px-1.5 bg-indigo-100 text-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300 border-0">
                  Admin
                </Badge>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleLogout}
              className="text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
            >
              <LogOut className="h-4 w-4 mr-1.5" />
              Logout
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* Hero / Profile Banner */}
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-blue-600 via-indigo-600 to-violet-600 p-6 text-white shadow-lg shadow-blue-500/20">
          <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHZpZXdCb3g9IjAgMCA2MCA2MCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZyBmaWxsPSJub25lIiBmaWxsLXJ1bGU9ImV2ZW5vZGQiPjxnIGZpbGw9IiNmZmZmZmYiIGZpbGwtb3BhY2l0eT0iMC4wNCI+PHBhdGggZD0iTTM2IDM0djZoNnYtNmgtNnptNiA2djZoNnYtNmgtNnptLTEyIDB2Nmg2di02aC02em0xMiAwdjZoNnYtNmgtNnoiLz48L2c+PC9nPjwvc3ZnPg==')] opacity-50" />
          <div className="relative flex flex-col sm:flex-row sm:items-center gap-4">
            <div className="flex items-center justify-center w-14 h-14 rounded-2xl bg-white/20 backdrop-blur-sm ring-2 ring-white/30 shadow-lg">
              <User className="h-7 w-7 text-white" />
            </div>
            <div className="flex-1">
              <p className="text-white/70 text-sm font-medium">Welcome back</p>
              <h1 className="text-2xl font-bold">{data.user.name}</h1>
              <div className="flex items-center gap-2 mt-1">
                <Mail className="h-3.5 w-3.5 text-white/60" />
                <span className="text-sm text-white/80">{data.user.email}</span>
                {data.user.isAdmin && (
                  <span className="inline-flex items-center gap-1 text-xs bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full font-medium">
                    <Shield className="h-3 w-3" /> Admin
                  </span>
                )}
                {data.group && (
                  <span className="inline-flex items-center gap-1 text-xs bg-white/20 backdrop-blur-sm px-2 py-0.5 rounded-full font-medium">
                    <Users2 className="h-3 w-3" />
                    {data.group.name}
                    {data.group.isDefault ? " (Default)" : ""}
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Usage Statistics */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4" />
            Usage Statistics
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div className="relative overflow-hidden rounded-xl border border-orange-100 bg-gradient-to-br from-orange-50 to-amber-50 p-5 dark:border-orange-900/30 dark:from-orange-950/30 dark:to-amber-950/30">
              <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-orange-100/80 dark:bg-orange-900/30 flex items-center justify-center">
                <Coins className="h-5 w-5 text-orange-500" />
              </div>
              <p className="text-sm text-orange-600/80 dark:text-orange-400/80 font-medium">Today&apos;s Tokens</p>
              <p className="text-3xl font-bold text-orange-700 dark:text-orange-300 mt-1">
                {formatNum(data.today.totalTokens)}
              </p>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-indigo-50 p-5 dark:border-blue-900/30 dark:from-blue-950/30 dark:to-indigo-950/30">
              <div className="absolute top-3 right-3 w-10 h-10 rounded-full bg-blue-100/80 dark:bg-blue-900/30 flex items-center justify-center">
                <Activity className="h-5 w-5 text-blue-500" />
              </div>
              <p className="text-sm text-blue-600/80 dark:text-blue-400/80 font-medium">Today&apos;s Requests</p>
              <p className="text-3xl font-bold text-blue-700 dark:text-blue-300 mt-1">
                {formatNum(data.today.requestCount)}
              </p>
            </div>
          </div>

          {data.dailyTrend.length > 0 && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm p-5 dark:border-slate-700/60 dark:bg-slate-800/50">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                  <TrendingUp className="h-3.5 w-3.5 text-blue-500" />
                  7-Day Request Trend
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip
                      formatter={(value) => [formatTooltipNumber(value), "Requests"]}
                      labelFormatter={(l) => `Date: ${l}`}
                      contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="requestCount"
                      stroke="hsl(221.2, 83.2%, 53.3%)"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm p-5 dark:border-slate-700/60 dark:bg-slate-800/50">
                <p className="text-sm font-medium text-slate-600 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                  <Coins className="h-3.5 w-3.5 text-orange-500" />
                  7-Day Token Trend
                </p>
                <ResponsiveContainer width="100%" height={160}>
                  <LineChart data={data.dailyTrend}>
                    <CartesianGrid strokeDasharray="3 3" className="opacity-20" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(v) => v.slice(5)}
                    />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
                    <Tooltip
                      formatter={(value) => [formatTooltipNumber(value), "Tokens"]}
                      labelFormatter={(l) => `Date: ${l}`}
                      contentStyle={{ borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "12px" }}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalTokens"
                      stroke="hsl(25, 95%, 53%)"
                      strokeWidth={2.5}
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>

        {/* Quota & Models */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Shield className="h-4 w-4" />
            Quota &amp; Authorized Models
          </h2>
          <div className="rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm overflow-hidden dark:border-slate-700/60 dark:bg-slate-800/50">
            {data.models.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-slate-400">
                <Bot className="h-10 w-10 mb-3 opacity-40" />
                <p className="text-sm">No models authorized. Please contact admin.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Model</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Status</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Today Usage</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Tokens/Day</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Req/Day</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Req/Min</th>
                      <th className="text-left py-3 px-4 font-semibold text-slate-600 dark:text-slate-300">Time Window</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.models.map((model, i) => (
                      <tr
                        key={model.alias}
                        className={`border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors ${i % 2 === 0 ? "" : "bg-slate-50/30 dark:bg-slate-700/10"}`}
                      >
                        <td className="py-3 px-4 font-mono text-xs font-medium text-indigo-700 dark:text-indigo-300 bg-indigo-50/40 dark:bg-indigo-950/20">
                          {model.alias}
                        </td>
                        <td className="py-3 px-4">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full ${
                            model.isActive
                              ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                              : "bg-slate-100 text-slate-500 dark:bg-slate-700/50 dark:text-slate-400"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${model.isActive ? "bg-emerald-500" : "bg-slate-400"}`} />
                            {model.isActive ? "Active" : "Inactive"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400">
                          <span className="font-medium text-slate-700 dark:text-slate-300">{formatNum(model.todayUsage.requestCount)}</span> req /{" "}
                          <span className="font-medium text-slate-700 dark:text-slate-300">{formatNum(model.todayUsage.totalTokens)}</span> tok
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {model.quota.maxTokensPerDay ? formatNum(model.quota.maxTokensPerDay) : <span className="text-slate-400">∞</span>}
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {model.quota.maxRequestsPerDay ? formatNum(model.quota.maxRequestsPerDay) : <span className="text-slate-400">∞</span>}
                        </td>
                        <td className="py-3 px-4 font-medium">
                          {model.quota.maxRequestsPerMin ?? <span className="text-slate-400">∞</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-500 dark:text-slate-400 text-xs">
                          {model.quota.allowedTimeStart && model.quota.allowedTimeEnd
                            ? `${model.quota.allowedTimeStart} – ${model.quota.allowedTimeEnd}`
                            : "All day"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        {/* API Access Info */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Key className="h-4 w-4" />
            API Access
          </h2>
          <div className="rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm p-6 dark:border-slate-700/60 dark:bg-slate-800/50 space-y-5">
            <MaskedApiKey apiKey={data.user.apiKey} baseUrl={data.baseUrl} />
            {modelAliases.length > 0 && (
              <div>
                <p className="text-sm font-medium text-slate-500 dark:text-slate-400 mb-2">Authorized Models</p>
                <div className="flex flex-wrap gap-2">
                  {modelAliases.map((alias) => (
                    <span
                      key={alias}
                      className="inline-flex items-center gap-1 text-xs font-mono font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/40 px-2.5 py-1 rounded-md"
                    >
                      <Bot className="h-3 w-3 opacity-60" />
                      {alias}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Usage Examples */}
        <div>
          <h2 className="text-sm font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
            <Code className="h-4 w-4" />
            Usage Examples
          </h2>
          <div className="rounded-xl border border-slate-200/60 bg-white/70 backdrop-blur-sm p-6 dark:border-slate-700/60 dark:bg-slate-800/50">
            <Tabs defaultValue="non-stream" className="w-full">
              <TabsList className="bg-slate-100/80 dark:bg-slate-700/50">
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
          </div>
        </div>
      </main>
    </div>
  );
}
