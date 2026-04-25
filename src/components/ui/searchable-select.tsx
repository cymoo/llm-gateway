"use client";

import React, { useState, useRef, useEffect } from "react";
import { Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
  /** Optional extra text used for matching (e.g. email). Falls back to label. */
  searchText?: string;
}

interface SearchableSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  className?: string;
}

export function SearchableSelect({
  value,
  onChange,
  options,
  placeholder = "Select…",
  className,
}: SearchableSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);
  const q = search.toLowerCase();
  const filtered = q
    ? options.filter((o) => (o.searchText ?? o.label).toLowerCase().includes(q))
    : options;

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch("");
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, []);

  useEffect(() => {
    if (open) searchRef.current?.focus();
  }, [open]);

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setSearch(""); }}
        className="w-full h-9 flex items-center justify-between gap-2 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-sm text-left focus:outline-none focus:ring-2 focus:ring-violet-500"
      >
        <span className={cn("truncate", selected ? "text-foreground" : "text-slate-400 dark:text-slate-500")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 min-w-[280px] w-full rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg">
          <div className="p-2 border-b border-slate-100 dark:border-slate-700/60">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
              <input
                ref={searchRef}
                className="w-full pl-7 pr-2 py-1.5 text-sm bg-slate-50 dark:bg-slate-700/50 rounded-sm outline-none placeholder:text-slate-400"
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="max-h-52 overflow-y-auto">
            <button
              type="button"
              className={cn(
                "w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-400 dark:text-slate-500",
                !value && "bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400"
              )}
              onClick={() => { onChange(""); setOpen(false); setSearch(""); }}
            >
              <span className="block truncate">{placeholder}</span>
            </button>
            {filtered.length === 0 ? (
              <div className="px-3 py-4 text-sm text-center text-slate-400">No results</div>
            ) : (
              filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40",
                    o.value === value && "bg-violet-50 dark:bg-violet-950/30 text-violet-600 dark:text-violet-400"
                  )}
                  onClick={() => { onChange(o.value); setOpen(false); setSearch(""); }}
                >
                  <span className="block truncate">{o.label}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

