export const COMPARISON_YEARS = [2022, 2024, 2026];

const BY_RANGE = {
  '2022-2024': { newStructures: 24, changeOfUse: 9,  builtUpAreaIncreaseSqm: 6840,  estimatedAssessableAreaSqm: 4920, avgNdbiChange: 0.15, estimatedTaxImpactInr: 612000 },
  '2022-2026': { newStructures: 47, changeOfUse: 18, builtUpAreaIncreaseSqm: 12480, estimatedAssessableAreaSqm: 8960, avgNdbiChange: 0.24, estimatedTaxImpactInr: 1284000 },
  '2024-2026': { newStructures: 23, changeOfUse: 11, builtUpAreaIncreaseSqm: 5640,  estimatedAssessableAreaSqm: 4040, avgNdbiChange: 0.13, estimatedTaxImpactInr: 672000 },
};

export function getComparisonStats(baseYear, compareYear) {
  return BY_RANGE[`${baseYear}-${compareYear}`] ?? BY_RANGE['2022-2024'];
}

/** Sample per-year timelines (not rendered at present). */
export const COMPARISON_PROPERTIES = [
  { id: 'GVMC-014-0231', ward: 'Seethammadhara', timeline: { 2022: 'vacant', 2024: 'foundation', 2026: 'G+2 residential' } },
  { id: 'GVMC-022-0118', ward: 'Gopalapatnam', timeline: { 2022: 'residential', 2024: 'residential', 2026: 'commercial (ground floor)' } },
  { id: 'GVMC-031-0452', ward: 'Maddilapalem', timeline: { 2022: 'G+1', 2024: 'G+2', 2026: 'G+3' } },
  { id: 'GVMC-041-0077', ward: 'Asilmetta', timeline: { 2022: 'vacant', 2024: 'vacant', 2026: 'warehouse' } },
  { id: 'GVMC-052-0309', ward: 'Dwaraka Nagar', timeline: { 2022: 'residential', 2024: 'mixed use', 2026: 'mixed use' } },
];
