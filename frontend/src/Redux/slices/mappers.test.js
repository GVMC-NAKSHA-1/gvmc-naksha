import { mapAPIToUI as mapProperty } from './propertiesSlice';
import { mapAPIToUI as mapWard } from './wardsSlice';
import { bandFor, confidenceFromBreakdown, mapAPIToUI as mapMatch, mapMapping } from './harmonizationSlice';
import { mapAPIToUI as mapSource } from './sourcesSlice';
import { mapAPIToUI as mapConflict } from './conflictsSlice';
import { mapAPIToUI as mapRecord } from './harmonizedSlice';

describe('API → UI mappers', () => {
  it('maps a backend ward with flat bbox columns', () => {
    const w = mapWard({ id: 3, name: 'Maddilapalem', bbox_north: '17.74', bbox_south: '17.72', bbox_east: '83.33', bbox_west: '83.31', detection_count: 6 });
    expect(w).toMatchObject({ id: '3', detectionCount: 6, bbox: { north: 17.74, south: 17.72, east: 83.33, west: 83.31 } });
  });

  it('maps a detection and falls back to the breakdown for NDBI Δ', () => {
    const p = mapProperty({ id: 'x', ward_id: 1, lat: '17.7', lng: '83.3', area_sqm: '120.5', confidence: '0.82', confidence_breakdown: { ndbi_delta: 0.21 } });
    expect(p).toMatchObject({ id: 'x', wardId: '1', lat: 17.7, lng: 83.3, areaSqm: 120.5, confidence: 0.82, ndbiDelta: 0.21, status: 'pending' });
  });

  it('recomputes the worker confidence formula from the breakdown', () => {
    const b = { geometric_match_score: 0.9, attribute_match_score: 0.5, source_reliability_weight: 0.875, recency_score: 1 };
    expect(confidenceFromBreakdown(b, 0)).toBe(79); // 0.36 + 0.15 + 0.175 + 0.1
    expect(confidenceFromBreakdown({}, 42)).toBe(42);
  });

  it('bands matches by geometric match score', () => {
    expect(bandFor(96)).toBe('auto_accept');
    expect(bandFor(70)).toBe('review');
    expect(bandFor(30)).toBe('conflict');
    expect(mapMatch({ id: 'm', match_score: '91.2', feature_a_id: 'a', feature_b_id: 'b' }))
      .toMatchObject({ matchScore: 91.2, band: 'auto_accept', featureAId: 'a', featureBId: 'b' });
  });

  it('maps sources with their schema and OCR fields', () => {
    expect(mapSource({ id: 's', type: 'revenue', original_name: 'a.pdf', r2_key: 'k', metadata: { fields: ['x'], feature_count: 3, ocr: { khata_no: '1' } } }))
      .toMatchObject({ filename: 'a.pdf', s3Key: 'k', fields: ['x'], featureCount: 3, ocr: { khata_no: '1' } });
  });

  it('maps conflicts, mappings and golden records', () => {
    expect(mapConflict({ id: 1, conflict_type: 'both', detail: { disagreeing_fields: ['owner_name'], iou: 0.2 } }))
      .toMatchObject({ id: '1', disagreeingFields: ['owner_name'], iou: 0.2, status: 'pending' });
    expect(mapMapping({ field_a: 'khata_no', field_b: 'khata_number', confidence: '0.9' })).toMatchObject({ fieldA: 'khata_no', fieldB: 'khata_number', confidence: 0.9 });
    expect(mapRecord({ id: 'h', confidence: '0.87', member_count: 4, attribute_provenance: { owner_name: 'cadastral' } }))
      .toMatchObject({ confidence: 0.87, memberCount: 4, provenance: { owner_name: 'cadastral' } });
  });
});
