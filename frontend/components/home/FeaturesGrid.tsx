// frontend/components/home/FeaturesGrid.tsx
import React from 'react';
import Link from 'next/link';

const FEATURES = [
  {
    num: '01',
    title: 'Explore the risk map',
    description:
      'Switch between states and counties to view risk score, loss per person, social vulnerability or community resilience on both narrow and broad scales.',
    linkLabel: 'Open the map →',
    href: '/map',
  },
  {
    num: '02',
    title: 'See your biggest hazards',
    description:
      'Hazards and expected annual damage ranked per-county, so you know what is affecting your community most.',
    linkLabel: 'See an example →',
    href: '/map?fips=06065',
  },
  {
    num: '03',
    title: 'Live hazard alerts',
    description:
      'Active fires, flood gauges and weather warnings to understand what hazards are most imminent.',
    linkLabel: 'Check live conditions →',
    href: '/map',
  },
  {
    num: '04',
    title: 'Sources and Data',
    description:
      "Sources data from publicly available government-managed datasets.",
    linkLabel: 'How the data works →',
    href: '/about',
  },
];

export default function FeaturesGrid() {
  return (
    <section className="mt-20 pt-14 border-t border-[#e5e0d5] dark:border-white/10">
      <h2 className="text-3xl sm:text-4xl font-black text-gray-950 dark:text-white tracking-tight mb-8">
        Understand The Hazards Facing Your Community
      </h2>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        {FEATURES.map((item) => (
          <div
            key={item.num}
            className="p-6 bg-white border border-[#e5e0d5] dark:bg-[#181613] dark:border-white/10 rounded-3xl flex flex-col justify-between min-h-[240px] shadow-2xs"
          >
            <div>
              <span className="text-[11px] font-mono text-amber-800 dark:text-amber-500 block mb-3">
                {item.num}
              </span>
              <h3 className="text-base font-bold text-gray-950 dark:text-white">
                {item.title}
              </h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-2.5 leading-relaxed">
                {item.description}
              </p>
            </div>

            <Link
              href={item.href}
              className="mt-6 inline-block text-xs font-semibold text-amber-800 hover:text-amber-950 dark:text-[#e29b4d] dark:hover:text-amber-300 transition-colors"
            >
              {item.linkLabel}
            </Link>
          </div>
        ))}
      </div>
    </section>
  );
}
