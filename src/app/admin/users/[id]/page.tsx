"use client";

import React, { useEffect, useState, useCallback } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, RefreshCw, Trash2, Plus, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/components/ui/use-toast";
import { validateAdminPassword } from "@/lib/utils/validators";

interface UserData {
  id: string;
  name: string;
  email: string;
  apiKey: string;
  isActive: boolean;
  isAdmin: boolean;
}

interface AuthorizedModel {
  model: {
    id: string;
    alias: string;
    backendUrl: string;
    backendModel: string;
    isActive: boolean;
  };
  quota: {
    maxTokensPerDay: number | null;
    maxRequestsPerDay: number | null;
    maxRequestsPerMin: number | null;
    allowedTimeStart: string | null;
    allowedTimeEnd: string | null;
  } | null;
}

interface AvailableModel {
  id: string;
  alias: string;
}

export default function UserDetailPage() {
  const params = useParams();
  const { toast } = useToast();
  const userId = params.id as string;

  const [user, setUser] = useState<UserData | null>(null);
  const [authModels, setAuthModels] = useState<AuthorizedModel[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [password, setPassword] = useState("");
  const [initialIsAdmin, setInitialIsAdmin] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editingQuota, setEditingQuota] = useState<string | null>(null);
  const [quotaForm, setQuotaForm] = useState<Record<string, string>>({});

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, authRes, modelsRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}`),
        fetch(`/api/admin/users/${userId}/models`),
        fetch("/api/admin/models"),
      ]);
      if (userRes.ok) {
        const userData = await userRes.json();
        setUser(userData);
        setInitialIsAdmin(userData.isAdmin);
      }
      if (authRes.ok) setAuthModels(await authRes.json());
      if (modelsRes.ok) {
        const all = await modelsRes.json();
        setAvailableModels(all);
      }
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSaveUser = async () => {
    if (!user) return;
    if (user.isAdmin && !initialIsAdmin && !password) {
      toast({
        title: "Error",
        description: "Password is required when enabling admin access",
        variant: "destructive",
      });
      return;
    }
    if (password && !validateAdminPassword(password)) {
      toast({
        title: "Error",
        description:
          "Invalid password: use 8-128 printable ASCII characters without spaces",
        variant: "destructive",
      });
      return;
    }

    setSaving(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          isActive: user.isActive,
          isAdmin: user.isAdmin,
          password: password || undefined,
        }),
      });
      if (res.ok) {
        toast({ title: "User updated" });
        setPassword("");
        setInitialIsAdmin(user.isAdmin);
      } else {
        const d = await res.json();
        toast({ title: "Error", description: d.error, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (!confirm("Regenerate API key? The old key will stop working immediately.")) return;
    const res = await fetch(`/api/admin/users/${userId}/regenerate-key`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setUser((u) => u ? { ...u, apiKey: data.apiKey } : u);
      toast({ title: "API key regenerated" });
    }
  };

  const handleAddModel = async () => {
    if (!selectedModelId) return;
    const res = await fetch(`/api/admin/users/${userId}/models`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: selectedModelId }),
    });
    if (res.ok) {
      toast({ title: "Model authorized" });
      fetchData();
      setSelectedModelId("");
    } else {
      const d = await res.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  };

  const handleRevokeModel = async (modelId: string, alias: string) => {
    if (!confirm(`Revoke access to model "${alias}"?`)) return;
    const res = await fetch(`/api/admin/users/${userId}/models/${modelId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast({ title: "Model authorization revoked" });
      fetchData();
    }
  };

  const handleStartEditQuota = (modelId: string, quota: AuthorizedModel["quota"]) => {
    setEditingQuota(modelId);
    setQuotaForm({
      maxTokensPerDay: quota?.maxTokensPerDay?.toString() || "",
      maxRequestsPerDay: quota?.maxRequestsPerDay?.toString() || "",
      maxRequestsPerMin: quota?.maxRequestsPerMin?.toString() || "",
      allowedTimeStart: quota?.allowedTimeStart || "",
      allowedTimeEnd: quota?.allowedTimeEnd || "",
    });
  };

  const handleSaveQuota = async (modelId: string) => {
    const body: Record<string, unknown> = {};
    if (quotaForm.maxTokensPerDay) body.maxTokensPerDay = parseInt(quotaForm.maxTokensPerDay);
    else body.maxTokensPerDay = null;
    if (quotaForm.maxRequestsPerDay) body.maxRequestsPerDay = parseInt(quotaForm.maxRequestsPerDay);
    else body.maxRequestsPerDay = null;
    if (quotaForm.maxRequestsPerMin) body.maxRequestsPerMin = parseInt(quotaForm.maxRequestsPerMin);
    else body.maxRequestsPerMin = null;
    body.allowedTimeStart = quotaForm.allowedTimeStart || null;
    body.allowedTimeEnd = quotaForm.allowedTimeEnd || null;

    const res = await fetch(`/api/admin/users/${userId}/models/${modelId}/quota`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) {
      toast({ title: "Quota updated" });
      setEditingQuota(null);
      fetchData();
    }
  };

  const authorizedModelIds = new Set(authModels.map((am) => am.model.id));
  const unauthorizedModels = availableModels.filter((m) => !authorizedModelIds.has(m.id));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-[hsl(var(--muted-foreground))]">Loading...</div>
      </div>
    );
  }

  if (!user) return <div>User not found</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/users">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{user.name}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">{user.email}</p>
        </div>
      </div>

      {/* User Info Card */}
      <Card>
        <CardHeader>
          <CardTitle>User Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input
                value={user.name}
                onChange={(e) => setUser({ ...user, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>Email</Label>
              <Input
                type="email"
                value={user.email}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={user.isActive}
              onCheckedChange={(v) => setUser({ ...user, isActive: v })}
              id="active"
            />
            <Label htmlFor="active">Account Active</Label>
          </div>
          <div className="flex items-center gap-3">
            <Switch
              checked={user.isAdmin}
              onCheckedChange={(v) => setUser({ ...user, isAdmin: v })}
              id="admin"
            />
            <Label htmlFor="admin">Admin</Label>
          </div>
          {user.isAdmin && (
            <div className="space-y-2">
              <Label htmlFor="adminPassword">
                Admin Password {initialIsAdmin ? "(optional)" : "(required)"}
              </Label>
              <Input
                id="adminPassword"
                type="password"
                placeholder={
                  initialIsAdmin
                    ? "Leave blank to keep current password"
                    : "Set an admin password"
                }
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-2">
            <Label>API Key</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-[hsl(var(--muted))] px-3 py-2 rounded font-mono truncate">
                {showKey ? user.apiKey : user.apiKey.slice(0, 8) + "••••••••••••"}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowKey(!showKey)}
              >
                {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
              <Button variant="outline" size="sm" onClick={handleRegenerateKey}>
                <RefreshCw className="h-4 w-4 mr-2" />
                Regenerate
              </Button>
            </div>
          </div>
          <Button onClick={handleSaveUser} disabled={saving}>
            {saving ? "Saving..." : "Save Changes"}
          </Button>
        </CardContent>
      </Card>

      {/* Authorized Models Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Authorized Models</CardTitle>
          <div className="flex items-center gap-2">
            <Select value={selectedModelId} onValueChange={setSelectedModelId}>
              <SelectTrigger className="w-48">
                <SelectValue placeholder="Select model..." />
              </SelectTrigger>
              <SelectContent>
                {unauthorizedModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.alias}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={handleAddModel} disabled={!selectedModelId}>
              <Plus className="h-4 w-4 mr-2" />
              Authorize
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {authModels.length === 0 ? (
            <p className="text-[hsl(var(--muted-foreground))] text-sm">
              No models authorized yet
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Model</TableHead>
                  <TableHead>Tokens/Day</TableHead>
                  <TableHead>Req/Day</TableHead>
                  <TableHead>Req/Min</TableHead>
                  <TableHead>Time Window</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {authModels.map((am) => (
                  <React.Fragment key={am.model.id}>
                    <TableRow>
                      <TableCell className="font-medium">{am.model.alias}</TableCell>
                      {editingQuota === am.model.id ? (
                        <>
                          <TableCell>
                            <Input
                              className="h-7 w-24"
                              placeholder="Unlimited"
                              value={quotaForm.maxTokensPerDay}
                              onChange={(e) =>
                                setQuotaForm({ ...quotaForm, maxTokensPerDay: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-7 w-20"
                              placeholder="Unlimited"
                              value={quotaForm.maxRequestsPerDay}
                              onChange={(e) =>
                                setQuotaForm({ ...quotaForm, maxRequestsPerDay: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              className="h-7 w-16"
                              placeholder="Unlimited"
                              value={quotaForm.maxRequestsPerMin}
                              onChange={(e) =>
                                setQuotaForm({ ...quotaForm, maxRequestsPerMin: e.target.value })
                              }
                            />
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 items-center">
                              <Input
                                className="h-7 w-20"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeStart}
                                onChange={(e) =>
                                  setQuotaForm({ ...quotaForm, allowedTimeStart: e.target.value })
                                }
                              />
                              <span className="text-xs">–</span>
                              <Input
                                className="h-7 w-20"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeEnd}
                                onChange={(e) =>
                                  setQuotaForm({ ...quotaForm, allowedTimeEnd: e.target.value })
                                }
                              />
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-end">
                              <Button size="sm" onClick={() => handleSaveQuota(am.model.id)}>
                                Save
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingQuota(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      ) : (
                        <>
                          <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">
                            {am.quota?.maxTokensPerDay?.toLocaleString() || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">
                            {am.quota?.maxRequestsPerDay || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">
                            {am.quota?.maxRequestsPerMin || "—"}
                          </TableCell>
                          <TableCell className="text-sm text-[hsl(var(--muted-foreground))]">
                            {am.quota?.allowedTimeStart && am.quota?.allowedTimeEnd
                              ? `${am.quota.allowedTimeStart}–${am.quota.allowedTimeEnd}`
                              : "—"}
                          </TableCell>
                          <TableCell>
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => handleStartEditQuota(am.model.id, am.quota)}
                              >
                                Edit Quota
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRevokeModel(am.model.id, am.model.alias)}
                              >
                                <Trash2 className="h-4 w-4 text-[hsl(var(--destructive))]" />
                              </Button>
                            </div>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  </React.Fragment>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
