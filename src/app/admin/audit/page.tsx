"use client";

import React, { useEffect, useState, useCallback } from "react";
import { ScrollText, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useLanguage } from "@/lib/i18n";

interface AuditDiff {
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

interface AuditLogRow {
  id: string;
  createdAt: string;
  adminId: string | null;
  adminEmail: string | null;
  action: string;
  resourceType: string | null;
  resourceId: string | null;
  resourceLabel: string | null;
  status: string;
  changes: AuditDiff | null;
  metadata: Record<string, unknown> | null;
  clientIp: string | null;
  userAgent: string | null;
}

const ACTION_OPTIONS = [
  "auth.login",
  "auth.login_failed",
  "auth.logout",
  "user.create",
  "user.update",
  "user.delete",
  "user.approve",
  "user.regenerate_key",
  "user.view_as",
  "user.grant_model",
  "user.revoke_model",
  "user.update_quota",
  "model.create",
  "model.update",
  "model.delete",
  "group.create",
  "group.update",
  "group.delete",
  "group.add_member",
  "group.remove_member",
  "group.grant_model",
  "group.revoke_model",
  "group.update_quota",
  "group.reset_quota",
];

const RESOURCE_TYPE_OPTIONS = ["user", "group", "model", "auth"];

const PAGE_LIMIT = 50;

function renderValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function DiffTable({ changes }: { changes: AuditDiff | null }) {
  const { t } = useLanguage();
  const before = changes?.before ?? {};
  const after = changes?.after ?? {};
  const keys = Array.from(
    new Set([...Object.keys(before), ...Object.keys(after)])
  );
  if (keys.length === 0) {
    return (
      <p className="text-sm text-[hsl(var(--muted-foreground))]">
        {t("audit.noChanges")}
      </p>
    );
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t("common.name")}</TableHead>
          <TableHead>{t("audit.before")}</TableHead>
          <TableHead>{t("audit.after")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {keys.map((k) => (
          <TableRow key={k}>
            <TableCell className="font-mono text-xs">{k}</TableCell>
            <TableCell className="font-mono text-xs text-[hsl(var(--muted-foreground))] break-all">
              {renderValue(before[k])}
            </TableCell>
            <TableCell className="font-mono text-xs break-all">
              {renderValue(after[k])}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

export default function AuditPage() {
  const { t } = useLanguage();

  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditLogRow | null>(null);

  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");

  const buildParams = useCallback(() => {
    const params = new URLSearchParams();
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    if (action) params.set("action", action);
    if (resourceType) params.set("resourceType", resourceType);
    if (status) params.set("status", status);
    if (q.trim()) params.set("q", q.trim());
    return params;
  }, [startDate, endDate, action, resourceType, status, q]);

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    try {
      const params = buildParams();
      params.set("page", page.toString());
      params.set("limit", PAGE_LIMIT.toString());
      const res = await fetch(`/api/admin/audit?${params}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.data);
        setTotal(data.total);
      } else {
        setLogs([]);
        setTotal(0);
      }
    } finally {
      setLoading(false);
    }
  }, [buildParams, page]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const exportCsv = async () => {
    const params = buildParams();
    params.set("format", "csv");
    const res = await fetch(`/api/admin/audit?${params}`);
    if (!res.ok) return;
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = `audit-logs-${startDate || "all"}-${endDate || "all"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  };

  const totalPages = Math.ceil(total / PAGE_LIMIT);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{t("audit.title")}</h1>
        <p className="text-[hsl(var(--muted-foreground))]">{t("audit.subtitle")}</p>
      </div>

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-2">
            <ScrollText className="h-4 w-4 text-[hsl(var(--muted-foreground))]" />
            <div className="flex items-center gap-2">
              <Label>{t("audit.from")}</Label>
              <Input
                type="date"
                className="w-40"
                value={startDate}
                onChange={(e) => {
                  setPage(1);
                  setStartDate(e.target.value);
                }}
              />
            </div>
            <div className="flex items-center gap-2">
              <Label>{t("audit.to")}</Label>
              <Input
                type="date"
                className="w-40"
                value={endDate}
                onChange={(e) => {
                  setPage(1);
                  setEndDate(e.target.value);
                }}
              />
            </div>
            <Button variant="outline" size="sm" onClick={fetchLogs}>
              {t("audit.refresh")}
            </Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label>{t("audit.action")}</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={action}
                onChange={(e) => {
                  setPage(1);
                  setAction(e.target.value);
                }}
              >
                <option value="">{t("audit.allActions")}</option>
                {ACTION_OPTIONS.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("audit.resourceType")}</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={resourceType}
                onChange={(e) => {
                  setPage(1);
                  setResourceType(e.target.value);
                }}
              >
                <option value="">{t("audit.allResourceTypes")}</option>
                {RESOURCE_TYPE_OPTIONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("audit.status")}</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={status}
                onChange={(e) => {
                  setPage(1);
                  setStatus(e.target.value);
                }}
              >
                <option value="">{t("audit.allStatuses")}</option>
                <option value="success">{t("audit.statusSuccess")}</option>
                <option value="failure">{t("audit.statusFailure")}</option>
              </select>
            </div>
            <div className="space-y-1">
              <Label>{t("audit.search")}</Label>
              <Input
                placeholder={t("audit.searchPlaceholder")}
                value={q}
                onChange={(e) => {
                  setPage(1);
                  setQ(e.target.value);
                }}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="h-4 w-4 mr-2" />
          {t("audit.exportCsv")}
        </Button>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("audit.time")}</TableHead>
              <TableHead>{t("audit.admin")}</TableHead>
              <TableHead>{t("audit.action")}</TableHead>
              <TableHead>{t("audit.resource")}</TableHead>
              <TableHead>{t("audit.status")}</TableHead>
              <TableHead>{t("audit.ip")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            ) : logs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  {t("audit.noLogs")}
                </TableCell>
              </TableRow>
            ) : (
              logs.map((log) => (
                <TableRow
                  key={log.id}
                  className="cursor-pointer"
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(log)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelected(log);
                    }
                  }}
                  title={t("audit.viewDetails")}
                >
                  <TableCell className="text-xs text-[hsl(var(--muted-foreground))]">
                    {new Date(log.createdAt).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-sm">{log.adminEmail || "—"}</TableCell>
                  <TableCell className="text-xs">
                    <Badge variant="outline" className="font-mono text-xs">
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm">
                    {log.resourceType ? (
                      <span>
                        <span className="text-[hsl(var(--muted-foreground))]">
                          {log.resourceType}
                        </span>
                        {log.resourceLabel ? ` · ${log.resourceLabel}` : ""}
                      </span>
                    ) : (
                      "—"
                    )}
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={log.status === "success" ? "default" : "destructive"}
                      className="text-xs"
                    >
                      {log.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-[hsl(var(--muted-foreground))] font-mono">
                    {log.clientIp || "—"}
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
            {t("audit.showing", {
              from: (page - 1) * PAGE_LIMIT + 1,
              to: Math.min(page * PAGE_LIMIT, total),
              total,
            })}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              {t("common.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              {t("common.next")}
            </Button>
          </div>
        </div>
      )}

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="max-w-3xl w-[90vw]">
          <DialogHeader>
            <DialogTitle>{t("audit.details")}</DialogTitle>
            <DialogDescription>
              {selected?.createdAt
                ? t("audit.eventAt", { time: new Date(selected.createdAt).toLocaleString() })
                : ""}
            </DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="max-h-[70vh] overflow-auto space-y-4">
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.admin")}
                  </div>
                  <div>{selected.adminEmail || "—"}</div>
                </div>
                <div>
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.action")}
                  </div>
                  <div className="font-mono">{selected.action}</div>
                </div>
                <div>
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.resource")}
                  </div>
                  <div>
                    {selected.resourceType || "—"}
                    {selected.resourceLabel ? ` · ${selected.resourceLabel}` : ""}
                  </div>
                </div>
                <div>
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.status")}
                  </div>
                  <div>{selected.status}</div>
                </div>
                <div>
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.ip")}
                  </div>
                  <div className="font-mono">{selected.clientIp || "—"}</div>
                </div>
                <div className="col-span-2">
                  <div className="text-[hsl(var(--muted-foreground))] text-xs">
                    {t("audit.userAgent")}
                  </div>
                  <div className="break-all text-xs">{selected.userAgent || "—"}</div>
                </div>
              </div>

              <div>
                <div className="text-sm font-semibold mb-1">{t("audit.changes")}</div>
                <DiffTable changes={selected.changes} />
              </div>

              {selected.metadata && (
                <div>
                  <div className="text-sm font-semibold mb-1">{t("audit.metadata")}</div>
                  <pre className="whitespace-pre-wrap break-words text-xs rounded-md border p-2">
                    {JSON.stringify(selected.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
