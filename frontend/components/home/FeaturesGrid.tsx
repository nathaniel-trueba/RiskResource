import React from 'react';
import Link from 'next/link';

export default function FeaturesGrid() {
  const card =
    'bg-[#FFFDF9] border border-[#E3D7C5] rounded-2xl p-6 flex flex-col justify-between h-64 transition-colors';
  const hoverCard = card + ' hover:border-[#B87530]';
  const link = 'text-xs font-semibold text-[#A44A0B] hover:text-[#804817] hover:underline';

  return (
    <section className="my-16">
      <span className="text-[11px] font-mono uppercase tracking-widest text-[#A44A0B] block mb-2">
        WHAT YOU CAN DO
      </span>
      <h2 className="text-3xl sm:text-4xl font-black text-[#2A1F16] tracking-tight mb-8">
        From national patterns to one county.
      </h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={hoverCard}>
          <div>
            <span className="text-xl mb-3 block text-amber-400">🗺️</span>
            <h3 className="text-sm font-bold text-white">Explore the risk map</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Switch between states and counties and color the map by risk score, FEMA&apos;s expected loss per person or in total, or the share of residents in high-loss counties.
            </p>
          </div>
          <Link href="/map" className={link}>Open the map →</Link>
        </div>

        <div className={hoverCard}>
          <div>
            <span className="text-xl mb-3 block">📊</span>
            <h3 className="text-sm font-bold text-[#2A1F16]">See your biggest hazards</h3>
            <p className="text-xs text-[#6B5B4B] mt-2 leading-relaxed">
              Every county ranks its hazards by expected annual damage, so you know what to prepare for first.
            </p>
          </div>
          <Link href="/map?q=Riverside" className={link}>See an example →</Link>
        </div>

        <div className={card}>
          <div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-base">⚠️</span>
              <span className="text-[9px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full bg-[#FFF2D1] border border-[#E8D6B5] text-[#8A5A00]">
                PLANNED
              </span>
            </div>
            <h3 className="text-sm font-bold text-[#2A1F16]">Live hazard alerts</h3>
            <p className="text-xs text-[#6B5B4B] mt-2 leading-relaxed">
              Active fires, flood gauges and weather warnings layered over long-term risk. Coming after the backend launches.
            </p>
          </div>
          <span className="text-xs text-[#6B5B4B] font-mono">Coming after backend launches</span>
        </div>

        <div className={hoverCard}>
          <div>
            <span className="text-xl mb-3 block text-amber-400">🗄️</span>
            <h3 className="text-sm font-bold text-white">Built on public data</h3>
            <p className="text-xs text-gray-400 mt-2 leading-relaxed">
              Loss estimates come from FEMA&apos;s National Risk Index. Scores combine FEMA disaster declarations, USGS earthquakes and live NWS alerts.
            </p>
          </div>
          <Link href="/about" className={link}>How the data works →</Link>
        </div>
      </div>
    </section>
  );
}
