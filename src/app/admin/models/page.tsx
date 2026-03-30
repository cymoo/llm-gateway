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
    if (!confirm(`Delete model "${alias}"? All user authorizations will be removed.`)) return;
    const res = await fetch(`/api/admin/models/${id}`, { method: "DELETE" });
    if (res.ok) {
      toast({ title: "Model deleted" });
      fetchModels();
    } else {
      const d = await res.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const res = await fetch(`/api/admin/models/${id}/test`, { method: "POST" });
      const data = await res.json();
      if (data.status === "ok") {
        toast({ title: `Connected (${data.latency_ms}ms)` });
      } else {
        toast({ title: "Connection failed", description: data.message, variant: "destructive" });
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
    if (!confirm(`Remove "${userName}" from model "${selectedModel.alias}"?`)) return;
    const res = await fetch(`/api/admin/users/${userId}/models/${selectedModel.id}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast({
        title: "Error",
        description: "Failed to remove user from model",
        variant: "destructive",
      });
      return;
    }
    toast({ title: "User removed" });
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
          <h1 className="text-2xl font-bold">Models</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            Manage backend LLM models
          </p>
        </div>
        <Link href="/admin/models/new">
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            Add Model
          </Button>
        </Link>
      </div>

      <div className="rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Alias</TableHead>
              <TableHead>Backend URL</TableHead>
              <TableHead>Backend Model</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Users</TableHead>
              <TableHead>Remark</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  Loading...
                </TableCell>
              </TableRow>
            ) : models.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-8 text-[hsl(var(--muted-foreground))]">
                  No models registered
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
                      {model.isActive ? "Active" : "Inactive"}
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
                        title="Test connection"
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
                        <Button variant="ghost" size="icon" title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                      </Link>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete"
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
            <DialogTitle>Authorized Users</DialogTitle>
            <DialogDescription>
              {selectedModel ? `Model: ${selectedModel.alias}` : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-xl border max-h-[60vh] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingModelUsers ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-[hsl(var(--muted-foreground))]"
                    >
                      Loading...
                    </TableCell>
                  </TableRow>
                ) : modelUsers.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={3}
                      className="text-center py-8 text-[hsl(var(--muted-foreground))]"
                    >
                      No authorized users
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
                          Remove
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
