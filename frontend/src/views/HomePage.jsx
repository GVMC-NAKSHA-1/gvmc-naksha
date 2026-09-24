import { useNavigate } from 'react-router-dom';
import { FiArrowRight, FiBarChart2, FiLayers, FiMapPin, FiSettings, FiUsers } from 'react-icons/fi';
import PageMotion from '../components/PageMotion';
import { Kicker } from '../components/ui';

const ROWS = [
  { path: '/officer', icon: FiMapPin, title: 'Field Officer', accent: '#0d6efd',
    desc: 'Verify unverified parcels on the map, review satellite evidence, and update land record status.' },
  { path: '/supervisor', icon: FiUsers, title: 'Supervisor', accent: '#198754',
    desc: 'Monitor ward-level stats, review AI-generated alerts, and export ward reports.' },
  { path: '/commissioner', icon: FiBarChart2, title: 'Commissioner', accent: '#ffc107',
    desc: 'City-wide heatmap, top unverified wards, compliance estimates, and AI daily brief.' },
  { path: '/integration', icon: FiLayers, title: 'Integration', accent: '#0dcaf0',
    desc: 'Ingest multi-source geospatial data, run spatial matching, and resolve harmonization conflicts.' },
  { path: '/admin', icon: FiSettings, title: 'Admin Panel', accent: '#dc3545',
    desc: 'Upload GVMC property CSV, configure database, adjust detection threshold, trigger pipeline.' },
];

export default function HomePage() {
  const navigate = useNavigate();
  return (
    <PageMotion className="flex min-h-[calc(100vh-92px)] flex-col items-center justify-center px-4 py-10 sm:py-16">
      <header className="mb-10 max-w-[640px] text-center">
        <Kicker>GVMC · PS 26013 NAKSHA</Kicker>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Multi-source geospatial harmonization for Visakhapatnam&apos;s 98 wards
        </h1>
        <p className="mt-2 text-base text-subtle">Select a workspace to continue</p>
      </header>

      <div className="flex w-full max-w-[720px] flex-col gap-3">
        {ROWS.map(({ path, icon: Icon, title, desc, accent }, i) => (
          <button
            key={path}
            type="button"
            onClick={() => navigate(path)}
            style={{ '--accent': accent, animationDelay: `${i * 60}ms` }}
            className="group flex animate-fade-up items-center gap-4 rounded-xl border border-line bg-white px-4 py-3 text-left transition duration-200 hover:translate-x-1 hover:border-(--accent) hover:shadow-md focus-visible:shadow-focus focus-visible:outline-none sm:px-5 sm:py-4"
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-(--accent)/12 text-xl text-(--accent) transition-colors group-hover:bg-(--accent)/20 sm:size-11">
              <Icon />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-xl font-semibold text-ink sm:text-lg">{title}</span>
              <span className="block text-sm text-subtle">{desc}</span>
            </span>
            <FiArrowRight className="hidden shrink-0 -translate-x-1 text-lg text-(--accent) opacity-0 transition duration-200 group-hover:translate-x-0 group-hover:opacity-100 sm:block" />
          </button>
        ))}
      </div>
    </PageMotion>
  );
}
