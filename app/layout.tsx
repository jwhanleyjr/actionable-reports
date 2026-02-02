import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Constituent Search',
  description: 'Search Bloomerang constituents by name or email.',
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
