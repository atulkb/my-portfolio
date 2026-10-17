import { resolveScheme } from './theme';
import { labelColorsFor, palettes } from './tokens';

/** WCAG 2.x relative luminance of `#RRGGBB`. */
function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

describe('palettes', () => {
  it('have the same colour roles', () => {
    expect(Object.keys(palettes.light).sort()).toEqual(Object.keys(palettes.dark).sort());
  });

  it.each([
    'textPrimary',
    'textSecondary',
    'textMuted',
    'gain',
    'loss',
    'caution',
    'info',
    'unrated',
  ] as const)('light %s meets WCAG AA on canvas and both surfaces', (role) => {
    const c = palettes.light;
    for (const bg of [c.canvas, c.surface1, c.surface2])
      expect(contrast(c[role], bg)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps button text readable on the primary colour', () => {
    for (const c of [palettes.light, palettes.dark])
      expect(contrast(c.onGain, c.gain)).toBeGreaterThanOrEqual(4.5);
  });

  it('derives badge colours from the palette', () => {
    expect(labelColorsFor(palettes.light).BAD).toEqual({
      fg: palettes.light.loss,
      bg: palettes.light.lossTint,
    });
  });
});

describe('resolveScheme', () => {
  it('uses a forced choice regardless of the phone', () => {
    expect(resolveScheme('light', 'dark')).toBe('light');
    expect(resolveScheme('dark', 'light')).toBe('dark');
  });

  it('follows the phone on system, dark when unknown', () => {
    expect(resolveScheme('system', 'light')).toBe('light');
    expect(resolveScheme('system', 'dark')).toBe('dark');
    expect(resolveScheme('system', 'unspecified')).toBe('dark');
    expect(resolveScheme('system', null)).toBe('dark');
  });
});
