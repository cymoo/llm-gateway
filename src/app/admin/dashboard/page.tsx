"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { useLanguage } from "@/lib/i18n";

interface OverviewData {
  totalUsers: number;
  totalModels: number;
  activeModels: number;
  today: { totalTokens: number; requestCount: number };
  last7Days: { totalTokens: number; requestCount: number };
  last30Days: { totalTokens: number; requestCount: number };
  allTime: { totalTokens: number; requestCount: number };
  activeLast7Days: { users: number; models: number };
  successRate7Days: number;
  dailyTrend: Array<{ date: string; totalTokens: number; requestCount: number }>;
}

type TrendDays = 7 | 14 | 30;

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

function fillDateRange(
  trend: Array<{ date: string; totalTokens: number; requestCount: number }>,
  days: number
) {
  const dataMap = new Map(trend.map((d) => [d.date, d]));
  const result = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];
    result.push(
      dataMap.get(dateStr) ?? { date: dateStr, totalTokens: 0, requestCount: 0 }
    );
  }
  return result;
}

export default function DashboardPage() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [trendDays, setTrendDays] = useState<TrendDays>(7);
  const abortRef = useRef<AbortController | null>(null);
  const { t } = useLanguage();

  const handleTrendDaysChange = useCallback((days: TrendDays) => {
    if (days === trendDays) return;
    setLoading(true);
    setTrendDays(days);
  }, [trendDays]);

  useEffect(() => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    fetch(`/api/admin/usage/overview?days=${trendDays}`, {
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== "AbortError") setLoading(false);
      });
    return () => controller.abort();
  }, [trendDays]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[hsl(var(--muted-foreground))]">{t("common.loading")}</div>
      </div>
    );
  }

  if (!data) return null;

  const filledTrend = fillDateRange(data.dailyTrend, trendDays);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("dashboard.title")}</h1>
        <p className="text-[hsl(var(--muted-foreground))]">
          {t("dashboard.subtitle")}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dashboard.totalUsers")}
          value={data.totalUsers}
          icon={Users}
          color="bg-blue-500"
        />
        <StatCard
          title={t("dashboard.activeModels")}
          value={data.activeModels}
          icon={Cpu}
          color="bg-purple-500"
        />
        <StatCard
          title={t("dashboard.todayRequests")}
          value={formatNum(data.today.requestCount)}
          sub={`${formatNum(data.last7Days.requestCount)} ${t("dashboard.last7Days")}`}
          icon={Activity}
          color="bg-green-500"
        />
        <StatCard
          title={t("dashboard.todayTokens")}
          value={formatNum(data.today.totalTokens)}
          sub={`${formatNum(data.last7Days.totalTokens)} ${t("dashboard.last7Days")}`}
          icon={Coins}
          color="bg-orange-500"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t("dashboard.totalModels")}
          value={data.totalModels}
          sub={t("dashboard.activeLabel", { n: data.activeModels })}
          icon={Cpu}
          color="bg-indigo-500"
        />
        <StatCard
          title={t("dashboard.active7dUsers")}
          value={data.activeLast7Days.users}
          icon={Users}
          color="bg-cyan-500"
        />
        <StatCard
          title={t("dashboard.active7dModels")}
          value={data.activeLast7Days.models}
          icon={TrendingUp}
          color="bg-emerald-500"
        />
        <StatCard
          title={t("dashboard.successRate7d")}
          value={`${data.successRate7Days}%`}
          icon={Activity}
          color="bg-rose-500"
        />
      </div>

      {/* Trend Charts with time range selector */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-[hsl(var(--muted-foreground))] uppercase tracking-wider">
            {t("dashboard.trendRange")}
          </h2>
          <div className="flex gap-1">
            {([7, 14, 30] as TrendDays[]).map((d) => (
              <button
                key={d}
                onClick={() => handleTrendDaysChange(d)}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${
                  trendDays === d
                    ? "bg-blue-600 text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                }`}
              >
                {d}D
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                {t("dashboard.requestTrendDays", { days: trendDays })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={filledTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip
                    formatter={(value) => [formatTooltipNumber(value), t("dashboard.requests")]}
                    labelFormatter={(l) => `${t("dashboard.date")}: ${l}`}
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
                {t("dashboard.tokenTrendDays", { days: trendDays })}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={filledTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => v.slice(5)}
                  />
                  <YAxis tick={{ fontSize: 12 }} tickFormatter={formatNum} />
                  <Tooltip
                    formatter={(value) => [formatTooltipNumber(value), t("dashboard.tokens")]}
                    labelFormatter={(l) => `${t("dashboard.date")}: ${l}`}
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
      </div>

      {/* Bottom stat cards — cumulative & 30-day summaries */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              {t("dashboard.requests30d")}
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.last30Days.requestCount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              {t("dashboard.tokens30d")}
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.last30Days.totalTokens)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              {t("dashboard.allTimeRequests")}
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.allTime.requestCount)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium text-[hsl(var(--muted-foreground))]">
              {t("dashboard.allTimeTokens")}
            </p>
            <p className="text-2xl font-bold mt-1">
              {formatNum(data.allTime.totalTokens)}
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
