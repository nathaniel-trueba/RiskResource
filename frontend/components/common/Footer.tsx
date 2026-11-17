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

export default function Footer() {
  return (
    <footer className="w-full bg-[#11100e] border-t border-white/10 py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
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
                About the data
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
            {['Member 1', 'Member 2', 'Member 3', 'Member 4'].map((name) => (
              <li key={name}>
                {/* TODO: replace href with each member's LinkedIn URL */}
                <a
                  href="#"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-gray-400 hover:text-white transition-colors"
                >
                  {name}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  );
}
