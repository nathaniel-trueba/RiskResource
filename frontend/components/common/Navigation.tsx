'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navigation() {
  const pathname = usePathname();

  const linkClass = (href: string) =>
    `px-3.5 py-2 rounded-lg transition-colors ${
      pathname === href
        ? 'bg-white/10 text-white font-medium'
        : 'text-gray-400 hover:text-white'
    }`;

  return (
    <header className="w-full bg-[#1a1612]/90 border-b border-white/10 px-6 sm:px-10 py-4 sticky top-0 z-50 backdrop-blur-md">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand */}
        <Link href="/" className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-full border border-white/20 flex items-center justify-center bg-[#1d1914]">
            <div className="w-4 h-4 rounded-full border border-amber-400 flex items-center justify-center">
              <div className="w-1.5 h-1.5 bg-amber-400 rounded-full" />
            </div>
          </div>
          <div>
            <span className="text-base font-bold text-white block leading-tight">Risk Resource</span>
            <span className="text-[11px] text-gray-400 font-mono block leading-none mt-0.5">
              US natural disaster risk
            </span>
          </div>
        </Link>

        {/* Links */}
        <nav className="flex items-center gap-1.5 text-sm">
          <Link href="/" className={linkClass('/')}>Home</Link>
          <Link href="/map" className={linkClass('/map')}>Risk map</Link>
          <Link href="/about" className={linkClass('/about')}>About the data</Link>
        </nav>
      </div>
    </header>
  );
}