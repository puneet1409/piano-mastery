import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Piano Mastery App",
  description: "Learn piano with AI-powered practice sessions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
