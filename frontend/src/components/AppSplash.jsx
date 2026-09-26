import { motion } from 'framer-motion';

export default function AppSplash() {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-1 bg-canvas"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
    >
      <span className="text-sm font-semibold text-ink">NAKSHA GeoIntegrate</span>
      <span className="text-xs text-subtle" role="status">Loading geospatial workspace…</span>
    </motion.div>
  );
}
