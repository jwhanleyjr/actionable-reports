import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campaign import tool",
  description: "Upload Bloomerang Excel exports and review campaign results.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
