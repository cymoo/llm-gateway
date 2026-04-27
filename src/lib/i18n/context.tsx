"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
} from "react";
import en, { type Translations } from "./locales/en";
import zh from "./locales/zh";

type Lang = "en" | "zh";

const locales: Record<Lang, Translations> = { en, zh };
const LANG_CHANGE_EVENT = "llm-gateway-language-change";

function detectLang(): Lang {
  const stored = localStorage.getItem("lang");
  if (stored === "en" || stored === "zh") return stored;
  if (navigator.language.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

function subscribe(onStoreChange: () => void): () => void {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(LANG_CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(LANG_CHANGE_EVENT, onStoreChange);
  };
}

function getServerLang(): Lang {
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
  const lang = useSyncExternalStore(subscribe, detectLang, getServerLang);

  const setLang = useCallback((next: Lang) => {
    localStorage.setItem("lang", next);
    window.dispatchEvent(new Event(LANG_CHANGE_EVENT));
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
