'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import HeroScoreCard from '@/components/home/HeroScoreCard';
import HazardMapShowcase from '@/components/home/HazardMapShowcase';
import FeaturesGrid from '@/components/home/FeaturesGrid';
import HomeSearch from '@/components/home/HomeSearch';

const QUICK_LOCATIONS = [
  { label: 'Palm Springs, CA', query: 'Riverside County, CA' },
  { label: 'Santa Rosa, CA', query: 'Sonoma County, CA' },
  { label: 'Fresno, CA', query: 'Fresno County, CA' },
  { label: 'San Diego, CA', query: 'San Diego County, CA' },
];

export default function HomePage() {
  const [searchQuery, setSearchQuery] = useState('');
  const router = useRouter();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    router.push(`/map?q=${encodeURIComponent(trimmed)}`);
  };

  const handleChipClick = (query: string) => {
    router.push(`/map?q=${encodeURIComponent(query)}`);
  };

  return (
    <div className="min-h-screen bg-[#1a1612] text-white flex flex-col justify-between antialiased selection:bg-amber-900/60">
      <Navigation />

      <main className="w-full max-w-7xl mx-auto px-6 sm:px-8 pt-12 pb-24">
        {/* Section 1: Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center mb-24">
          {/* Left column */}
          <div className="lg:col-span-7">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-[#e29b4d] block mb-4 font-semibold">
              FEMA · USGS · NWS DATA · 3,221 COUNTIES
            </span>

            <h1 className="font-display text-5xl sm:text-7xl font-extrabold text-white tracking-[-0.03em] leading-[1.05]">
              Know the <br />
              disaster risk <br />
              <span className="text-[#e29b4d]">where you live.</span>
            </h1>

            <p className="text-base text-gray-400 mt-6 leading-relaxed max-w-md font-normal">
              See which natural hazards hit your county hardest, what FEMA estimates they cost each year, and how your community rates for resilience.
            </p>

            <HomeSearch />
          </div>

          {/* Right column */}
          <div className="lg:col-span-5">
            <HeroScoreCard />
          </div>
        </section>

        {/* Section 2: Map showcase */}
        <section className="mb-24">
          <span className="text-xs font-mono uppercase tracking-[0.2em] text-[#e29b4d] block mb-3 font-semibold">
            ONE COUNTRY, FIVE HAZARDS
          </span>
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-white tracking-[-0.02em]">
            Risk looks different for every hazard.
          </h2>
          <p className="text-sm text-gray-400 mt-3 mb-8">
            The same map, recolored by hazard. Pick one, or let it cycle.
          </p>
          <HazardMapShowcase />
        </section>

        {/* Section 3: Features */}
        <FeaturesGrid />
      </main>

      <Footer />
    </div>
  );
}
