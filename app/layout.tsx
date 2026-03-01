import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Localnotes",
  description: "Personal Markdown note-taking",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-background antialiased">{children}</body>
    </html>
  );
}
