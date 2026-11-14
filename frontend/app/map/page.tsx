// frontend/app/map/page.tsx
'use client';

import React, { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';

const STATE_NAMES: Record<string, string> = {
  '01': 'Alabama|AL', '02': 'Alaska|AK', '04': 'Arizona|AZ', '05': 'Arkansas|AR',
  '06': 'California|CA', '08': 'Colorado|CO', '09': 'Connecticut|CT', '10': 'Delaware|DE',
  '11': 'District of Columbia|DC', '12': 'Florida|FL', '13': 'Georgia|GA', '15': 'Hawaii|HI',
  '16': 'Idaho|ID', '17': 'Illinois|IL', '18': 'Indiana|IN', '19': 'Iowa|IA',
  '20': 'Kansas|KS', '21': 'Kentucky|KY', '22': 'Louisiana|LA', '23': 'Maine|ME',
  '24': 'Maryland|MD', '25': 'Massachusetts|MA', '26': 'Michigan|MI', '27': 'Minnesota|MN',
  '28': 'Mississippi|MS', '29': 'Missouri|MO', '30': 'Montana|MT', '31': 'Nebraska|NE',
  '32': 'Nevada|NV', '33': 'New Hampshire|NH', '34': 'New Jersey|NJ', '35': 'New Mexico|NM',
  '36': 'New York|NY', '37': 'North Carolina|NC', '38': 'North Dakota|ND', '39': 'Ohio|OH',
  '40': 'Oklahoma|OK', '41': 'Oregon|OR', '42': 'Pennsylvania|PA', '44': 'Rhode Island|RI',
  '45': 'South Carolina|SC', '46': 'South Dakota|SD', '47': 'Tennessee|TN', '48': 'Texas|TX',
  '49': 'Utah|UT', '50': 'Vermont|VT', '51': 'Virginia|VA', '53': 'Washington|WA',
  '54': 'West Virginia|WV', '55': 'Wisconsin|WI', '56': 'Wyoming|WY', '72': 'Puerto Rico|PR',
};

export default function RiskMapPage() {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    let isCancelled = false;
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const $ = (s: string, r: ParentNode = root) => r.querySelector(s) as HTMLElement | null;
    const $$ = (s: string, r: ParentNode = root) => Array.from(r.querySelectorAll(s)) as HTMLElement[];

    const pad = (id: string | number, n: number) => String(id).padStart(n, '0');

    const HAZ = [
      { key: 'wildfire', label: 'Wildfire', color: '#E8590C' },
      { key: 'earthquake', label: 'Earthquake', color: '#A9742A' },
      { key: 'flood', label: 'Flood', color: '#2F7FD8' },
      { key: 'hurricane', label: 'Hurricane', color: '#0F8F8A' },
      { key: 'tornado', label: 'Tornado', color: '#7B5CE6' },
    ];

    const RAMPS: Record<string, string[]> = {
      risk: ['#FEF1C5', '#FDC86A', '#F98D3B', '#E14D28', '#A51D16'],
      loss: ['#FEF1C5', '#FDC86A', '#F98D3B', '#E14D28', '#A51D16'],
      sovi: ['#EFEAF7', '#CFC2E8', '#A48FD2', '#7659B6', '#4A318C'],
      resil: ['#E6F1F8', '#B6D4EA', '#78ADD5', '#3B82BB', '#1B568A'],
    };

    const METRICS: Record<string, any> = {
      risk: { label: 'Risk score', legend: 'Risk score (0–100)', fmt: (v: number) => Math.round(v), hazard: true },
      loss: { label: 'Loss per person', legend: 'Loss per person / yr', fmt: (v: number) => '$' + d3.format(',')(Math.round(v)), hazard: true },
      sovi: { label: 'Social vulnerability', legend: 'Social vulnerability', fmt: (v: number) => Math.round(v), hazard: false, note: 'Higher means harder to recover' },
      resil: { label: 'Community resilience', legend: 'Community resilience', fmt: (v: number) => Math.round(v), hazard: false, note: 'Higher is better' },
    };

    function hash(s: string) {
      let h = 2166136261;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 16777619);
      }
      return (h >>> 0) / 4294967295;
    }
    const g = (lon: number, lat: number, cx: number, cy: number, sx: number, sy: number) =>
      Math.exp(-(((lon - cx) / sx) ** 2 + ((lat - cy) / sy) ** 2) / 2);
    const sig = (x: number) => 1 / (1 + Math.exp(-x));
    const clamp = (v: number) => Math.max(0, Math.min(100, v));

    function sample(fips: string, st: string, lon: number, lat: number) {
      const n = (k: string) => hash(fips + k) - 0.5;
      let wf = 8 + 68 * sig((-lon - 104) / 3.5);
      if (st === 'CA') wf += 14;
      if (lon < -122.3 && lat > 43) wf -= 22;
      if (st === 'FL') wf = Math.max(wf, 44);
      if ((st === 'TX' || st === 'OK') && lon < -97) wf += 16;
      if (st === 'AK') wf = 30;
      if (st === 'HI') wf = 38;
      wf += n('w') * 26;

      let eq = 5 + n('e') * 10;
      if (st === 'CA') eq = 52 + 28 * g(lon, lat, -118.3, 34.3, 3, 2.4) + 20 * g(lon, lat, -122.3, 37.9, 1.6, 1.6) + n('e') * 14;
      else if ((st === 'WA' || st === 'OR') && lon < -121) eq = 42 + n('e') * 16;
      else if (['NV', 'UT', 'ID', 'MT', 'WY'].includes(st)) eq = 20 + 18 * g(lon, lat, -112, 40.7, 3, 3) + n('e') * 14;
      else if (st === 'AK') eq = 62 + n('e') * 14;
      else if (st === 'HI') eq = 46 + n('e') * 10;
      eq += 52 * g(lon, lat, -89.6, 36.5, 1.5, 1.5) + 24 * g(lon, lat, -80, 32.8, 1, 1);

      let fl = 14 + 42 * g(lon, lat, -91, 30.3, 4, 2.4) + 30 * g(lon, lat, -90.6, 38.5, 1.3, 6) + 22 * g(lon, lat, -95.2, 29.6, 2.5, 1.8) + 18 * g(lon, lat, -84.5, 38.5, 3, 1.5) + n('f') * 28;
      if (st === 'FL') fl += 26;
      if (lon < -105 && lat < 41) fl -= 6;

      let hu = 72 * g(lon, lat, -89.5, 29.6, 6, 1.6) + 60 * g(lon, lat, -95.6, 28.7, 2.6, 1.6) + 55 * g(lon, lat, -78, 34.6, 2.4, 1.7) + 42 * g(lon, lat, -81, 31.7, 1.6, 1.3) + 24 * g(lon, lat, -72.8, 41.2, 2.6, 1.6) + n('h') * 10;
      if (st === 'FL') hu = Math.max(hu, 58 + 22 * sig((-lat + 28) / 1.4));
      if (st === 'HI') hu = 30;

      let to = 72 * g(lon, lat, -97.3, 36.4, 3.6, 4.2) + 62 * g(lon, lat, -88.6, 33.4, 2.8, 2.2) + 30 * g(lon, lat, -93.5, 41.6, 4, 2.6) + n('t') * 22;
      if (lon < -104) to *= 0.3;

      const hz: Record<string, number> = {
        wildfire: clamp(wf),
        earthquake: clamp(eq),
        flood: clamp(fl),
        hurricane: clamp(hu),
        tornado: clamp(to),
      };
      const vals = Object.values(hz).sort((a, b) => b - a);
      const risk = clamp(0.55 * vals[0] + (0.45 * (vals[0] + vals[1] + vals[2])) / 3 + n('r') * 10);
      const loss = Math.max(60, 120 + risk * 7.6 + n('l') * 150);
      const sovi = clamp(32 + 26 * g(lon, lat, -89, 33, 8, 4) + 16 * g(lon, lat, -106, 33, 5, 3) + n('s') * 52);
      const resil = clamp(68 - sovi * 0.45 + n('c') * 36);
      return { hz, risk, loss, sovi, resil };
    }

    function rating(v: number): [string, string, string] {
      if (v >= 80) return ['Very high', '#A51D16', '#FFE3E0'];
      if (v >= 60) return ['Relatively high', '#B23A12', '#FFE9DC'];
      if (v >= 40) return ['Relatively moderate', '#8A5A00', '#FFF2D1'];
      if (v >= 20) return ['Relatively low', '#1E6B45', '#E2F3EA'];
      return ['Very low', '#1E6B45', '#E2F3EA'];
    }
    function styleRating(el: HTMLElement | null, v: number) {
      if (!el) return;
      const [t, fg, bg] = rating(v);
      el.textContent = t;
      el.style.color = fg;
      el.style.background = bg;
    }
    function ringColor(v: number) {
      return d3
        .scaleLinear<string>()
        .domain([0, 40, 60, 80, 100])
        .range(['#3BA776', '#C9A227', '#F0812F', '#E14D28', '#B3261E'])
        .clamp(true)(v);
    }
    function makeRing(el: any) {
      if (!el) return null;
      el.innerHTML =
        '<svg viewBox="0 0 100 100" aria-hidden="true"><circle class="bgc" cx="50" cy="50" r="42" stroke-width="9"/><circle class="fgc" cx="50" cy="50" r="42" stroke-width="9" stroke-dasharray="263.9" stroke-dashoffset="263.9"/></svg><div class="val"><div><span class="n">0</span><small>OF 100</small></div></div>';
      el._v = 0;
      return el;
    }
    function setRing(el: any, v: number) {
      if (!el) return;
      const c = el.querySelector('.fgc');
      const n = el.querySelector('.n');
      if (!c || !n) return;
      c.style.strokeDashoffset = (263.9 * (1 - v / 100)).toFixed(1);
      c.style.stroke = ringColor(v);
      el.setAttribute('aria-label', 'Score ' + Math.round(v) + ' of 100');
      const from = el._v || 0;
      el._v = v;
      if (reduceMotion) {
        n.textContent = String(Math.round(v));
        return;
      }
      const t0 = performance.now(),
        dur = 900;
      cancelAnimationFrame(el._raf);
      const step = (t: number) => {
        const k = Math.min(1, (t - t0) / dur),
          e = 1 - Math.pow(1 - k, 3);
        n.textContent = String(Math.round(from + (v - from) * e));
        if (k < 1) el._raf = requestAnimationFrame(step);
      };
      el._raf = requestAnimationFrame(step);
    }

    async function boot() {
      const res = await fetch('https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/counties-10m.json');
      const topo = await res.json();
      if (isCancelled) return;

      const rawCounties = (topojson.feature(topo, topo.objects.counties) as any).features;
      const rawStates = (topojson.feature(topo, topo.objects.states) as any).features.filter(
        (f: any) => STATE_NAMES[pad(f.id, 2)]
      );
      const stateMesh = topojson.mesh(topo, topo.objects.states, (a, b) => a !== b);

      const W = 975,
        H = 610;
      const proj = d3
        .geoAlbersUsa()
        .fitExtent(
          [
            [10, 10],
            [W - 10, H - 10],
          ],
          { type: 'FeatureCollection', features: rawStates } as any
        );
      const geoPath = d3.geoPath(proj);

      const C = new Map<string, any>();
      rawCounties.forEach((f: any) => {
        const id = pad(f.id, 5);
        const sfips = id.slice(0, 2);
        if (!STATE_NAMES[sfips]) return;
        const st = STATE_NAMES[sfips].split('|')[1];
        const name = f.properties?.name || `County ${id}`;
        const [lon, lat] = d3.geoCentroid(f);
        if (Number.isNaN(lon) || Number.isNaN(lat)) return;
        const d = sample(id, st, lon, lat);
        Object.assign(d, { id, name, st, sfips, feature: f, path: geoPath(f) });
        C.set(id, d);
      });

      const S = new Map<string, any>();
      rawStates.forEach((f: any) => {
        const id = pad(f.id, 2);
        const [name, abbr] = STATE_NAMES[id].split('|');
        const kids = [...C.values()].filter((c) => c.sfips === id);
        if (!kids.length) return;
        const mean = (fn: (c: any) => number) => d3.mean(kids, fn) || 0;
        const hz: Record<string, number> = {};
        HAZ.forEach((h) => (hz[h.key] = mean((c) => c.hz[h.key])));
        S.set(id, {
          id,
          name,
          abbr,
          count: kids.length,
          feature: f,
          path: geoPath(f),
          hz,
          risk: mean((c) => c.risk),
          loss: mean((c) => c.loss),
          sovi: mean((c) => c.sovi),
          resil: mean((c) => c.resil),
        });
      });

      const countyList = [...C.values()].filter((c) => c.path);
      const stateList = [...S.values()].filter((s) => s.path);

      const searchIndex = [
        ...stateList.map((s) => ({
          kind: 'state',
          id: s.id,
          label: s.name,
          meta: 'State · ' + s.count + ' counties',
          key: s.name.toLowerCase(),
        })),
        ...countyList.map((c) => ({
          kind: 'county',
          id: c.id,
          label: c.name + (/(Parish|city)$/i.test(c.name) ? '' : ' County'),
          meta: c.st,
          key: (c.name + ' ' + c.st + ' ' + (STATE_NAMES[c.sfips] || '').split('|')[0]).toLowerCase(),
        })),
      ];

      function wireSearch(input: HTMLInputElement | null, list: HTMLElement | null, onPick: (it: any) => void) {
        if (!input || !list) return;
        let items: any[] = [],
          active = -1;
        const close = () => {
          list.hidden = true;
          input.setAttribute('aria-expanded', 'false');
          active = -1;
        };
        const render = () => {
          list.innerHTML = items
            .map(
              (it, i) =>
                '<li role="option" id="' +
                list.id +
                '-' +
                i +
                '" aria-selected="' +
                (i === active) +
                '" data-i="' +
                i +
                '"><span>' +
                it.label +
                '</span><span>' +
                it.meta +
                '</span></li>'
            )
            .join('');
          list.hidden = !items.length;
          input.setAttribute('aria-expanded', String(!!items.length));
        };
        input.addEventListener('input', () => {
          const q = input.value.trim().toLowerCase();
          if (q.length < 2) {
            items = [];
            return close();
          }
          items = searchIndex
            .filter((it) => it.key.includes(q))
            .sort(
              (a, b) =>
                (a.key.startsWith(q) ? 0 : 1) - (b.key.startsWith(q) ? 0 : 1) ||
                (a.kind === 'state' ? -1 : 1)
            )
            .slice(0, 8);
          active = items.length ? 0 : -1;
          render();
        });
        input.addEventListener('keydown', (e) => {
          if (list.hidden) return;
          if (e.key === 'ArrowDown') {
            active = Math.min(items.length - 1, active + 1);
            render();
            e.preventDefault();
          } else if (e.key === 'ArrowUp') {
            active = Math.max(0, active - 1);
            render();
            e.preventDefault();
          } else if (e.key === 'Enter' && active >= 0) {
            e.preventDefault();
            const it = items[active];
            close();
            input.value = it.label;
            onPick(it);
          } else if (e.key === 'Escape') close();
        });
        list.addEventListener('mousedown', (e) => {
          const li = (e.target as HTMLElement).closest('li');
          if (!li) return;
          e.preventDefault();
          const it = items[Number(li.dataset.i)];
          close();
          input.value = it.label;
          onPick(it);
        });
        input.addEventListener('blur', () => setTimeout(close, 120));
      }

      const state = {
        geo: 'counties',
        metric: 'risk',
        hazard: 'all',
        focus: null as string | null,
        sel: { kind: 'state', id: '06' },
        binHover: -1,
      };

      const tip = $('#tip');
      const pRing = makeRing($('#pRing'));

      function value(d: any, metric = state.metric, hazard = state.hazard) {
        if (metric === 'risk') return hazard === 'all' ? d.risk : d.hz[hazard];
        if (metric === 'loss') {
          if (hazard === 'all') return d.loss;
          const tot = HAZ.reduce((s, h) => s + d.hz[h.key] ** 2, 0) || 1;
          return (d.loss * d.hz[hazard] ** 2) / tot;
        }
        return d[metric];
      }

      const mapSvgEl = $('#mapSvg') as unknown as SVGSVGElement;
      mapSvgEl.innerHTML = '';
      const svg = d3.select(mapSvgEl);
      const gRoot = svg.append('g');
      const gCounties = gRoot.append('g');
      const gStates = gRoot.append('g');
      gRoot.append('path').attr('class', 'borders').attr('d', geoPath(stateMesh));
      const hlPath = gRoot.append('path').attr('class', 'hl');
      const selPath = gRoot.append('path').attr('class', 'sel');

      let colorScale: any,
        bins: number[] = [];

      gCounties
        .selectAll('path')
        .data(countyList, (d: any) => d.id)
        .join('path')
        .attr('class', 'county')
        .attr('d', (d: any) => d.path)
        .on('pointerenter', (e, d) => hover(e, d, 'county'))
        .on('pointermove', moveTip)
        .on('pointerleave', unhover)
        .on('click', (e, d: any) => select('county', d.id));

      gStates
        .selectAll('path')
        .data(stateList, (d: any) => d.id)
        .join('path')
        .attr('class', 'state')
        .attr('d', (d: any) => d.path)
        .on('pointerenter', (e, d) => hover(e, d, 'state'))
        .on('pointermove', moveTip)
        .on('pointerleave', unhover)
        .on('click', (e, d: any) => {
          select('state', d.id);
          setGeo('counties');
          focusState(d.id, true);
        });

      const zoom = d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([1, 14])
        .translateExtent([
          [0, 0],
          [W, H],
        ])
        .filter((e) => e.type !== 'wheel' || e.ctrlKey || e.metaKey)
        .on('zoom', (e) => gRoot.attr('transform', e.transform));

      svg.call(zoom).on('dblclick.zoom', null);

      $('#zin')!.onclick = () => svg.transition().duration(350).call(zoom.scaleBy, 1.6);
      $('#zout')!.onclick = () => svg.transition().duration(350).call(zoom.scaleBy, 1 / 1.6);
      $('#zreset')!.onclick = () => {
        focusState(null);
        zoomTo(null);
      };
      $('#backUS')!.onclick = () => {
        focusState(null);
        zoomTo(null);
      };
      $('#pZoom')!.onclick = () => {
        const f = state.sel.kind === 'state' ? S.get(state.sel.id).feature : C.get(state.sel.id).feature;
        if (state.sel.kind === 'state') focusState(state.sel.id);
        else focusState(state.sel.id.slice(0, 2));
        zoomTo(f, state.sel.kind === 'county' ? 0.1 : 0.9);
      };

      $('#geoSeg')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (b && b.dataset.geo) setGeo(b.dataset.geo);
      });

      $('#metSeg')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button');
        if (!b || !b.dataset.metric) return;
        state.metric = b.dataset.metric;
        $$('#metSeg button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
        if (!METRICS[state.metric].hazard) state.hazard = 'all';
        renderHazRow();
        recolor();
        updatePanel();
      });

      function renderHazRow() {
        const enabled = METRICS[state.metric].hazard;
        const all = [{ key: 'all', label: 'All hazards', color: 'var(--ink)' }, ...HAZ];
        $('#hazRow')!.innerHTML =
          all
            .map(
              (h) =>
                '<button type="button" class="chip" data-h="' +
                h.key +
                '" aria-pressed="' +
                (state.hazard === h.key) +
                '"' +
                (enabled || h.key === 'all' ? '' : ' disabled') +
                '><span class="dot" style="background:' +
                h.color +
                '"></span>' +
                h.label +
                '</button>'
            )
            .join('') +
          (enabled
            ? ''
            : '<span style="align-self:center;font-size:13px;color:var(--muted)">Hazard filters apply to risk score and loss.</span>');
      }

      function setHazard(k: string) {
        if (!METRICS[state.metric].hazard && k !== 'all') {
          state.metric = 'risk';
          $$('#metSeg button').forEach((x) =>
            x.setAttribute('aria-pressed', String(x.dataset.metric === 'risk'))
          );
        }
        state.hazard = k;
        renderHazRow();
        recolor();
        updatePanel();
      }

      $('#hazRow')!.addEventListener('click', (e) => {
        const b = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
        if (!b || b.disabled || !b.dataset.h) return;
        setHazard(b.dataset.h);
      });

      wireSearch($('#mapSearch') as HTMLInputElement, $('#mapList'), (it) => {
        if (it.kind === 'state') {
          setGeo('counties');
          select('state', it.id);
          focusState(it.id, true);
        } else {
          setGeo('counties');
          select('county', it.id);
          focusState(it.id.slice(0, 2));
          zoomTo(C.get(it.id).feature, 0.1);
        }
      });

     function setGeo(geo: string, instant?: boolean) {
        state.geo = geo;
        $$('#geoSeg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.geo === geo)));
        gCounties.style('display', geo === 'counties' ? '' : 'none');
        gStates.style('display', geo === 'states' ? '' : 'none');
        if (geo === 'states') focusState(null);
        if (!instant) recolor();
      }

      function binOf(v: number) {
        let i = 0;
        while (i < bins.length && v >= bins[i]) i++;
        return i;
      }

      function applyDim() {
        const fs = state.focus;
        gCounties
          .selectAll('path')
          .classed(
            'dim',
            (d: any) =>
              Boolean(fs && d.sfips !== fs) ||
              (state.binHover >= 0 && binOf(value(d)) !== state.binHover)
          );
        gStates
          .selectAll('path')
          .classed('dim', (d: any) => state.binHover >= 0 && binOf(value(d)) !== state.binHover);
      }

      function renderLegend() {
        const m = METRICS[state.metric],
          f = m.fmt,
          r = RAMPS[state.metric];
        const edges = [null, ...bins, null];
        const rows = [];
        for (let i = r.length - 1; i >= 0; i--) {
          const lo = edges[i],
            hi = edges[i + 1];
          const txt =
            lo == null ? 'Under ' + f(hi) : hi == null ? f(lo) + ' and up' : f(lo) + ' – ' + f(hi);
          rows.push(
            '<li><button type="button" data-b="' +
              i +
              '"><span class="sw" style="background:' +
              r[i] +
              '"></span>' +
              txt +
              '</button></li>'
          );
        }
        const hz =
          m.hazard && state.hazard !== 'all'
            ? ' · ' + HAZ.find((h) => h.key === state.hazard)!.label
            : '';
        $('#legend')!.innerHTML =
          '<h4>' +
          m.legend +
          hz +
          '</h4><ul>' +
          rows.join('') +
          '</ul>' +
          (m.note
            ? '<div class="note">' + m.note + '</div>'
            : '<div class="note">Each color holds a fifth of ' +
              (state.geo === 'counties' ? 'counties' : 'states') +
              '</div>');
        $$('#legend button').forEach((b) => {
          const on = () => {
            state.binHover = Number(b.dataset.b);
            applyDim();
          };
          const off = () => {
            state.binHover = -1;
            applyDim();
          };
          b.addEventListener('pointerenter', on);
          b.addEventListener('pointerleave', off);
          b.addEventListener('focus', on);
          b.addEventListener('blur', off);
        });
      }

      function recolor(instant?: boolean) {
        const list = state.geo === 'counties' ? countyList : stateList;
        const vals = list.map((d) => value(d));
        colorScale = d3.scaleQuantile<string>().domain(vals).range(RAMPS[state.metric]);
        bins = colorScale.quantiles();
        const sel: any = state.geo === 'counties' ? gCounties.selectAll('path') : gStates.selectAll('path');
        (instant || reduceMotion ? sel : sel.transition().duration(650)).attr('fill', (d: any) =>
          colorScale(value(d))
        );
        renderLegend();
        applyDim();
      }

      function focusState(id: string | null, zoomIn?: boolean) {
        state.focus = id;
        $('#crumb')!.hidden = !id;
        applyDim();
        if (zoomIn && id) zoomTo(S.get(id).feature, 0.9);
      }

      function zoomTo(f: any, fill = 0.9) {
        if (!f) {
          svg
            .transition()
            .duration(reduceMotion ? 0 : 750)
            .call(zoom.transform, d3.zoomIdentity);
          return;
        }
        const [[x0, y0], [x1, y1]] = geoPath.bounds(f);
        const k = Math.min(14, fill / Math.max((x1 - x0) / W, (y1 - y0) / H));
        const t = d3.zoomIdentity
          .translate(W / 2, H / 2)
          .scale(k)
          .translate(-(x0 + x1) / 2, -(y0 + y1) / 2);
        svg
          .transition()
          .duration(reduceMotion ? 0 : 800)
          .call(zoom.transform, t);
      }

      function hover(e: any, d: any, kind: string) {
        hlPath.attr('d', d.path);
        const m = METRICS[state.metric],
          v = value(d);
        const nm =
          kind === 'state'
            ? d.name
            : d.name + (/(Parish|city)$/i.test(d.name) ? '' : ' County') + ', ' + d.st;
        tip!.innerHTML =
          '<b>' +
          nm +
          '</b>' +
          m.label +
          (m.hazard && state.hazard !== 'all'
            ? ' (' + HAZ.find((h) => h.key === state.hazard)!.label.toLowerCase() + ')'
            : '') +
          ': <span class="mono">' +
          m.fmt(v) +
          '</span><br>' +
          rating(d.risk)[0] +
          ' overall risk';
        tip!.hidden = false;
        moveTip(e);
      }

      function moveTip(e: any) {
        const x = Math.min(e.clientX, window.innerWidth - 260),
          y = Math.min(e.clientY, window.innerHeight - 110);
        tip!.style.left = x + 'px';
        tip!.style.top = y + 'px';
      }

      function unhover() {
        hlPath.attr('d', null);
        tip!.hidden = true;
      }

      function pct(list: any[], fn: (x: any) => number, v: number) {
        const n = list.length;
        let below = 0;
        for (const x of list) if (fn(x) < v) below++;
        return Math.round((below / n) * 100);
      }

      function updatePanel() {
        const { kind, id } = state.sel;
        const d = kind === 'state' ? S.get(id) : C.get(id);
        if (!d) return;
        const list = kind === 'state' ? stateList : countyList;
        $('#pKind')!.textContent = kind === 'state' ? 'State' : 'County';
        $('#pName')!.textContent =
          kind === 'state' ? d.name : d.name + (/(Parish|city)$/i.test(d.name) ? '' : ' County');
        $('#pSub')!.textContent =
          kind === 'state' ? d.count + ' counties' : (STATE_NAMES[d.sfips] || '').split('|')[0];
        const showHaz = METRICS[state.metric].hazard && state.hazard !== 'all';
        const score = showHaz ? d.hz[state.hazard] : d.risk;
        $('#pScoreLbl')!.textContent = showHaz
          ? HAZ.find((h) => h.key === state.hazard)!.label + ' risk score'
          : 'Overall risk score';
        styleRating($('#pRating'), score);
        setRing(pRing, score);
        const p = pct(list, (x) => (showHaz ? x.hz[state.hazard] : x.risk), score);
        $('#pRank')!.textContent =
          'Higher than ' + p + '% of ' + (kind === 'state' ? 'states' : 'US counties');

        const rows: [string, string | number, number, string][] = [
          [
            'Expected annual loss per person',
            '$' + d3.format(',')(Math.round(d.loss)),
            pct(list, (x) => x.loss, d.loss),
            'vs. other ' + (kind === 'state' ? 'states' : 'counties'),
          ],
          [
            'Social vulnerability',
            Math.round(d.sovi),
            pct(list, (x) => x.sovi, d.sovi),
            'Higher means harder to recover',
          ],
          [
            'Community resilience',
            Math.round(d.resil),
            pct(list, (x) => x.resil, d.resil),
            'Higher is better',
          ],
        ];

        $('#pKv')!.innerHTML = rows
          .map(
            (r) =>
              '<div class="row"><div class="top"><span>' +
              r[0] +
              '</span><span class="num">' +
              r[1] +
              '</span></div><div class="pbar" title="Percentile ' +
              r[2] +
              '"><span class="fill" style="width:0%"></span><span class="med" aria-hidden="true"></span></div><div class="cap">' +
              r[2] +
              'th percentile · ' +
              r[3] +
              ' · line marks the median</div></div>'
          )
          .join('');
        requestAnimationFrame(() =>
          $$('#pKv .fill').forEach((el, i) => (el.style.width = rows[i][2] + '%'))
        );

        const order = [...HAZ].sort((a, b) => d.hz[b.key] - d.hz[a.key]);
        $('#pHz')!.innerHTML = order
          .map(
            (h) =>
              '<button type="button" data-h="' +
              h.key +
              '" aria-pressed="' +
              (state.hazard === h.key) +
              '"><span>' +
              h.label +
              '</span><span class="track"><span class="fill" style="width:0%;background:' +
              h.color +
              '"></span></span><span class="num">' +
              Math.round(d.hz[h.key]) +
              '</span></button>'
          )
          .join('');
        requestAnimationFrame(() =>
          $$('#pHz button').forEach(
            (b) =>
              ((b.querySelector('.fill') as HTMLElement).style.width =
                d.hz[b.dataset.h!].toFixed(0) + '%')
          )
        );
        $$('#pHz button').forEach((b) =>
          b.addEventListener('click', () =>
            setHazard(state.hazard === b.dataset.h ? 'all' : b.dataset.h!)
          )
        );
      }

      function select(kind: string, id: string) {
        state.sel = { kind, id };
        const d = kind === 'state' ? S.get(id) : C.get(id);
        if (!d) return;
        selPath.attr('d', d.path);
        updatePanel();
      }

      renderHazRow();
      setGeo('counties', true);
      recolor(true);
      select('state', '06');
    }

    boot();

    return () => {
      isCancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen flex flex-col justify-between" ref={rootRef}>
      <style>{`
        .proto-scope {
          --bg: #F6F1E9;
          --surface: #FFFDF9;
          --surface-2: #EEE5D7;
          --ink: #2A1F16;
          --muted: #6B5B4B;
          --line: #E3D7C5;
          --accent: #A44A0B;
          --accent-ink: #FFFFFF;
          --accent-soft: #F7E3CC;
          --map-stroke: #FFFDF9;
          --map-border: #6E5C4B;
          --warn: #8A5A00;
          --warn-soft: #FFF2D1;
          --shadow: 0 18px 48px rgba(15, 33, 38, .12);
          --font-display: "Bricolage Grotesque", "Arial Narrow", system-ui, sans-serif;
          --font-body: "Public Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
          --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
          background: var(--bg);
          color: var(--ink);
          font: 400 16px/1.55 var(--font-body);
          flex: 1;
        }
        @media (prefers-color-scheme: dark) {
          .proto-scope {
            --bg: #17110C; --surface: #211912; --surface-2: #2D2219; --ink: #F1E7DA; --muted: #B5A592; --line: #3A2D22;
            --accent: #F2A541; --accent-ink: #231A13; --accent-soft: #3A2A15;
            --map-stroke: #17110C; --map-border: #A8987F; --warn: #F2C66B; --warn-soft: #3A2E12;
            --shadow: 0 18px 48px rgba(0, 0, 0, .45);
          }
        }
        .proto-scope * { box-sizing: border-box; }
        .proto-scope h1, .proto-scope h2, .proto-scope h3 { font-family: var(--font-display); letter-spacing: -0.02em; margin: 0; line-height: 1.04; }
        .proto-scope .num, .proto-scope .mono { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
        .proto-scope .wrap { max-width: 1240px; margin: 0 auto; padding-left: 16px; padding-right: 16px; }
        .proto-scope .eyebrow { font: 500 12px/1.2 var(--font-mono); letter-spacing: .09em; text-transform: uppercase; color: var(--accent); }
        .proto-scope .sample-pill { display: inline-flex; align-items: center; gap: 6px; font: 500 11px/1 var(--font-mono); letter-spacing: .06em; text-transform: uppercase; padding: 5px 9px; border-radius: 999px; background: var(--warn-soft); color: var(--warn); white-space: nowrap; }
        .proto-scope .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
        .proto-scope .btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; min-height: 44px; padding: 0 18px; border-radius: 12px; border: 1px solid transparent; font-weight: 600; font-size: 15px; cursor: pointer; }
        .proto-scope .btn-ghost { background: transparent; border-color: var(--line); color: var(--ink); }
        .proto-scope .btn-ghost:hover { border-color: var(--ink); }
        .proto-scope .seg { display: inline-flex; padding: 3px; gap: 2px; background: var(--surface-2); border-radius: 12px; flex-wrap: wrap; }
        .proto-scope .seg button { border: 0; background: transparent; min-height: 38px; padding: 0 12px; border-radius: 9px; cursor: pointer; font-size: 14px; font-weight: 500; color: var(--muted); }
        .proto-scope .seg button[aria-pressed="true"] { background: var(--surface); color: var(--ink); box-shadow: 0 1px 3px rgba(0,0,0,.12); }
        .proto-scope .chip { display: inline-flex; align-items: center; gap: 7px; min-height: 40px; padding: 0 13px; border-radius: 999px; border: 1px solid var(--line); background: var(--surface); cursor: pointer; font-size: 14px; font-weight: 500; color: var(--ink); }
        .proto-scope .chip:hover { border-color: var(--ink); }
        .proto-scope .chip[aria-pressed="true"] { background: var(--ink); color: var(--bg); border-color: var(--ink); }
        .proto-scope .chip:disabled { opacity: .45; cursor: not-allowed; }
        .proto-scope .chip .dot { width: 9px; height: 9px; border-radius: 50%; }
        .proto-scope .search { position: relative; }
        .proto-scope .search-box { display: flex; align-items: center; gap: 10px; height: 44px; padding: 0 14px; border-radius: 14px; border: 1px solid var(--line); background: var(--surface); }
        .proto-scope .search-box svg { flex: none; color: var(--muted); }
        .proto-scope .search-box input { flex: 1; min-width: 0; border: 0; outline: none; background: transparent; font-size: 16px; color: var(--ink); }
        .proto-scope .search-list { position: absolute; z-index: 30; left: 0; right: 0; top: calc(100% + 6px); list-style: none; margin: 0; padding: 6px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; box-shadow: var(--shadow); max-height: 320px; overflow-y: auto; color: var(--ink); }
        .proto-scope .search-list li { display: flex; justify-content: space-between; gap: 12px; padding: 10px 12px; border-radius: 10px; cursor: pointer; font-size: 15px; }
        .proto-scope .search-list li[aria-selected="true"], .proto-scope .search-list li:hover { background: var(--surface-2); }
        .proto-scope .search-list li span:last-child { color: var(--muted); font-size: 13px; }
        .proto-scope .ring { --size: 92px; width: var(--size); height: var(--size); flex: none; position: relative; }
        .proto-scope .ring svg { width: 100%; height: 100%; transform: rotate(-90deg); }
        .proto-scope .ring .bgc { fill: none; stroke: rgba(150,120,90,.22); }
        .proto-scope .ring .fgc { fill: none; stroke-linecap: round; transition: stroke-dashoffset 1s cubic-bezier(.2,.8,.2,1), stroke .4s ease; }
        .proto-scope .ring .val { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; font: 700 30px/1 var(--font-display); }
        .proto-scope .ring .val small { display: block; font: 500 10px/1 var(--font-mono); color: var(--muted); letter-spacing: .06em; margin-top: 4px; }
        .proto-scope .mapview { padding-block: 24px 56px; }
        .proto-scope .map-title { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 18px; }
        .proto-scope .map-title h1 { font-size: clamp(30px, 4vw, 44px); font-weight: 800; }
        .proto-scope .toolbar { display: flex; flex-wrap: wrap; gap: 12px 18px; align-items: center; padding: 14px; background: var(--surface); border: 1px solid var(--line); border-radius: 18px 18px 0 0; border-bottom: 0; }
        .proto-scope .toolbar .lbl { font: 500 11px/1 var(--font-mono); letter-spacing: .07em; text-transform: uppercase; color: var(--muted); display: block; margin-bottom: 6px; }
        .proto-scope .toolbar .grp { min-width: 0; }
        .proto-scope .toolbar .search { flex: 1 1 240px; min-width: 0; margin-left: auto; align-self: flex-end; }
        .proto-scope .hazrow { display: flex; gap: 8px; flex-wrap: wrap; padding: 0 14px 14px; background: var(--surface); border-left: 1px solid var(--line); border-right: 1px solid var(--line); }
        .proto-scope .mapgrid { display: flex; flex-wrap: wrap; gap: 0; align-items: stretch; background: var(--surface); border: 1px solid var(--line); border-radius: 0 0 18px 18px; overflow: hidden; }
        .proto-scope .mapwrap { flex: 999 1 600px; min-width: 0; position: relative; border-top: 1px solid var(--line); background: var(--bg); }
        .proto-scope .mapwrap svg { display: block; width: 100%; height: auto; touch-action: none; cursor: grab; }
        .proto-scope .mapwrap svg:active { cursor: grabbing; }
        .proto-scope .county, .proto-scope .state { stroke: var(--map-stroke); vector-effect: non-scaling-stroke; transition: opacity .25s ease; cursor: pointer; }
        .proto-scope .county { stroke-width: .35; }
        .proto-scope .state { stroke-width: .9; }
        .proto-scope .dim { opacity: .18; }
        .proto-scope .borders { fill: none; stroke: var(--map-border); stroke-width: .8; vector-effect: non-scaling-stroke; pointer-events: none; }
        .proto-scope .hl { fill: none; stroke: var(--ink); stroke-width: 1.6; vector-effect: non-scaling-stroke; pointer-events: none; }
        .proto-scope .sel { fill: none; stroke: var(--ink); stroke-width: 2.6; vector-effect: non-scaling-stroke; pointer-events: none; }
        .proto-scope .zoom-ctl { position: absolute; top: 12px; right: 12px; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--line); border-radius: 12px; overflow: hidden; box-shadow: var(--shadow); }
        .proto-scope .zoom-ctl button { width: 44px; height: 44px; border: 0; background: transparent; cursor: pointer; font-size: 20px; display: grid; place-items: center; color: var(--ink); }
        .proto-scope .zoom-ctl button + button { border-top: 1px solid var(--line); }
        .proto-scope .zoom-ctl button:hover { background: var(--surface-2); }
        .proto-scope .legend { position: absolute; left: 12px; bottom: 12px; background: var(--surface); border: 1px solid var(--line); border-radius: 14px; padding: 12px 14px; box-shadow: var(--shadow); max-width: calc(100% - 24px); }
        .proto-scope .legend h4 { margin: 0 0 8px; font-size: 13px; }
        .proto-scope .legend .note { font-size: 11.5px; color: var(--muted); margin-top: 6px; }
        .proto-scope .legend ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
        .proto-scope .legend button { display: flex; align-items: center; gap: 9px; width: 100%; border: 0; background: transparent; padding: 3px 6px; margin: 0 -6px; border-radius: 7px; cursor: pointer; font-size: 13px; text-align: left; color: var(--ink); }
        .proto-scope .legend button:hover { background: var(--surface-2); }
        .proto-scope .legend .sw { width: 18px; height: 14px; border-radius: 4px; flex: none; }
        .proto-scope .crumb { position: absolute; top: 12px; left: 12px; display: flex; gap: 8px; align-items: center; }
        .proto-scope .crumb .btn { min-height: 40px; background: var(--surface); box-shadow: var(--shadow); font-size: 14px; }
        .proto-scope .hint { position: absolute; right: 68px; top: 18px; font-size: 12px; color: var(--muted); }
        .proto-scope .tip { position: fixed; z-index: 50; pointer-events: none; background: var(--ink); color: var(--bg); padding: 9px 12px; border-radius: 10px; font-size: 13px; line-height: 1.35; box-shadow: var(--shadow); max-width: 240px; transform: translate(14px, 14px); }
        .proto-scope .tip b { display: block; font-size: 14px; }
        .proto-scope .tip .mono { opacity: .8; font-size: 12px; }
        .proto-scope .panel { flex: 1 1 340px; min-width: 0; border-top: 1px solid var(--line); border-left: 1px solid var(--line); padding: 22px; display: flex; flex-direction: column; gap: 18px; }
        .proto-scope .panel h2 { font-size: 30px; }
        .proto-scope .panel .sub { color: var(--muted); font-size: 14px; margin-top: 4px; }
        .proto-scope .panel .scorebox { display: flex; gap: 16px; align-items: center; }
        .proto-scope .rating { display: inline-flex; font-size: 12.5px; font-weight: 600; padding: 4px 10px; border-radius: 999px; }
        .proto-scope .kv { display: grid; gap: 12px; }
        .proto-scope .kv .row { display: grid; gap: 6px; }
        .proto-scope .kv .top { display: flex; justify-content: space-between; gap: 12px; font-size: 14px; }
        .proto-scope .kv .top .num { font-weight: 500; }
        .proto-scope .pbar { position: relative; height: 8px; border-radius: 99px; background: var(--surface-2); }
        .proto-scope .pbar .fill { position: absolute; inset: 0 auto 0 0; border-radius: 99px; background: var(--accent); transition: width .8s cubic-bezier(.2,.8,.2,1); }
        .proto-scope .pbar .med { position: absolute; top: -3px; bottom: -3px; width: 2px; background: var(--ink); opacity: .55; left: 50%; }
        .proto-scope .kv .cap { font-size: 12px; color: var(--muted); }
        .proto-scope .panel h3 { font-size: 17px; font-family: var(--font-body); font-weight: 700; letter-spacing: 0; }
        .proto-scope .hz { display: grid; gap: 6px; }
        .proto-scope .hz button { display: grid; grid-template-columns: 96px 1fr 30px; gap: 10px; align-items: center; border: 1px solid transparent; background: transparent; padding: 6px 8px; margin: 0 -8px; border-radius: 10px; cursor: pointer; font-size: 14px; text-align: left; min-height: 40px; color: var(--ink); }
        .proto-scope .hz button:hover { background: var(--surface-2); }
        .proto-scope .hz button[aria-pressed="true"] { border-color: var(--ink); }
        .proto-scope .hz .track { display: block; height: 8px; border-radius: 99px; background: var(--surface-2); overflow: hidden; }
        .proto-scope .hz .fill { display: block; height: 100%; border-radius: 99px; transition: width .8s cubic-bezier(.2,.8,.2,1); }
        .proto-scope .hz .num { text-align: right; }
        .proto-scope .panel .note { font-size: 12.5px; color: var(--muted); border-top: 1px solid var(--line); padding-top: 14px; }
      `}</style>

      <Navigation />

      <div className="proto-scope">
        <div className="wrap mapview">
          <div className="map-title">
            <div>
              <span className="eyebrow">Risk map</span>
              <h1>US natural disaster risk</h1>
            </div>
            <span className="sample-pill">Sample values, not FEMA data</span>
          </div>

          <div className="toolbar">
            <div className="grp">
              <span className="lbl" id="geoLbl">Geography</span>
              <div className="seg" role="group" aria-labelledby="geoLbl" id="geoSeg">
                <button type="button" data-geo="states" aria-pressed="false">States</button>
                <button type="button" data-geo="counties" aria-pressed="true">Counties</button>
              </div>
            </div>
            <div className="grp">
              <span className="lbl" id="metLbl">Color by</span>
              <div className="seg" role="group" aria-labelledby="metLbl" id="metSeg">
                <button type="button" data-metric="risk" aria-pressed="true">Risk score</button>
                <button type="button" data-metric="loss" aria-pressed="false">Loss per person</button>
                <button type="button" data-metric="sovi" aria-pressed="false">Social vulnerability</button>
                <button type="button" data-metric="resil" aria-pressed="false">Resilience</button>
              </div>
            </div>
            <div className="search" data-search>
              <label className="sr" htmlFor="mapSearch">Find a county or state</label>
              <div className="search-box">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5" />
                </svg>
                <input id="mapSearch" type="text" autoComplete="off" placeholder="Find a county or state" role="combobox" aria-expanded="false" aria-controls="mapList" aria-autocomplete="list" />
              </div>
              <ul className="search-list" id="mapList" role="listbox" hidden />
            </div>
          </div>

          <div className="hazrow" role="group" aria-label="Hazard" id="hazRow" />

          <div className="mapgrid">
            <div className="mapwrap" id="mapWrap">
              <svg id="mapSvg" viewBox="0 0 975 610" role="img" aria-label="Choropleth map of the United States" />
              <div className="crumb" id="crumb" hidden>
                <button className="btn btn-ghost" type="button" id="backUS">← All of the US</button>
              </div>
              <span className="hint">Drag to pan · click a place</span>
              <div className="zoom-ctl">
                <button type="button" id="zin" aria-label="Zoom in">+</button>
                <button type="button" id="zout" aria-label="Zoom out">−</button>
                <button type="button" id="zreset" aria-label="Reset view">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
                    <path d="M3 3v5h5" />
                  </svg>
                </button>
              </div>
              <div className="legend" id="legend" />
            </div>

            <aside className="panel" id="panel" aria-live="polite">
              <div>
                <span className="eyebrow" id="pKind">State</span>
                <h2 id="pName" style={{ marginTop: 8 }}>California</h2>
                <div className="sub" id="pSub" />
              </div>
              <div className="scorebox">
                <div className="ring" id="pRing" />
                <div>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }} id="pScoreLbl">Overall risk score</div>
                  <span className="rating" id="pRating" style={{ marginTop: 6 }} />
                  <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 8 }} id="pRank" />
                </div>
              </div>
              <div className="kv" id="pKv" />
              <div>
                <h3>Hazards, highest first</h3>
                <p style={{ margin: '4px 0 10px', fontSize: 12.5, color: 'var(--muted)' }}>Tap a hazard to color the map by it.</p>
                <div className="hz" id="pHz" />
              </div>
              <button className="btn btn-ghost" type="button" id="pZoom" style={{ alignSelf: 'flex-start' }}>Zoom to this place</button>
              <p className="note">Every number on this map is a made-up sample value so the prototype works. The real site will show FEMA National Risk Index data.</p>
            </aside>
          </div>
        </div>
        <div className="tip" id="tip" hidden />
      </div>

      <Footer />
    </div>
  );
}
