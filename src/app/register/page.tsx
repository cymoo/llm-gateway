"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ name, email }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error || "Registration failed");
        return;
      }

      setSuccess(
        "Registration submitted successfully. Please wait for admin approval."
      );
      setName("");
      setEmail("");
    } catch {
      setError("Network error");
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
          <p className="text-[hsl(var(--muted-foreground))]">Self Registration</p>
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Request an Account</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Your name"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
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
                {loading ? "Submitting..." : "Submit Registration"}
              </Button>
            </form>
            <div className="mt-4 text-sm text-[hsl(var(--muted-foreground))]">
              Admin?{" "}
              <Link href="/admin/login" className="underline">
                Go to admin login
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
