import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FlowSpace — Delegate Work Across Google Workspace",
  description:
    "Delegate outcomes across Gmail, Calendar, Drive, Tasks, and Sheets. Track runs in real time and approve write actions before execution.",
  openGraph: {
    title: "FlowSpace — Delegate Work Across Google Workspace",
    description:
      "Delegate outcomes, track progress, and approve writes across Google Workspace from one native macOS app.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
