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
import { useToast } from "@/components/ui/use-toast";

interface ModelForm {
  alias: string;
  backendUrl: string;
  backendModel: string;
  backendApiKey: string;
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
  backendApiKey: "",
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
          <CardTitle>Basic Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="alias">
              Model Alias <span className="text-[hsl(var(--muted-foreground))]">(user-visible name)</span>
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
              Only lowercase letters, digits, hyphens. Cannot start/end with hyphen.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="backendUrl">Backend URL</Label>
              <Input
                id="backendUrl"
                value={form.backendUrl}
                onChange={(e) => set("backendUrl", e.target.value)}
                placeholder="http://ip:port/v1"
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="backendModel">Backend Model Name</Label>
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
            <Label htmlFor="backendApiKey">
              Backend API Key <span className="text-[hsl(var(--muted-foreground))]">(optional)</span>
            </Label>
            <Input
              id="backendApiKey"
              value={form.backendApiKey}
              onChange={(e) => set("backendApiKey", e.target.value)}
              placeholder="sk-..."
              type="password"
            />
          </div>
          <div className="flex items-center gap-3">
            <Switch
              id="isActive"
              checked={form.isActive}
              onCheckedChange={(v) => set("isActive", v)}
            />
            <Label htmlFor="isActive">Active</Label>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Default Quota Template</CardTitle>
          <p className="text-sm text-[hsl(var(--muted-foreground))]">
            These defaults are inherited when authorizing users. Leave blank for no limit.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label>Max Tokens/Day</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxTokensPerDay}
                onChange={(e) => set("defaultMaxTokensPerDay", e.target.value)}
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Requests/Day</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxRequestsPerDay}
                onChange={(e) => set("defaultMaxRequestsPerDay", e.target.value)}
                placeholder="Unlimited"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Requests/Min</Label>
              <Input
                type="number"
                min="0"
                value={form.defaultMaxRequestsPerMin}
                onChange={(e) => set("defaultMaxRequestsPerMin", e.target.value)}
                placeholder="Unlimited"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Allowed Time Start (HH:MM)</Label>
              <Input
                type="time"
                value={form.defaultAllowedTimeStart}
                onChange={(e) => set("defaultAllowedTimeStart", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Allowed Time End (HH:MM)</Label>
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
          {loading ? "Saving..." : "Save Model"}
        </Button>
        {modelId && onTest && (
          <Button
            type="button"
            variant="outline"
            onClick={onTest}
            disabled={testLoading}
          >
            <Wifi className="h-4 w-4 mr-2" />
            {testLoading ? "Testing..." : "Test Connection"}
          </Button>
        )}
        <Link href="/admin/models">
          <Button variant="outline" type="button">
            Cancel
          </Button>
        </Link>
      </div>
    </form>
  );
}

export default function NewModelPage() {
  const router = useRouter();
  const { toast } = useToast();
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
        backendApiKey: form.backendApiKey || undefined,
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
        toast({ title: "Model created successfully" });
        router.push("/admin/models");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create model");
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
          <h1 className="text-2xl font-bold">Register Model</h1>
          <p className="text-[hsl(var(--muted-foreground))]">
            Add a new vLLM backend model
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
