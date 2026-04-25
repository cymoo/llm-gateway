"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useState,
} from "react";
import en, { type Translations } from "./locales/en";
import zh from "./locales/zh";

type Lang = "en" | "zh";

const locales: Record<Lang, Translations> = { en, zh };

function detectLang(): Lang {
  if (typeof window === "undefined") return "en";
  const stored = localStorage.getItem("lang");
  if (stored === "en" || stored === "zh") return stored;
  if (navigator.language.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

type PathsToStrings<T, Prefix extends string = ""> = {
  [K in keyof T]: T[K] extends string
    ? `${Prefix}${K & string}`
    : T[K] extends Record<string, unknown>
      ? PathsToStrings<T[K], `${Prefix}${K & string}.`>
      : never;
}[keyof T];

type TranslationKey = PathsToStrings<Translations>;

function getNestedValue(
  obj: Record<string, unknown>,
  path: string,
): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] !== undefined ? String(vars[key]) : `{${key}}`,
  );
}

interface LanguageContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Lazy initializer: runs once on first render.
  // detectLang() returns "en" on the server (typeof window === "undefined" guard)
  // and the user's stored/browser preference on the client.
  const [lang, setLangState] = useState<Lang>(() => detectLang());

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem("lang", next);
    setLangState(next);
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const locale = locales[lang] as Record<string, unknown>;
      const value = getNestedValue(locale, key);
      if (value !== undefined) return interpolate(value, vars);
      // Fallback to English
      const fallback = getNestedValue(en as Record<string, unknown>, key);
      return interpolate(fallback ?? key, vars);
    },
    [lang],
  );

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
