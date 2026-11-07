import React from 'react';
import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="w-full bg-[#11100e] border-t border-white/10 py-12 px-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-12 gap-8">
        {/* Brand Mission */}
        <div className="md:col-span-6 pr-6">
          <h4 className="text-base font-bold text-white tracking-tight mb-2">Risk Resource</h4>
          <p className="text-xs text-gray-400 leading-relaxed max-w-sm">
            Combines federal data from FEMA, NOAA, USGS and NIFC into an explainable risk index for homeowners and communities.
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
          <ul className="space-y-2 text-xs text-gray-400">
            <li>FEMA NRI</li>
            <li>USGS</li>
            <li>NOAA / NWS</li>
            <li>NIFC</li>
          </ul>
        </div>

        {/* Column 3: Affiliations */}
        <div className="md:col-span-2 space-y-3">
          <h5 className="text-xs font-mono uppercase tracking-wider text-gray-200 font-semibold">
            Affiliations
          </h5>
          <ul className="space-y-2 text-xs text-gray-400">
            <li>DS3 at UCSD</li>
            <li>HDSI</li>
          </ul>
        </div>
      </div>
    </footer>
  );
}