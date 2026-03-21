"use client";

import React, { useEffect, useState, useCallback } from "react";
import { BarChart3, Download } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface UserStat {
  userId: string;
  userName: string;
  userEmail: string;
  totalTokens: number;
  requestCount: number;
}

interface ModelStat {
  modelId: string;
  modelAlias: string;
  totalTokens: number;
  requestCount: number;
}

interface Log {
  id: string;
  userName: string | null;
  modelAlias: string | null;
  requestType: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  isStream: boolean;
  durationMs: number | null;
  status: string | null;
  createdAt: string;
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

function getDefaultRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  return {
    startDate: start.toISOString().split("T")[0],
    endDate: end.toISOString().split("T")[0],
  };
}

export default function UsagePage() {
  const [tab, setTab] = useState("by-user");
  const [dateRange, setDateRange] = useState(getDefaultRange());
  const [userStats, setUserStats] = useState<UserStat[]>([]);
  const [modelStats, setModelStats] = useState<ModelStat[]>([]);
  const [logs, setLogs] = useState<Log[]>([]);
  const [logsTotal, setLogsTotal] = useState(0);
  const [logsPage, setLogsPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const logsLimit = 50;

  const exportLogsCsv = async () => {
    const { startDate, endDate } = dateRange;
    const qs = new URLSearchParams({
      startDate,
      endDate,
      format: "csv",
    });
    const res = await fetch(`/api/admin/usage/logs?${qs}`);
    if (!res.ok) return;

    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `usage-logs-${startDate || "all"}-${endDate || "all"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const { startDate, endDate } = dateRange;
    const qs = new URLSearchParams({ startDate, endDate });

    try {
      if (tab === "by-user") {
        const res = await fetch(`/api/admin/usage/by-user?${qs}`);
        if (res.ok) setUserStats(await res.json());
      } else if (tab === "by-model") {
        const res = await fetch(`/api/admin/usage/by-model?${qs}`);
        if (res.ok) setModelStats(await res.json());
      } else if (tab === "logs") {
        const logsQs = new URLSearchParams({
          ...Object.fromEntries(qs),
          page: logsPage.toString(),
          limit: logsLimit.toString(),
        });
        const res = await fetch(`/api/admin/usage/logs?${logsQs}`);
        if (res.ok) {
          const data = await res.json();
          setLogs(data.data);
          setLogsTotal(data.total);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [tab, dateRange, logsPage]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const totalPages = Math.ceil(logsTotal / logsLimit);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Usage Statistics</h1>
        <p className="text-[hsl(var(--muted-foreground))]">
          Monitor API usage across users and models
        </p>
      </div>

      {/* Date Range */}
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <BarChart3 className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <div className="flex items-center gap-2">
              <Label>From</Label>
              <Input
                type="date"
                className="w-40"
                value={dateRange.startDate}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, startDate: e.target.value }))
                }
              />
            </div>
            <div className="flex items-center gap-2">
              <Label>To</Label>
              <Input
                type="date"
                className="w-40"
                value={dateRange.endDate}
                onChange={(e) =>
                  setDateRange((prev) => ({ ...prev, endDate: e.target.value }))
                }
              />
            </div>
            <Button variant="outline" size="sm" onClick={fetchData}>
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      <Tabs value={tab} onValueChange={(v) => { setTab(v); setLogsPage(1); }}>
        <TabsList>
          <TabsTrigger value="by-user">By User</TabsTrigger>
          <TabsTrigger value="by-model">By Model</TabsTrigger>
          <TabsTrigger value="logs">Request Logs</TabsTrigger>
        </TabsList>

        <TabsContent value="by-user" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {userStats.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Token Usage by User</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={userStats.slice(0, 8)}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="userName" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
                      <Tooltip formatter={(v) => formatTooltipNumber(v)} />
                      <Bar dataKey="totalTokens" fill="hsl(221.2, 83.2%, 53.3%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Total Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : userStats.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      No data for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  userStats.map((s) => (
                    <TableRow key={s.userId}>
                      <TableCell className="font-medium">{s.userName}</TableCell>
                      <TableCell className="text-[hsl(var(--muted-foreground))]">{s.userEmail}</TableCell>
                      <TableCell className="text-right">{formatNum(s.requestCount)}</TableCell>
                      <TableCell className="text-right">{formatNum(s.totalTokens)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="by-model" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {modelStats.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle>Token Usage by Model</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={200}>
                    <BarChart data={modelStats}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="modelAlias" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} tickFormatter={formatNum} />
                      <Tooltip formatter={(v) => formatTooltipNumber(v)} />
                      <Bar dataKey="totalTokens" fill="hsl(25, 95%, 53%)" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Total Tokens</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : modelStats.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      No data for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  modelStats.map((s) => (
                    <TableRow key={s.modelId}>
                      <TableCell className="font-medium font-mono">{s.modelAlias}</TableCell>
                      <TableCell className="text-right">{formatNum(s.requestCount)}</TableCell>
                      <TableCell className="text-right">{formatNum(s.totalTokens)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="logs" className="space-y-4">
          <div className="flex justify-end">
            <Button variant="outline" size="sm" onClick={exportLogsCsv}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Model</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Tokens</TableHead>
                  <TableHead className="text-right">Duration</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                      No logs for this period
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-xs text-[hsl(var(--muted-foreground))]">
                        {new Date(log.createdAt).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-sm">{log.userName || "—"}</TableCell>
                      <TableCell className="text-sm font-mono">{log.modelAlias || "—"}</TableCell>
                      <TableCell className="text-xs">
                        <div className="flex items-center gap-1">
                          {log.requestType.split(".")[1] || log.requestType}
                          {log.isStream && (
                            <Badge variant="outline" className="text-xs py-0">
                              stream
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm">
                        {formatNum(log.totalTokens || 0)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-[hsl(var(--muted-foreground))]">
                        {log.durationMs ? `${log.durationMs}ms` : "—"}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={log.status === "success" ? "default" : "destructive"}
                          className="text-xs"
                        >
                          {log.status || "—"}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-[hsl(var(--muted-foreground))]">
                Showing {(logsPage - 1) * logsLimit + 1}–{Math.min(logsPage * logsLimit, logsTotal)} of{" "}
                {logsTotal} logs
              </p>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logsPage === 1}
                  onClick={() => setLogsPage((p) => p - 1)}
                >
                  Previous
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={logsPage === totalPages}
                  onClick={() => setLogsPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
