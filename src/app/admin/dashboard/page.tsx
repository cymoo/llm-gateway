"use client";

import React, { useEffect, useState } from "react";
import Link from "next/link";
import {
  Users,
  Cpu,
  Activity,
  Coins,
  TrendingUp,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface OverviewData {
  totalUsers: number;
  activeModels: number;
  today: { totalTokens: number; requestCount: number };
  last7Days: { totalTokens: number; requestCount: number };
  last30Days: { totalTokens: number; requestCount: number };
  dailyTrend: Array<{ date: string; totalTokens: number; requestCount: number }>;
}

function StatCard({
  title,
  value,
  sub,
  icon: Icon,
  color,
}: {
  title: string;
  value: string | number;
  sub?: string;
  icon: React.ElementType;
  color: string;
}) {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              {title}
            </p>
            <p className="text-2xl font-bold mt-1">{value}</p>
            {sub && (
              <p className="text-xs text-[hsl(var(--muted-foreground))] mt-1">
                {sub}
              </p>
            )}
          </div>
          <div className={`rounded-full p-3 ${color}`}>
            <Icon className="h-5 w-5 text-white" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
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

export default function DashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/usage/overview")
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[hsl(var(--muted-foreground))]">Loading...</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <p className="text-[hsl(var(--muted-foreground))]">
          Overview of your LLM Gateway
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Users"
          value={data.totalUsers}
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          title="Active Models"
          value={data.activeModels}
          icon={Cpu}
          color="bg-purple-500"
        />
        <StatCard
          title="Today's Requests"
          value={formatNum(data.today.requestCount)}
          sub={`${formatNum(data.last7Days.requestCount)} last 7 days`}
          icon={Activity}
          color="bg-green-500"
        />
        <StatCard
          title="Today's Tokens"
          value={formatNum(data.today.totalTokens)}
          sub={`${formatNum(data.last7Days.totalTokens)} last 7 days`}
          icon={Coins}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              7-Day Request Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 12 }} />
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Coins className="h-4 w-4" />
              7-Day Token Trend
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={data.dailyTrend}>
                <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 12 }}
                  tickFormatter={(v) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNum} />
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
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              30-Day Requests
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.last30Days.requestCount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              30-Day Tokens
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.last30Days.totalTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6 flex flex-col gap-2">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              Quick Links
            </p>
            <div className="flex gap-2 flex-wrap">
              <Link
                href="/admin/users/new"
                className="text-sm text-[hsl(var(--primary))] hover:underline"
              >
                Add User
              </Link>
              <Link
                href="/admin/models/new"
                className="text-sm text-[hsl(var(--primary))] hover:underline"
              >
                Add Model
              </Link>
              <Link
                href="/admin/usage"
                className="text-sm text-[hsl(var(--primary))] hover:underline"
              >
                View Usage
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
