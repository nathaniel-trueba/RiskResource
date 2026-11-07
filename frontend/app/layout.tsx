import type { Metadata } from 'next';
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const bricolage = Bricolage_Grotesque({ subsets: ['latin'], variable: '--font-bricolage' });
const dmSans = DM_Sans({ subsets: ['latin'], variable: '--font-dm-sans' });
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains' });

export const metadata: Metadata = {
  title: 'Risk Resource | US Natural Disaster Risk',
  description:
    'Synthesizing federal data from FEMA, NOAA, USGS and NIFC into an explainable risk index for homeowners and communities.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${dmSans.variable} ${jetbrains.variable}`}
    >
      <body className="font-sans bg-[#1a1612] text-white min-h-screen antialiased selection:bg-amber-900/60 selection:text-white">
        {children}
      </body>
    </html>
  );
}