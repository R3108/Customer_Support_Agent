"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { PublicConfig } from "@/lib/types";

let cached: Promise<PublicConfig> | null = null;

/** Public workspace branding and behaviour, fetched once per page load and shared by every chat surface. */
export function useWorkspaceConfig(): PublicConfig | null {
  const [config, setConfig] = useState<PublicConfig | null>(null);
  useEffect(() => {
    let cancelled = false;
    cached ??= api.config().catch((e) => {
      cached = null;
      throw e;
    });
    cached.then((c) => !cancelled && setConfig(c)).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);
  return config;
}
