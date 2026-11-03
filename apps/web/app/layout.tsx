import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/components/AuthProvider";
import { Toaster } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Allocard",
  description: "Trustless Corporate Expense Cards built on NEAR Protocol Delegation Contracts",
  icons: {
    icon: [
      { url: '/AllocardLogoBlack.svg', media: '(prefers-color-scheme: light)' },
      { url: '/AllocardLogoWhite.svg', media: '(prefers-color-scheme: dark)' }
    ]
  }
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en" className="light" suppressHydrationWarning>
      <body className={`${geistSans.variable} ${geistMono.variable} min-h-dvh antialiased`}>
        <TooltipProvider>
          <AuthProvider>
            {children}
          </AuthProvider>
        </TooltipProvider>
        <Toaster position="top-center" />
      </body>
    </html>
  );
}
