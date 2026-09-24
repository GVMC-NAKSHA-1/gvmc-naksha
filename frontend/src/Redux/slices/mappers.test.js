import { mapAPIToUI as mapProperty } from './propertiesSlice';
import { mapAPIToUI as mapWard } from './wardsSlice';
import { mapAPIToUI as mapTicket, mapUIToAPI as ticketToAPI } from './ticketsSlice';
import { bandFor, mapAPIToUI as mapMatch } from './harmonizationSlice';
import { mapAPIToUI as mapSource } from './sourcesSlice';

describe('API → UI mappers', () => {
  it('maps a backend ward with flat bbox columns', () => {
    const w = mapWard({ id: 3, name: 'Maddilapalem', bbox_north: '17.74', bbox_south: '17.72', bbox_east: '83.33', bbox_west: '83.31', detection_count: 6 });
    expect(w).toMatchObject({ id: '3', detectionCount: 6, bbox: { north: 17.74, south: 17.72, east: 83.33, west: 83.31 } });
  });

  it('maps a property and falls back to the breakdown for NDBI Δ', () => {
    const p = mapProperty({ id: 'x', ward_id: 1, lat: '17.7', lng: '83.3', area_sqm: '120.5', confidence: '0.82', confidence_breakdown: { ndbi_delta: 0.21 } });
    expect(p).toMatchObject({ id: 'x', wardId: '1', lat: 17.7, lng: 83.3, areaSqm: 120.5, confidence: 0.82, ndbiDelta: 0.21, status: 'pending' });
  });

  it('maps tickets both ways using the backend camelCase DTO', () => {
    expect(mapTicket({ id: 't1', ward_id: '2', house_number: '1-2', photo_r2_key: 'k', tax_pending: '500' }))
      .toMatchObject({ id: 't1', wardId: '2', houseNumber: '1-2', photoS3Key: 'k', taxPending: 500, status: 'open' });
    expect(ticketToAPI({ wardId: 2, houseNumber: 'A', description: 'd', taxPending: '', photoS3Key: null }))
      .toEqual({ wardId: '2', houseNumber: 'A', description: 'd' });
  });

  it('derives a match band from the score when the backend omits it', () => {
    expect(bandFor(96)).toBe('auto_accept');
    expect(bandFor(70)).toBe('review');
    expect(bandFor(30)).toBe('conflict');
    expect(mapMatch({ id: 'm', match_score: '74.2' })).toMatchObject({ matchScore: 74.2, confidenceScore: 74.2, band: 'review' });
  });

  it('uses original_name as the source filename', () => {
    expect(mapSource({ id: 's', type: 'cadastral', original_name: 'a.geojson', r2_key: 'sources/x' }))
      .toMatchObject({ filename: 'a.geojson', s3Key: 'sources/x' });
  });
});
