import React from 'react';
import Link from 'next/link';

const DATA_FEEDS = [
  {
    name: 'OpenFEMA',
    href: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
  },
  {
    name: 'USGS Earthquake',
    href: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  },
  {
    name: 'NWS Alerts',
    href: 'https://www.weather.gov/documentation/services-web-api',
  },
  {
    name: 'NOAA NWPS',
    href: 'https://api.water.noaa.gov/nwps/v1/docs/',
  },
  {
    name: 'Open-Meteo',
    href: 'https://open-meteo.com/en/docs',
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
          {/* Brand Mission */}
          <div className="md:col-span-4 pr-6">
            <h4 className="text-base font-bold text-white tracking-tight mb-2">Risk Resource</h4>
            <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
              Combines public data from OpenFEMA, NOAA/NWS, USGS, and Open-Meteo into an explainable risk index for homeowners and communities.
            </p>
          </div>

          {/* Column 1: Navigation */}
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

          {/* Column 2: Data Feeds */}
          <div className="md:col-span-2 space-y-3">
            <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
              Data feeds
            </h5>
            <ul className="space-y-2 text-xs">
              {DATA_FEEDS.map((feed) => (
                <li key={feed.name}>
                  <a
                    href={feed.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gray-400 hover:text-white transition-colors"
                  >
                    {feed.name}
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* Column 3: Affiliations */}
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

          {/* Column 4: Team */}
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
