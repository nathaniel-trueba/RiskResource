// frontend/components/common/Navigation.tsx
'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTheme } from '@/components/common/ThemeProvider';

export default function Navigation() {
  const pathname = usePathname();
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <header className="sticky top-0 z-50 w-full bg-[#fcfbf7]/90 dark:bg-[#11100e]/90 backdrop-blur-md border-b border-[#ece6da] dark:border-white/10 px-6 py-3.5 transition-colors">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Brand Logo -> Home */}
        <Link
          href="/"
          className="group flex items-center gap-2.5 transition-transform active:scale-95"
        >
          <div className="border border-[#e5e0d5] dark:border-white/20 rounded-lg px-2.5 py-1.5 flex items-center gap-2.5 bg-white dark:bg-[#1a1815] group-hover:border-amber-500/50 transition-colors shadow-2xs">
            <span className="w-2.5 h-2.5 rounded-full border border-amber-500 flex items-center justify-center">
              <span className="w-1 h-1 bg-amber-500 rounded-full" />
            </span>
            <div>
              <span className="text-sm font-bold tracking-tight text-gray-900 dark:text-white block leading-tight">
                Risk Resource
              </span>
              <span className="text-[10px] text-gray-500 dark:text-gray-400 font-mono block leading-none">
                US natural disaster risk
              </span>
            </div>
          </div>
        </Link>

        {/* Nav Links + Site-Wide Theme Toggle */}
        <div className="flex items-center gap-3">
          <nav className="flex items-center gap-1 text-xs">
            {[
              { href: '/', label: 'Home' },
              { href: '/map', label: 'Risk map' },
              { href: '/about', label: 'About' },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`px-3 py-1.5 rounded-md transition-colors ${
                  pathname === link.href
                    ? 'bg-gray-200/80 text-gray-900 font-semibold dark:bg-white/10 dark:text-white'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white'
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Persistent Light / Dark Toggle */}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle light or dark mode"
            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-[#e5e0d5] bg-white text-gray-900 dark:border-white/15 dark:bg-[#1a1815] dark:text-gray-100 text-xs font-medium hover:opacity-90 transition-all cursor-pointer shadow-2xs"
          >
            <span
              className={`w-2 h-2 rounded-full ${
                isDark ? 'bg-amber-400' : 'bg-gray-800'
              }`}
            />
            <span className="hidden sm:inline">
              {isDark ? 'Light mode' : 'Dark mode'}
            </span>
          </button>
        </div>
      </div>
    </header>
  );
}
