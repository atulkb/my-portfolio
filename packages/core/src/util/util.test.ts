import { canonicalJson, fnv1a, hashInput } from './hash';
import { mean, pctChange, round, roundOrNull, sampleStdev } from './numbers';
import { editDistance, normaliseCompanyName, similarity, utf8Length, wordCount } from './text';

describe('hash', () => {
  it('serialises canonically regardless of key order', () => {
    expect(canonicalJson({ b: 1, a: [2, { d: null, c: 'x' }], u: undefined })).toBe(
      '{"a":[2,{"c":"x","d":null}],"b":1}',
    );
    expect(hashInput({ x: 1, y: 2 })).toBe(hashInput({ y: 2, x: 1 }));
  });

  it('produces stable 8-hex FNV-1a hashes that change with input', () => {
    expect(fnv1a('')).toBe('811c9dc5');
    expect(fnv1a('a')).toBe('e40c292c');
    expect(hashInput({ pnlPct: 12.3 })).not.toBe(hashInput({ pnlPct: 12.4 }));
    expect(hashInput(undefined)).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('numbers', () => {
  it('rounds half away from zero', () => {
    expect(round(1.005, 2)).toBeCloseTo(1.01, 9);
    expect(round(-2.5, 0)).toBe(-3);
    expect(roundOrNull(null)).toBeNull();
  });

  it('computes mean, stdev and pct change with null for degenerate input', () => {
    expect(mean([])).toBeNull();
    expect(sampleStdev([1])).toBeNull();
    expect(sampleStdev([2, 4, 4, 4, 5, 5, 7, 9]) as number).toBeCloseTo(2.13809, 4);
    expect(pctChange(0, 5)).toBeNull();
    expect(pctChange(100, 110) as number).toBeCloseTo(10, 9);
  });
});

describe('text', () => {
  it('computes edit distance with transpositions and early exit', () => {
    expect(editDistance('INFY', 'INFY')).toBe(0);
    expect(editDistance('INFY', 'IFNY')).toBe(1);
    expect(editDistance('RELIANCE', 'RELIANC')).toBe(1);
    expect(editDistance('ABC', 'XYZWVU', 2)).toBe(3);
    expect(similarity('', '')).toBe(1);
  });

  it('normalises company names and counts words and bytes', () => {
    expect(normaliseCompanyName('The Reliance Industries Ltd.')).toBe('reliance industries');
    expect(normaliseCompanyName('M&M Limited')).toBe('m and m');
    expect(wordCount('  ')).toBe(0);
    expect(wordCount('a b  c')).toBe(3);
    expect(utf8Length('a₹😀')).toBe(1 + 3 + 4);
  });
});
