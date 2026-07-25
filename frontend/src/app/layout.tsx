import type { Metadata } from "next";
import { Inter, Playfair_Display } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { AccentProvider } from "@/context/AccentContext";
import ActivityTelemetry from "@/components/shared/ActivityTelemetry";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const playfair = Playfair_Display({
  subsets: ["latin"],
  variable: "--font-playfair",
});

export const metadata: Metadata = {
  metadataBase: new URL('https://autodeskai.ai'),
  title: "AutoDeskAI: Advanced Multi-Agent AI Workflow Automation",
  description: "Automate complex business tasks with AutoDeskAI. Orchestrate powerful AI agents to scale your productivity with our intelligent multi-agent ecosystem.",
  openGraph: {
    title: "AutoDeskAI: Advanced Multi-Agent AI Workflow Automation",
    description: "Automate complex business tasks with AutoDeskAI. Orchestrate powerful AI agents to scale your productivity with our intelligent multi-agent ecosystem.",
    url: "/",
    siteName: "AutoDeskAI",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "AutoDeskAI - Multi-Agent AI Orchestration",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AutoDeskAI: Advanced Multi-Agent AI Workflow Automation",
    description: "Automate complex business tasks with AutoDeskAI. Orchestrate powerful AI agents to scale your productivity with our intelligent multi-agent ecosystem.",
    images: ["/og-image.png"],
  },
};



export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${playfair.variable} antialiased bg-background text-foreground font-sans`}
      >
        <AuthProvider>
          <ThemeProvider>
            <AccentProvider>
              <ActivityTelemetry />
              <main className="flex-grow">
                {children}
              </main>
              <Toaster position="top-right" richColors />
            </AccentProvider>
          </ThemeProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
