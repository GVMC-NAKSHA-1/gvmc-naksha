import { motion } from 'framer-motion';
import { MdSatellite } from 'react-icons/md';

const corner = 'absolute size-2.5 border-primary opacity-45';

export default function AppSplash() {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-white"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.35, ease: [0.4, 0, 0.2, 1] }}
    >
      <div
        className="relative size-24 overflow-hidden rounded-md border border-line bg-canvas"
        style={{
          backgroundImage:
            'linear-gradient(rgb(233 236 239 / .7) 1px, transparent 1px), linear-gradient(90deg, rgb(233 236 239 / .7) 1px, transparent 1px)',
          backgroundSize: '24px 24px',
        }}
        aria-hidden="true"
      >
        <span className="absolute inset-x-0 top-0 h-0.5 animate-scan bg-gradient-to-r from-transparent via-primary to-transparent" />
        <span className={`${corner} left-1.5 top-1.5 border-l-2 border-t-2`} />
        <span className={`${corner} right-1.5 top-1.5 border-r-2 border-t-2`} />
        <span className={`${corner} bottom-1.5 left-1.5 border-b-2 border-l-2`} />
        <span className={`${corner} bottom-1.5 right-1.5 border-b-2 border-r-2`} />
      </div>
      <div className="flex items-center gap-1.5 text-base font-semibold text-ink">
        <MdSatellite className="text-lg text-primary" />
        <span>NAKSHA GeoIntegrate</span>
      </div>
      <p className="text-xs text-faint" role="status">Loading geospatial workspace…</p>
    </motion.div>
  );
}
