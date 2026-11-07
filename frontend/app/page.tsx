import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import HeroScoreCard from '@/components/home/HeroScoreCard';
import HazardMapShowcase from '@/components/home/HazardMapShowcase';
import FeaturesGrid from '@/components/home/FeaturesGrid';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#1a1612] text-white flex flex-col justify-between antialiased selection:bg-amber-900/60">
      <Navigation />

      <main className="w-full max-w-7xl mx-auto px-6 sm:px-8 pt-12 pb-24">
        {/* Section 1: Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center mb-24">
          {/* Left column */}
          <div className="lg:col-span-7">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-[#e29b4d] block mb-4 font-semibold">
              FEMA NATIONAL RISK INDEX · 3,232 COUNTIES
            </span>

            <h1 className="font-display text-5xl sm:text-7xl font-extrabold text-white tracking-[-0.03em] leading-[1.05]">
              Know the <br />
              disaster risk <br />
              <span className="text-[#e29b4d]">where you live.</span>
            </h1>

            <p className="text-base text-gray-400 mt-6 leading-relaxed max-w-md font-normal">
              See which natural hazards hit your county hardest, what they cost each year, and how prepared your community is.
            </p>

            {/* Search capsule */}
            <div className="mt-8 flex items-center bg-[#1d1914] border border-white/10 rounded-2xl p-1.5 max-w-lg focus-within:border-[#e29b4d]/60 transition-colors shadow-lg">
              <span className="pl-3.5 pr-2 text-gray-500 text-base">🔍</span>
              <input
                type="text"
                placeholder="Search a county or state"
                className="w-full bg-transparent text-base text-white placeholder-gray-500 focus:outline-none py-3"
              />
              <button
                type="button"
                className="px-6 py-3 bg-[#e29b4d] hover:bg-[#c98335] text-black font-semibold text-sm rounded-xl transition-all whitespace-nowrap cursor-pointer shrink-0"
              >
                Find my risk
              </button>
            </div>

            {/* Location chips */}
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span className="font-mono text-xs">Try:</span>
              {['Palm Springs, CA', 'Santa Rosa, CA', 'Fresno, CA', 'San Diego, CA'].map((loc) => (
                <span
                  key={loc}
                  className="px-3.5 py-1.5 rounded-full bg-[#1d1914] border border-white/10 text-gray-300 text-xs cursor-pointer hover:border-white/30 transition-colors"
                >
                  {loc}
                </span>
              ))}
            </div>
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