"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import { useParams, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  RefreshCw,
  Trash2,
  Plus,
  Eye,
  EyeOff,
  UserCog,
  KeyRound,
  ShieldCheck,
  Users2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/components/ui/use-toast";
import { validateAdminPassword } from "@/lib/utils/validators";
import { useLanguage } from "@/lib/i18n";

interface UserData {
  id: string;
  name: string;
  email: string;
  remark?: string | null;
  apiKey: string;
  isActive: boolean;
  isAdmin: boolean;
  groupId: string | null;
}

interface Group {
  id: string;
  name: string;
  isDefault: boolean;
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

function SectionCard({
  title,
  icon: Icon,
  children,
  action,
}: {
  title: string;
  icon?: React.ElementType;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200/60 dark:border-slate-700/60 bg-white/80 dark:bg-slate-800/60 shadow-sm overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/60 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          {Icon && (
            <Icon className="h-4 w-4 text-slate-500 dark:text-slate-400" />
          )}
          <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200">
            {title}
          </h2>
        </div>
        {action}
      </div>
      <div className="px-6 py-5">{children}</div>
    </div>
  );
}

function UserDetailContent() {
  const params = useParams();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const { t } = useLanguage();
  const userId = params.id as string;
  const backUrl = searchParams.get("back") ?? "/admin/users";

  const [user, setUser] = useState<UserData | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [authModels, setAuthModels] = useState<AuthorizedModel[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [initialIsAdmin, setInitialIsAdmin] = useState(false);
  const [selectedModelId, setSelectedModelId] = useState("");
  const [editingQuota, setEditingQuota] = useState<string | null>(null);
  const [quotaForm, setQuotaForm] = useState<Record<string, string>>({});

  // Dedicated password settings state
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [savingPassword, setSavingPassword] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [userRes, authRes, modelsRes, groupsRes] = await Promise.all([
        fetch(`/api/admin/users/${userId}`),
        fetch(`/api/admin/users/${userId}/models`),
        fetch("/api/admin/models"),
        fetch("/api/admin/groups"),
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
      if (groupsRes.ok) setGroups(await groupsRes.json());
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
        title: t("common.error"),
        description: t("users.pwdRequired"),
        variant: "destructive",
      });
      return;
    }
    if (user.isAdmin && !initialIsAdmin && password && !validateAdminPassword(password)) {
      toast({
        title: t("common.error"),
        description: t("users.invalidPwd"),
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
          remark: user.remark,
          isActive: user.isActive,
          isAdmin: user.isAdmin,
          groupId: user.groupId,
          password: user.isAdmin && !initialIsAdmin ? password : undefined,
        }),
      });
      if (res.ok) {
        toast({ title: t("users.userUpdated") });
        if (user.isAdmin && !initialIsAdmin) setPassword("");
        setInitialIsAdmin(user.isAdmin);
      } else {
        const d = await res.json();
        toast({ title: t("common.error"), description: d.error, variant: "destructive" });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSavePassword = async () => {
    if (!user) return;
    if (!password) {
      toast({
        title: t("common.error"),
        description: t("users.enterPwd"),
        variant: "destructive",
      });
      return;
    }
    if (!validateAdminPassword(password)) {
      toast({
        title: t("common.error"),
        description: t("users.invalidPwd"),
        variant: "destructive",
      });
      return;
    }

    setSavingPassword(true);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          remark: user.remark,
          isActive: user.isActive,
          isAdmin: user.isAdmin,
          password,
        }),
      });
      if (res.ok) {
        toast({ title: t("users.pwdUpdated") });
        setPassword("");
        setShowPassword(false);
      } else {
        const d = await res.json();
        toast({ title: t("common.error"), description: d.error, variant: "destructive" });
      }
    } finally {
      setSavingPassword(false);
    }
  };

  const handleRegenerateKey = async () => {
    if (
      !confirm(t("users.regenKeyConfirm"))
    )
      return;
    const res = await fetch(`/api/admin/users/${userId}/regenerate-key`, {
      method: "POST",
    });
    if (res.ok) {
      const data = await res.json();
      setUser((u) => (u ? { ...u, apiKey: data.apiKey } : u));
      toast({ title: t("users.apiKeyRegenerated") });
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
      toast({ title: t("users.modelAuthorized") });
      fetchData();
      setSelectedModelId("");
    } else {
      const d = await res.json();
      toast({ title: t("common.error"), description: d.error, variant: "destructive" });
    }
  };

  const handleRevokeModel = async (modelId: string, alias: string) => {
    if (!confirm(t("users.revokeModelConfirm", { alias }))) return;
    const res = await fetch(`/api/admin/users/${userId}/models/${modelId}`, {
      method: "DELETE",
    });
    if (res.ok) {
      toast({ title: t("users.modelRevoked") });
      fetchData();
    }
  };

  const handleStartEditQuota = (
    modelId: string,
    quota: AuthorizedModel["quota"]
  ) => {
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
    if (quotaForm.maxTokensPerDay)
      body.maxTokensPerDay = parseInt(quotaForm.maxTokensPerDay);
    else body.maxTokensPerDay = null;
    if (quotaForm.maxRequestsPerDay)
      body.maxRequestsPerDay = parseInt(quotaForm.maxRequestsPerDay);
    else body.maxRequestsPerDay = null;
    if (quotaForm.maxRequestsPerMin)
      body.maxRequestsPerMin = parseInt(quotaForm.maxRequestsPerMin);
    else body.maxRequestsPerMin = null;
    body.allowedTimeStart = quotaForm.allowedTimeStart || null;
    body.allowedTimeEnd = quotaForm.allowedTimeEnd || null;

    const res = await fetch(
      `/api/admin/users/${userId}/models/${modelId}/quota`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    );
    if (res.ok) {
      toast({ title: t("users.quotaUpdated") });
      setEditingQuota(null);
      fetchData();
    }
  };

  const authorizedModelIds = new Set(authModels.map((am) => am.model.id));
  const unauthorizedModels = availableModels.filter(
    (m) => !authorizedModelIds.has(m.id)
  );

  const currentGroup = groups.find((g) => g.id === user?.groupId);
  const isInDefaultGroup = !currentGroup || currentGroup.isDefault;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex flex-col items-center gap-2 text-slate-400">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <span className="text-sm">{t("common.loading")}</span>
        </div>
      </div>
    );
  }

  if (!user) return <div>{t("users.userNotFound")}</div>;

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={backUrl}>
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex items-center gap-3">
          <div className="flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 shadow-sm shadow-blue-200 dark:shadow-blue-900/30">
            <UserCog className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">{user.name}</h1>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              {user.email}
            </p>
          </div>
        </div>
      </div>

      {/* User Information */}
      <SectionCard title={t("users.userInformation")} icon={UserCog}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">{t("common.name")}</Label>
              <Input
                value={user.name}
                onChange={(e) => setUser({ ...user, name: e.target.value })}
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-blue-500"
              />
            </div>
            <div className="space-y-2">
              <Label className="text-slate-700 dark:text-slate-300">
                {t("common.email")}
              </Label>
              <Input
                type="email"
                value={user.email}
                onChange={(e) => setUser({ ...user, email: e.target.value })}
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-blue-500"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label
              htmlFor="remark"
              className="text-slate-700 dark:text-slate-300"
            >
              {t("common.remark")}
            </Label>
            <textarea
              id="remark"
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              rows={3}
              value={user.remark || ""}
              onChange={(e) => setUser({ ...user, remark: e.target.value })}
              placeholder="Optional remark"
            />
          </div>
          <div className="space-y-2">
            <Label className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <Users2 className="h-3.5 w-3.5 text-violet-500" />
              Group
            </Label>
            <Select
              value={user.groupId || ""}
              onValueChange={(v) => setUser({ ...user, groupId: v || null })}
            >
              <SelectTrigger className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus:ring-blue-500">
                <SelectValue placeholder={t("users.selectGroup")} />
              </SelectTrigger>
              <SelectContent>
                {groups.map((g) => (
                  <SelectItem key={g.id} value={g.id}>
                    {g.name}
                  {g.isDefault ? t("users.defaultSuffix") : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!isInDefaultGroup && (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {t("users.groupManagedNote", { group: currentGroup?.name ?? "" })}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex items-center gap-3">
              <Switch
                checked={user.isActive}
                onCheckedChange={(v) => setUser({ ...user, isActive: v })}
                id="active"
              />
              <Label
                htmlFor="active"
                className="text-slate-700 dark:text-slate-300"
              >
                {t("users.accountActive")}
              </Label>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                checked={user.isAdmin}
                onCheckedChange={(v) => setUser({ ...user, isAdmin: v })}
                id="admin"
              />
              <Label
                htmlFor="admin"
                className="text-slate-700 dark:text-slate-300 flex items-center gap-1.5"
              >
                <ShieldCheck className="h-3.5 w-3.5 text-indigo-500" />
                {t("users.adminAccess")}
              </Label>
            </div>
          </div>
          {/* Inline password prompt when first enabling admin */}
          {user.isAdmin && !initialIsAdmin && (
            <div className="space-y-2 rounded-lg bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200 dark:border-indigo-800/50 p-4">
              <Label
                htmlFor="newAdminPassword"
                className="text-indigo-700 dark:text-indigo-300 text-sm font-medium"
              >
                {t("users.setAdminPwd")}
              </Label>
              <Input
                id="newAdminPassword"
                type="password"
                placeholder={t("users.setAdminPwdPlaceholder")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white dark:bg-slate-800 border-indigo-200 dark:border-indigo-700 focus-visible:ring-indigo-500"
              />
              <p className="text-xs text-indigo-600/70 dark:text-indigo-400/70">
                {t("users.pwdHint")}
              </p>
            </div>
          )}
          <div className="space-y-2">
            <Label className="text-slate-700 dark:text-slate-300">
              {t("users.apiKey")}
            </Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 text-sm bg-slate-100 dark:bg-slate-700/60 text-slate-600 dark:text-slate-300 px-3 py-2 rounded-md font-mono truncate">
                {showKey
                  ? user.apiKey
                  : user.apiKey.slice(0, 8) + "••••••••••••"}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowKey(!showKey)}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showKey ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegenerateKey}
                className="border-slate-200 dark:border-slate-700"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                {t("users.regenerate")}
              </Button>
            </div>
          </div>
          <Button
            onClick={handleSaveUser}
            disabled={saving}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm shadow-blue-200 dark:shadow-blue-900/30 border-0"
          >
            {saving ? t("users.saving") : t("users.saveChanges")}
          </Button>
        </div>
      </SectionCard>

      {/* Password Settings */}
      <SectionCard title={t("users.passwordSettings")} icon={KeyRound}>
        <div className="space-y-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {t("users.pwdDesc")}
          </p>
          {user.isAdmin && (
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t("users.pwdAdminNote")}
            </p>
          )}
          <div className="space-y-2">
            <Label
              htmlFor="adminPassword"
              className="text-slate-700 dark:text-slate-300"
            >
              {t("users.newPassword")}
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="adminPassword"
                type={showPassword ? "text" : "password"}
                placeholder={t("users.enterNewPwd")}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 focus-visible:ring-blue-500"
              />
              <Button
                variant="ghost"
                size="icon"
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-200"
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </Button>
            </div>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              {t("users.pwdHint")}
            </p>
          </div>
          <Button
            onClick={handleSavePassword}
            disabled={savingPassword || !password}
            className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white shadow-sm shadow-blue-200 dark:shadow-blue-900/30 border-0"
          >
            {savingPassword ? t("users.saving") : t("users.updatePwd")}
          </Button>
        </div>
      </SectionCard>

      {/* Authorized Models */}
      <SectionCard
        title={t("users.authorizedModels")}
        action={
          <div className="flex items-center gap-2">
            {!isInDefaultGroup && (
              <Link href={`/admin/groups/${currentGroup?.id}`}>
                <Button variant="outline" size="sm" className="h-7 text-xs border-slate-200 dark:border-slate-700">
                  <Users2 className="h-3.5 w-3.5 mr-1" />
                  {t("users.editInGroup")}
                </Button>
              </Link>
            )}
            <Select
              value={selectedModelId}
              onValueChange={setSelectedModelId}
            >
              <SelectTrigger className="w-48 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800">
                <SelectValue placeholder={t("users.selectModel")} />
              </SelectTrigger>
              <SelectContent>
                {unauthorizedModels.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.alias}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              onClick={handleAddModel}
              disabled={!selectedModelId}
              className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {t("common.authorize")}
            </Button>
          </div>
        }
      >
        {!isInDefaultGroup && (
          <p className="text-sm text-amber-600 dark:text-amber-400 mb-4">
            {t("users.modelMergedNote", { group: currentGroup?.name ?? "" })}
          </p>
        )}
        {authModels.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">
            {t("users.noModelsAuthorized")}
          </p>
        ) : (
          <div className="rounded-lg border border-slate-200/60 dark:border-slate-700/60 overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50/80 dark:bg-slate-700/40 border-b border-slate-200/60 dark:border-slate-700/60">
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    Model
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t("users.tokensDay")}
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t("users.reqDay")}
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t("users.reqMin")}
                  </th>
                  <th className="text-left py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t("users.timeWindow")}
                  </th>
                  <th className="text-right py-2.5 px-4 font-semibold text-slate-600 dark:text-slate-300">
                    {t("common.actions")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {authModels.map((am) => (
                  <React.Fragment key={am.model.id}>
                    <tr className="border-b border-slate-100 dark:border-slate-700/40 last:border-0 hover:bg-slate-50/60 dark:hover:bg-slate-700/20 transition-colors">
                      <td className="py-2.5 px-4 font-medium text-slate-800 dark:text-slate-200">
                        {am.model.alias}
                      </td>
                      {editingQuota === am.model.id ? (
                        <>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-24 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder={t("common.unlimited")}
                              value={quotaForm.maxTokensPerDay}
                              onChange={(e) =>
                                setQuotaForm({
                                  ...quotaForm,
                                  maxTokensPerDay: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder={t("common.unlimited")}
                              value={quotaForm.maxRequestsPerDay}
                              onChange={(e) =>
                                setQuotaForm({
                                  ...quotaForm,
                                  maxRequestsPerDay: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <Input
                              className="h-7 w-16 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                              placeholder={t("common.unlimited")}
                              value={quotaForm.maxRequestsPerMin}
                              onChange={(e) =>
                                setQuotaForm({
                                  ...quotaForm,
                                  maxRequestsPerMin: e.target.value,
                                })
                              }
                            />
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 items-center">
                              <Input
                                className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeStart}
                                onChange={(e) =>
                                  setQuotaForm({
                                    ...quotaForm,
                                    allowedTimeStart: e.target.value,
                                  })
                                }
                              />
                              <span className="text-xs text-slate-400">–</span>
                              <Input
                                className="h-7 w-20 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                                placeholder="HH:MM"
                                value={quotaForm.allowedTimeEnd}
                                onChange={(e) =>
                                  setQuotaForm({
                                    ...quotaForm,
                                    allowedTimeEnd: e.target.value,
                                  })
                                }
                              />
                            </div>
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 justify-end">
                              <Button
                                size="sm"
                                onClick={() => handleSaveQuota(am.model.id)}
                                className="bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white border-0 h-7"
                              >
                                {t("common.save")}
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setEditingQuota(null)}
                                className="border-slate-200 dark:border-slate-700 h-7"
                              >
                                {t("common.cancel")}
                              </Button>
                            </div>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {am.quota?.maxTokensPerDay?.toLocaleString() || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {am.quota?.maxRequestsPerDay || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {am.quota?.maxRequestsPerMin || "—"}
                          </td>
                          <td className="py-2.5 px-4 text-slate-500 dark:text-slate-400">
                            {am.quota?.allowedTimeStart &&
                            am.quota?.allowedTimeEnd
                              ? `${am.quota.allowedTimeStart}–${am.quota.allowedTimeEnd}`
                              : "—"}
                          </td>
                          <td className="py-2.5 px-4">
                            <div className="flex gap-1 justify-end">
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() =>
                                  handleStartEditQuota(am.model.id, am.quota)
                                }
                                className="h-7 text-slate-500 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30"
                              >
                                Edit Quota
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() =>
                                  handleRevokeModel(
                                    am.model.id,
                                    am.model.alias
                                  )
                                }
                                className="h-7 w-7 text-slate-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        </>
                      )}
                    </tr>
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}

export default function UserDetailPage() {
  return (
    <Suspense>
      <UserDetailContent />
    </Suspense>
  );
}
