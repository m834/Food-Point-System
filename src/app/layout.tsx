import type { Metadata, Viewport } from 'next';
import { AppProvider } from '@/components/AppContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'Food Point — Code Hustlers',
  description: 'Offline billing and order management for food points.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
