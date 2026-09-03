"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { ToolRegistrationStatus } from "@kontier-ri/studio";

interface ToolHealth {
  status: ToolRegistrationStatus;
  error?: string;
}

interface WebMCPRegistryValue {
  runtimeAvailable: boolean;
  tools: Record<string, ToolHealth>;
  readyCount: number;
  registeringCount: number;
  failedTools: { name: string; error: string }[];
  report(
    toolName: string,
    status: ToolRegistrationStatus,
    error?: unknown,
  ): void;
}

const RegistryContext = createContext<WebMCPRegistryValue | null>(null);

function modelContextAvailable(): boolean {
  if (typeof document === "undefined") return false;
  const currentDocument = document as Document & { modelContext?: unknown };
  const currentNavigator = navigator as Navigator & { modelContext?: unknown };
  return Boolean(currentDocument.modelContext ?? currentNavigator.modelContext);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? "Unknown error");
}

export function WebMCPRegistryProvider({ children }: { children: ReactNode }) {
  const [runtimeAvailable, setRuntimeAvailable] = useState(false);
  const [tools, setTools] = useState<Record<string, ToolHealth>>({});

  useEffect(() => {
    const read = () => setRuntimeAvailable(modelContextAvailable());
    read();
    const interval = setInterval(read, 1000);
    return () => clearInterval(interval);
  }, []);

  const report = useCallback(
    (toolName: string, status: ToolRegistrationStatus, error?: unknown) => {
      setTools((current) => {
        if (status === "unregistered") {
          if (!(toolName in current)) return current;
          const next = { ...current };
          delete next[toolName];
          return next;
        }
        const nextHealth: ToolHealth = {
          status,
          ...(error !== undefined ? { error: errorMessage(error) } : {}),
        };
        const previous = current[toolName];
        if (
          previous?.status === nextHealth.status &&
          previous?.error === nextHealth.error
        ) {
          return current;
        }
        return { ...current, [toolName]: nextHealth };
      });
    },
    [],
  );

  const value = useMemo<WebMCPRegistryValue>(() => {
    const entries = Object.entries(tools);
    return {
      runtimeAvailable,
      tools,
      readyCount: entries.filter(([, health]) => health.status === "ready").length,
      registeringCount: entries.filter(
        ([, health]) => health.status === "registering",
      ).length,
      failedTools: entries
        .filter(([, health]) => health.status === "failed")
        .map(([name, health]) => ({
          name,
          error: health.error ?? "Registration failed",
        })),
      report,
    };
  }, [report, runtimeAvailable, tools]);

  return (
    <RegistryContext.Provider value={value}>
      {children}
    </RegistryContext.Provider>
  );
}

export function useWebMCPRegistry(): WebMCPRegistryValue {
  const value = useContext(RegistryContext);
  if (!value) {
    throw new Error("useWebMCPRegistry must be used inside WebMCPRegistryProvider");
  }
  return value;
}
