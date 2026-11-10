"use client";

import React, { useEffect, useState } from "react";
import "@aurora-is-near/intents-swap-widget/styles.css";
import {
  Widget,
  WidgetConfigProvider,
} from "@aurora-is-near/intents-swap-widget-standalone";
import { Loader2 } from "lucide-react";
import { useTheme } from "next-themes";
import styles from "./aurora-intent-widget.module.css";

export interface AuroraIntentWidgetProps {
  destinationNearAddress: string;
}

interface AuroraConfig {
  apiKey?: string;
  environment: "production" | "staging";
}

export default function AuroraIntentWidget({
  destinationNearAddress,
}: AuroraIntentWidgetProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme === "dark";
  const [config, setConfig] = useState<AuroraConfig | null>(() => {
    const envKey = process.env.NEXT_PUBLIC_AURORA_INTENTS_API_KEY;
    if (envKey) {
      return {
        apiKey: envKey,
        environment:
          (process.env.NEXT_PUBLIC_AURORA_INTENTS_ENVIRONMENT as "production" | "staging") ||
          "production",
      };
    }
    return null;
  });

  useEffect(() => {
    if (config?.apiKey) return;
    let cancelled = false;

    fetch("/api/aurora/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: AuroraConfig | null) => {
        if (!cancelled && data) {
          setConfig({
            apiKey: data.apiKey || undefined,
            environment: data.environment || "production",
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfig({
            environment: "production",
          });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [config?.apiKey]);

  if (!config) {
    return (
      <div className="w-full flex justify-center py-12">
        <div className="flex flex-col items-center gap-2 text-muted-foreground text-xs">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span>Loading funding options…</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`${styles.container} min-w-0 w-full`}>
      <WidgetConfigProvider
        config={{
          apiKey: config.apiKey,
          environment: config.environment,
          sendAddress: destinationNearAddress,
          lockSwapDirection: true,
          defaultTargetToken: { symbol: "NEAR", blockchain: "near" },
          allowedTargetChainsList: ["near"],
        }}
        theme={{
          colorScheme: dark ? "dark" : "light",
          accentColor: dark ? "#ffffff" : "#000000",
          showContainer: false,
          stylePreset: "clean",
        }}
      >
        <Widget defaultMode="swap" />
      </WidgetConfigProvider>
    </div>
  );
}
