"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { Plus, Pencil, Trash2, Wifi } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/lib/i18n";

interface Model {
  id: string;
  alias: string;
  backendUrl: string;
  backendModel: string;
  remark?: string | null;
  isActive: boolean;
  userCount: number;
  createdAt: string;
}

interface ModelUser {
  id: string;
  name: string;
  email: string;
}

export default function ModelsPage() {
  const { toast } = useToast();
  const { t } = useLanguage();
  const [models, setModels] = useState<Model[]>([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedModel, setSelectedModel] = useState<{ id: string; alias: string } | null>(null);
  const [modelUsers, setModelUsers] = useState<ModelUser[]>([]);
  const [loadingModelUsers, setLoadingModelUsers] = useState(false);

  const fetchModels = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/models");
      if (res.ok) setModels(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  const handleDelete = async (id: string, alias: string) => {
    if (!confirm(t("models.deleteConfirm", { alias }))) return;
    const res = await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: t("models.modelDeleted") });
      fetchModels();
    } else {
      const d = await res.json();
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/admin/models/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.status === "ok") {
        toast({ title: t("models.connected", { ms: data.latency_ms }) });
      } else {
        toast({ title: t("models.connectionFailed"), description: data.message, variant: "destructive" });
      }
    } finally {
      setTestingId(null);
    }
  };

  const openUsersDialog = async (model: Model) => {
    setSelectedModel({ id: model.id, alias: model.alias });
    setLoadingModelUsers(true);
    try {
      const res = await fetch(`/api/admin/models/${model.id}/users`);
      if (res.ok) {
        setModelUsers(await res.json());
      } else {
        setModelUsers([]);
      }
    } finally {
      setLoadingModelUsers(false);
    }
  };

  const handleRemoveUser = async (userId: string, userName: string) => {
    if (!selectedModel) return;
    if (!confirm(t("models.removeUserConfirm", { name: userName, alias: selectedModel.alias }))) return;
    const res = await fetch(`/api/admin/users/${userId}/models/${selectedModel.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast({
        title: t("common.error"),
        description: t("models.removeUserFailed"),
        variant: "destructive",
      });
      return;
    }
    toast({ title: t("models.userRemoved") });
    setModelUsers((prev) => prev.filter((u) => u.id !== userId));
    setModels((prev) =>
      prev.map((m) =>
        m.id === selectedModel.id
          ? { ...m, userCount: Math.max(0, m.userCount - 1) }
          : m
      )
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t("models.title")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {t("models.subtitle")}
          </p>
        </div>
        <Link href="/admin/models/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            {t("models.addModel")}
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("models.alias")}</TableHead>
              <TableHead>{t("models.backendUrl")}</TableHead>
              <TableHead>{t("models.backendModel")}</TableHead>
              <TableHead>{t("common.status")}</TableHead>
              <TableHead>{t("models.users")}</TableHead>
              <TableHead>{t("models.remark")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  {t("common.loading")}
                </TableCell>
              </TableRow>
            ) : models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  {t("models.noModels")}
                </TableCell>
              </TableRow>
            ) : (
              models.map((model) => (
                <TableRow key={model.id}>
                  <TableCell className="font-medium font-mono">{model.alias}</TableCell>
                  <TableCell className="text-sm text-[hsl(var(--muted-foreground))] max-w-xs truncate">
                    {model.backendUrl}
                  </TableCell>
                  <TableCell className="text-sm">{model.backendModel}</TableCell>
                  <TableCell>
                    <Badge variant={model.isActive ? "default" : "secondary"}>
                      {model.isActive ? t("common.active") : t("common.inactive")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="text-[hsl(var(--primary))] hover:underline"
                      onClick={() => openUsersDialog(model)}
                    >
                      {model.userCount}
                    </button>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-sm text-[hsl(var(--muted-foreground))]">
                    {model.remark || "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("models.testConnection")}
                        onClick={() => handleTest(model.id)}
                        disabled={testingId === model.id}
                      >
                        {testingId === model.id ? (
                          <Wifi className="h-4 w-4 animate-pulse" />
                        ) : (
                          <Wifi className="h-4 w-4" />
                        )}
                      </Button>
                      <Link href={`/admin/models/${model.id}`}>
                        <Button variant="ghost" size="icon" title={t("common.edit")}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={t("common.delete")}
                        onClick={() => handleDelete(model.id, model.alias)}
                      >
                        <Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={selectedModel !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedModel(null);
            setModelUsers([]);
          }
        }}
      >
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t("models.authorizedUsers")}</DialogTitle>
            <DialogDescription>
              {selectedModel ? t("models.modelLabel", { alias: selectedModel.alias }) : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("common.name")}</TableHead>
                  <TableHead>{t("common.email")}</TableHead>
                  <TableHead className="text-right">{t("common.actions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingModelUsers ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-[hsl(var(--muted-foreground))]"
                    >
                      {t("common.loading")}
                    </TableCell>
                  </TableRow>
                ) : modelUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-[hsl(var(--muted-foreground))]"
                    >
                      {t("models.noAuthorizedUsers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  modelUsers.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.name}</TableCell>
                      <TableCell className="text-[hsl(var(--muted-foreground))]">
                        {user.email}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleRemoveUser(user.id, user.name)}
                        >
                          {t("common.remove")}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
