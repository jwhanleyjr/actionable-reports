import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Bloomerang Search Tester',
  description: 'Quickly test Bloomerang constituent search by account number.',
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
