import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import HeroScoreCard from '@/components/home/HeroScoreCard';
import HazardMapShowcase from '@/components/home/HazardMapShowcase';
import FeaturesGrid from '@/components/home/FeaturesGrid';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#fcfbf7] text-[#111827] flex flex-col justify-between antialiased selection:bg-amber-200">
      <Navigation />

      <main className="w-full max-w-7xl mx-auto px-6 sm:px-8 pt-12 pb-24">
        {/* Section 1: Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center mb-24">
          {/* Left column */}
          <div className="lg:col-span-7">
            <span className="text-xs font-mono uppercase tracking-[0.2em] text-amber-800 block mb-4 font-semibold">
              FEMA NATIONAL RISK INDEX · 3,232 COUNTIES
            </span>

            <h1 className="font-display text-5xl sm:text-7xl font-extrabold text-gray-950 tracking-[-0.03em] leading-[1.05]">
              Know the <br />
              disaster risk <br />
              <span className="text-amber-600">where you live.</span>
            </h1>

            <p className="text-base text-gray-600 mt-6 leading-relaxed max-w-md font-normal">
              See which natural hazards hit your county hardest, what they cost each year, and how prepared your community is.
            </p>

            {/* Search capsule */}
            <div className="mt-8 flex items-center bg-white border border-gray-300 rounded-2xl p-1.5 max-w-lg focus-within:border-amber-600 transition-colors shadow-sm">
              <span className="pl-3.5 pr-2 text-gray-400 text-base"></span>
              <input
                type="text"
                placeholder="Search a county or state"
                className="w-full bg-transparent text-base text-gray-900 placeholder-gray-400 focus:outline-none py-3"
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
                  className="px-3.5 py-1.5 rounded-full bg-white border border-gray-200 text-gray-700 text-xs cursor-pointer hover:border-gray-400 transition-colors shadow-2xs"
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
			<span className="text-xs font-mono uppercase tracking-[0.2em] text-amber-800 block mb-3 font-semibold">
			ONE COUNTRY, FIVE HAZARDS
			</span>
			<h2 className="font-display text-3xl sm:text-5xl font-extrabold text-gray-950 tracking-[-0.02em] mb-8">
			Risk looks different for every hazard.
			</h2>
			<HazardMapShowcase />
        </section>

        {/* Section 3: Features */}
        <FeaturesGrid />
      </main>

      <Footer />
    </div>
  );
}
