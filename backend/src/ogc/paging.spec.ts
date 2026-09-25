import { pageLinks, parseBbox, parsePaging } from './paging';

describe('OGC paging', () => {
  it('clamps limit and offset', () => {
    expect(parsePaging(undefined, undefined)).toEqual({ limit: 100, offset: 0 });
    expect(parsePaging('5000', '-3')).toEqual({ limit: 1000, offset: 0 });
    expect(parsePaging('10', '20')).toEqual({ limit: 10, offset: 20 });
  });

  it('parses bbox and rejects malformed values', () => {
    expect(parseBbox('83.1,17.6,83.3,17.8')).toEqual([83.1, 17.6, 83.3, 17.8]);
    expect(parseBbox(undefined)).toBeNull();
    expect(() => parseBbox('1,2,3')).toThrow();
    expect(() => parseBbox('5,5,1,1')).toThrow();
  });

  it('adds next / prev links only when there are more pages', () => {
    const rels = (m: number, o: number) => pageLinks('http://h/items', { bbox: undefined }, 10, o, m).map((l) => l.rel);
    expect(rels(25, 0)).toEqual(['self', 'next']);
    expect(rels(25, 10)).toEqual(['self', 'next', 'prev']);
    expect(rels(25, 20)).toEqual(['self', 'prev']);
    expect(pageLinks('http://h/items', { wardId: '4' }, 10, 10, 25)[1].href).toBe('http://h/items?wardId=4&limit=10&offset=20');
  });
});
