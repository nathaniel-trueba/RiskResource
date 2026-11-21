// frontend/app/layout.tsx
import type { Metadata } from 'next';
import './globals.css';
import { ThemeProvider } from '@/components/common/ThemeProvider';

export const metadata: Metadata = {
  title: 'Risk Resource | US Natural Disaster Risk',
  description:
    'Synthesizing federal data from FEMA, NOAA, USGS, and NIFC into an explainable risk index for homeowners and communities.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-screen bg-[#fcfbf7] text-[#111827] dark:bg-[#11100e] dark:text-[#f3f4f6] antialiased transition-colors duration-200">
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
