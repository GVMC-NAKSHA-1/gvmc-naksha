import { COMPARISON_YEARS, getComparisonStats } from '../mockData/comparisonData';
import { SectionTitle, inputCls } from './ui';

export default function ComparisonControls({ baseYear, compareYear, onBaseYearChange, onCompareYearChange }) {
  const s = getComparisonStats(baseYear, compareYear);
  const cards = [
    { label: 'New Structures', value: s.newStructures.toLocaleString(), accent: '#dc3545' },
    { label: 'Change of Use', value: s.changeOfUse.toLocaleString(), accent: '#ffc107' },
    { label: 'Built-up Area +', value: `${s.builtUpAreaIncreaseSqm.toLocaleString()} m²`, accent: '#0d6efd' },
    { label: 'Assessable Area', value: `${s.estimatedAssessableAreaSqm.toLocaleString()} m²`, accent: '#0dcaf0' },
    { label: 'Avg NDBI Change', value: `+${s.avgNdbiChange.toFixed(2)}`, accent: '#6f42c1' },
    { label: 'Tax Impact', value: `₹${s.estimatedTaxImpactInr.toLocaleString('en-IN')}`, accent: '#198754' },
  ];

  return (
    <section className="flex flex-col gap-2 border-t border-line-light pt-2">
      <SectionTitle>Comparison</SectionTitle>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Base Year
          <select className={inputCls} value={baseYear} onChange={(e) => onBaseYearChange(Number(e.target.value))}>
            {COMPARISON_YEARS.map((y) => <option key={y} value={y} disabled={y >= compareYear}>{y}</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-subtle">
          Compare With
          <select className={inputCls} value={compareYear} onChange={(e) => onCompareYearChange(Number(e.target.value))}>
            {COMPARISON_YEARS.map((y) => <option key={y} value={y} disabled={y <= baseYear}>{y}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {cards.map((c, i) => (
          <div
            key={c.label}
            className="flex animate-fade-up flex-col gap-0.5 rounded-lg border px-3 py-2"
            style={{
              animationDelay: `${i * 50}ms`,
              background: `color-mix(in srgb, ${c.accent} 8%, white)`,
              borderColor: `color-mix(in srgb, ${c.accent} 25%, transparent)`,
            }}
          >
            <span className="text-base font-bold tabular-nums text-ink">{c.value}</span>
            <span className="text-xs text-subtle">{c.label}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
