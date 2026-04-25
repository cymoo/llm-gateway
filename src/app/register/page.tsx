"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useLanguage } from "@/lib/i18n";

export default function RegisterPage() {
  const { t } = useLanguage();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || t("auth.regFailed"));
        return;
      }

      const adminName = data?.adminName || "admin";
      setSuccess(t("auth.regSuccess", { name: adminName }));
      setName("");
      setEmail("");
      setPassword("");
    } catch {
      setError(t("auth.networkError"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[hsl(var(--muted))]">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Bot className="h-8 w-8 text-[hsl(var(--primary))]" />
            <span className="text-2xl font-bold">LLM Gateway</span>
          </div>
          <p className="text-[hsl(var(--muted-foreground))]">{t("auth.selfRegistration")}</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>{t("auth.requestAccount")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t("common.name")}</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("auth.yourName")}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">{t("common.email")}</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">{t("auth.password")}</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t("auth.choosePassword")}
                  required
                />
              </div>
              {error && (
                <p className="text-sm text-[hsl(var(--destructive))]">{error}</p>
              )}
              {success && (
                <p className="text-sm text-green-600">{success}</p>
              )}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t("auth.submitting") : t("auth.submitReg")}
              </Button>
            </form>
            <div className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
              {t("auth.isAdmin")}{" "}
              <Link href="/admin/login" className="underline">
                {t("auth.goAdminLogin")}
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
