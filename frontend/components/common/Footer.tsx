import React from 'react';
import Link from 'next/link';

const APIS_COL_1 = [
  {
    name: 'OpenFEMA',
    href: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
  },
  {
    name: 'FEMA NRI',
    href: 'https://hazards.fema.gov/nri/',
  },
  {
    name: 'USGS Earthquake',
    href: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  },
  {
    name: 'NWS Alerts',
    href: 'https://www.weather.gov/documentation/services-web-api',
  },
];

const APIS_COL_2 = [
  {
    name: 'NOAA NWPS',
    href: 'https://api.water.noaa.gov/nwps/v1/docs/',
  },
  {
    name: 'Open-Meteo',
    href: 'https://open-meteo.com/en/docs',
  },
  {
    name: 'NASA POWER',
    href: 'https://power.larc.nasa.gov/docs/services/api/',
  },
  {
    name: 'U.S. Census',
    href: 'https://www.census.gov/programs-surveys/popest.html',
  },
];

const TEAM_MEMBERS = [
  { name: 'Aditya Davanam', href: 'https://davadoba.github.io', external: true },
  { name: 'Lilia Maxwell', href: 'https://www.linkedin.com/in/lilia-maxwell-ab6aa83a2', external: true },
  { name: 'Kevin Li', href: 'https://www.linkedin.com/in/kevinznli/', external: true },
  { name: 'Nikhita Kadam', href: 'http://www.linkedin.com/in/nikhita-kadam-ba09b6298/', external: true },
];

export default function Footer() {
  return (
    <footer className="w-full bg-[#11100e] border-t border-white/10 pt-12 pb-8 px-6">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-10">
          {/* Brand Mission (3 cols) */}
          <div className="md:col-span-3 pr-4">
            <h4 className="text-base font-bold text-white tracking-tight mb-2">Risk Resource</h4>
            <p className="text-xs text-gray-400 leading-relaxed">
              Combines public data from OpenFEMA, NOAA/NWS, USGS, Open-Meteo, NASA POWER, and the U.S. Census into a single explainable score.
            </p>
          </div>

          {/* Column 1: Navigation (2 cols) */}
          <div className="md:col-span-2 space-y-3">
            <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
              Navigation
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <Link href="/" className="text-gray-400 hover:text-white transition-colors">
                  Home
                </Link>
              </li>
              <li>
                <Link href="/map" className="text-gray-400 hover:text-white transition-colors">
                  Risk map
                </Link>
              </li>
              <li>
                <Link href="/about" className="text-gray-400 hover:text-white transition-colors">
                  About
                </Link>
              </li>
            </ul>
          </div>

          {/* Column 2: APIs (3 cols split into 2 sub-columns) */}
          <div className="md:col-span-3 space-y-3">
            <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
              APIs
            </h5>
            <div className="grid grid-cols-2 gap-x-4 text-xs">
              <ul className="space-y-2">
                {APIS_COL_1.map((api) => (
                  <li key={api.name}>
                    <a
                      href={api.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {api.name}
                    </a>
                  </li>
                ))}
              </ul>
              <ul className="space-y-2">
                {APIS_COL_2.map((api) => (
                  <li key={api.name}>
                    <a
                      href={api.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {api.name}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Column 3: Affiliations (2 cols) */}
          <div className="md:col-span-2 space-y-3">
            <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
              Affiliations
            </h5>
            <ul className="space-y-2 text-xs">
              <li>
                <a
                  href="https://www.ds3atucsd.com/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  DS3 at UCSD
                </a>
              </li>
            </ul>
          </div>

          {/* Column 4: Team (2 cols) */}
          <div className="md:col-span-2 space-y-3">
            <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
              Team
            </h5>
            <ul className="space-y-2 text-xs">
              {TEAM_MEMBERS.map((member) => (
                <li key={member.name}>
                  {member.external ? (
                    <a
                      href={member.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {member.name}
                    </a>
                  ) : (
                    <Link
                      href={member.href}
                      className="text-gray-400 hover:text-white transition-colors"
                    >
                      {member.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* Bottom Disclaimer Bar */}
        <div className="pt-6 border-t border-white/10 text-xs text-gray-500">
          <p>
            Risk Resource is intended for informational purposes only and is not a substitute for official warnings or evacuation orders.
          </p>
        </div>
      </div>
    </footer>
  );
}
