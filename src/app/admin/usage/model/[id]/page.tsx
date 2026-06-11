"use client";

import React, { useEffect, useState, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

interface UsageByUser {
  userId: string;
  userName: string;
  userEmail: string;
  totalTokens: number;
  requestCount: number;
}

interface DailyTrend {
  date: string;
  totalTokens: number;
  requestCount: number;
}

interface ModelInfo {
  id: string;
  alias: string;
  backendModel: string;
}

function formatNum(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return n.toString();
}

function ModelUsageContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const modelId = params.id as string;

  const startDate = searchParams.get("startDate") || "";
  const endDate = searchParams.get("endDate") || "";

  const [model, setModel] = useState<ModelInfo | null>(null);
  const [usageByUser, setUsageByUser] = useState<UsageByUser[]>([]);
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([]);
  const [loading, setLoading] = useState(true);

  const backUrl = `/admin/usage?tab=by-model${startDate ? `&startDate=${startDate}` : ""}${endDate ? `&endDate=${endDate}` : ""}`;

  useEffect(() => {
    const qs = new URLSearchParams();
    if (startDate) qs.set("startDate", startDate);
    if (endDate) qs.set("endDate", endDate);

    fetch(`/api/admin/usage/by-model/${modelId}?${qs}`)
      .then((r) => r.json())
      .then((data) => {
        setModel(data.model);
        setUsageByUser(data.usageByUser || []);
        setDailyTrend(data.dailyTrend || []);
      })
      .finally(() => setLoading(false));
  }, [modelId, startDate, endDate]);

  const totalRequests = usageByUser.reduce((s, u) => s + Number(u.requestCount), 0);
  const totalTokens = usageByUser.reduce((s, u) => s + Number(u.totalTokens), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Link href={backUrl}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold font-mono">{model?.alias ?? modelId}</h1>
          {model?.backendModel && (
            <p className="text-sm text-[hsl(var(--muted-foreground))]">{model.backendModel}</p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 max-w-sm">
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">总请求数</p>
            <p className="text-2xl font-bold">{formatNum(totalRequests)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <p className="text-xs text-[hsl(var(--muted-foreground))]">总 Token</p>
            <p className="text-2xl font-bold">{formatNum(totalTokens)}</p>
          </CardContent>
        </Card>
      </div>

      {dailyTrend.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">每日请求趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={formatNum} />
                  <Tooltip formatter={(v: unknown) => formatNum(Number(v))} />
                  <Bar dataKey="requestCount" fill="hsl(142.1, 76.2%, 36.3%)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">每日 Token 趋势</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={dailyTrend}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 10 }} tickFormatter={formatNum} />
                  <Tooltip formatter={(v: unknown) => formatNum(Number(v))} />
                  <Bar dataKey="totalTokens" fill="hsl(25, 95%, 53%)" />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>邮箱</TableHead>
              <TableHead className="text-right">请求数</TableHead>
              <TableHead className="text-right">总 Token</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {usageByUser.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  暂无数据
                </TableCell>
              </TableRow>
            ) : (
              usageByUser.map((u) => (
                <TableRow key={u.userId}>
                  <TableCell className="font-medium">{u.userName}</TableCell>
                  <TableCell className="text-[hsl(var(--muted-foreground))]">{u.userEmail}</TableCell>
                  <TableCell className="text-right">{formatNum(u.requestCount)}</TableCell>
                  <TableCell className="text-right">{formatNum(u.totalTokens)}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

export default function ModelUsagePage() {
  return (
    <Suspense>
      <ModelUsageContent />
    </Suspense>
  );
}
