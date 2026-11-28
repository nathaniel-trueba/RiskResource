// frontend/app/page.tsx
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import HeroScoreCard from '@/components/home/HeroScoreCard';
import HazardMapShowcase from '@/components/home/HazardMapShowcase';
import FeaturesGrid from '@/components/home/FeaturesGrid';
import HomeSearch from '@/components/home/HomeSearch';

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#fcfbf7] text-[#111827] dark:bg-[#1a1612] dark:text-white flex flex-col justify-between antialiased selection:bg-amber-200 dark:selection:bg-amber-900/60 transition-colors duration-200">
      <Navigation />

      <main className="w-full max-w-7xl mx-auto px-6 sm:px-8 pt-12 pb-24">
        {/* Section 1: Hero */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-14 items-center mb-24">
          {/* Left column */}
          <div className="lg:col-span-7">

            <h1 className="font-display text-5xl sm:text-7xl font-extrabold text-gray-950 dark:text-white tracking-[-0.03em] leading-[1.05]">
              Know the <br />
              disaster risk <br />
              <span className="text-amber-600 dark:text-[#e29b4d]">where you live.</span>
            </h1>

            <p className="text-base text-gray-600 dark:text-gray-400 mt-6 leading-relaxed max-w-md font-normal">
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
          <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-gray-950 dark:text-white tracking-[-0.02em]">
            Risk looks different for across the U.S.
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-3 mb-8">

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
