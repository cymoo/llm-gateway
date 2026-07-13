"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Wifi } from "lucide-react";
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
import { useToast } from "@/components/ui/use-toast";
import { useLanguage } from "@/lib/i18n";

interface ModelForm {
  alias: string;
  backendUrl: string;
  backendModel: string;
  type: string;
  backendApiKey: string;
  remark: string;
  isActive: boolean;
  defaultMaxTokensPerDay: string;
  defaultMaxRequestsPerDay: string;
  defaultMaxRequestsPerMin: string;
  defaultAllowedTimeStart: string;
  defaultAllowedTimeEnd: string;
}

const emptyForm: ModelForm = {
  alias: "",
  backendUrl: "",
  backendModel: "",
  type: "chat",
  backendApiKey: "",
  remark: "",
  isActive: true,
  defaultMaxTokensPerDay: "",
  defaultMaxRequestsPerDay: "",
  defaultMaxRequestsPerMin: "",
  defaultAllowedTimeStart: "",
  defaultAllowedTimeEnd: "",
};

interface ModelFormComponentProps {
  initialForm?: ModelForm;
  onSubmit: (form: ModelForm) => Promise<void>;
  loading: boolean;
  error: string;
  modelId?: string;
  onTest?: () => void;
  testLoading?: boolean;
}

export function ModelFormComponent({
  initialForm = emptyForm,
  onSubmit,
  loading,
  error,
  modelId,
  onTest,
  testLoading,
}: ModelFormComponentProps) {
  const [form, setForm] = useState<ModelForm>(initialForm);
  const { t } = useLanguage();

  const set = (key: keyof ModelForm, value: string | boolean) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(form);
      }}
      className="space-y-6"
    >
      <Card>
        <CardHeader>
          <CardTitle>{t("models.basicConfig")}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="alias">
              {t("models.modelAlias")} <span className="text-[hsl(var(--muted-foreground))]">{t("models.aliasVisible")}</span>
            </Label>
            <Input
              id="alias"
              value={form.alias}
              onChange={(e) => set("alias", e.target.value)}
              placeholder="my-qwen3"
              pattern="^[a-z0-9]([a-z0-9-]*[a-z0-9])?$"
              required
            />
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("models.aliasHint")}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="backendUrl">{t("models.backendUrlLabel")}</Label>
              <Input
                id="backendUrl"
                value={form.backendUrl}
                onChange={(e) => set("backendUrl", e.target.value)}
                placeholder="http://ip:port/v1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backendModel">{t("models.backendModelName")}</Label>
              <Input
                id="backendModel"
                value={form.backendModel}
                onChange={(e) => set("backendModel", e.target.value)}
                placeholder="Qwen/Qwen3-7B"
                required
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="type">{t("models.modelType")}</Label>
            <Select value={form.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger id="type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="chat">{t("models.typeChat")}</SelectItem>
                <SelectItem value="embedding">
                  {t("models.typeEmbedding")}
                </SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">
              {t("models.typeHint")}
            </p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="backendApiKey">
              {t("models.backendApiKey")} <span className="text-[hsl(var(--muted-foreground))]">{t("models.backendApiKeyOptional")}</span>
            </Label>
            <Input
              id="backendApiKey"
              value={form.backendApiKey}
              onChange={(e) => set("backendApiKey", e.target.value)}
              placeholder="sk-..."
              type="text"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="remark">
              {t("models.remark")} <span className="text-[hsl(var(--muted-foreground))]">{t("models.remarkOptional")}</span>
            </Label>
            <textarea
              id="remark"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              rows={3}
              value={form.remark}
              onChange={(e) => set("remark", e.target.value)}
              placeholder={t("common.optional")}
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v)}
            />
            <Label htmlFor="isActive">{t("models.activeLabel")}</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t("models.defaultQuota")}</CardTitle>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            {t("models.defaultQuotaHint")}
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>{t("models.maxTokensDay")}</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxTokensPerDay}
                onChange={(e) => set("defaultMaxTokensPerDay", e.target.value)}
                placeholder={t("common.unlimited")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("models.maxReqDay")}</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxRequestsPerDay}
                onChange={(e) => set("defaultMaxRequestsPerDay", e.target.value)}
                placeholder={t("common.unlimited")}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("models.maxReqMin")}</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxRequestsPerMin}
                onChange={(e) => set("defaultMaxRequestsPerMin", e.target.value)}
                placeholder={t("common.unlimited")}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>{t("models.allowedTimeStart")}</Label>
              <Input
                type="time"
                value={form.defaultAllowedTimeStart}
                onChange={(e) => set("defaultAllowedTimeStart", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>{t("models.allowedTimeEnd")}</Label>
              <Input
                type="time"
                value={form.defaultAllowedTimeEnd}
                onChange={(e) => set("defaultAllowedTimeEnd", e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {error && <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>}

      <div className="flex gap-3">
        <Button type="submit" disabled={loading}>
          {loading ? t("models.saving") : t("models.saveModel")}
        </Button>
        {modelId && onTest && (
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testLoading}
          >
            <Wifi className="h-4 w-4 mr-2" />
            {testLoading ? t("models.testing") : t("models.testBtn")}
          </Button>
        )}
        <Link href="/admin/models">
          <Button variant="outline" type="button">
            {t("common.cancel")}
          </Button>
        </Link>
      </div>
    </form>
  );
}

export default function NewModelPage() {
  const router = useRouter();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (form: ModelForm) => {
    setLoading(true);
    setError("");
    try {
      const body: Record<string, unknown> = {
        alias: form.alias,
        backendUrl: form.backendUrl,
        backendModel: form.backendModel,
        type: form.type,
        backendApiKey: form.backendApiKey || undefined,
        remark: form.remark || null,
        isActive: form.isActive,
        defaultMaxTokensPerDay: form.defaultMaxTokensPerDay
          ? parseInt(form.defaultMaxTokensPerDay)
          : null,
        defaultMaxRequestsPerDay: form.defaultMaxRequestsPerDay
          ? parseInt(form.defaultMaxRequestsPerDay)
          : null,
        defaultMaxRequestsPerMin: form.defaultMaxRequestsPerMin
          ? parseInt(form.defaultMaxRequestsPerMin)
          : null,
        defaultAllowedTimeStart: form.defaultAllowedTimeStart || null,
        defaultAllowedTimeEnd: form.defaultAllowedTimeEnd || null,
      };

      const res = await fetch("/api/admin/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok) {
        toast({ title: t("models.createdSuccess") });
        router.push("/admin/models");
      } else {
        const data = await res.json();
        setError(data.error || t("common.error"));
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center gap-4">
        <Link href="/admin/models">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("models.registerModel")}</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            {t("models.addVllmModel")}
          </p>
        </div>
      </div>
      <ModelFormComponent
        onSubmit={handleSubmit}
        loading={loading}
        error={error}
      />
    </div>
  );
}
