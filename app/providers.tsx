"use client";
import * as React from "react";
import { ThemeProvider } from "@/components/theme-provider";
import { AuthProvider } from "@/lib/auth";
import { ToastProvider } from "@/components/ui/toast";
import { DemoStoreProvider } from "@/lib/demo-store";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <DemoStoreProvider>
          <ToastProvider>{children}</ToastProvider>
        </DemoStoreProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
