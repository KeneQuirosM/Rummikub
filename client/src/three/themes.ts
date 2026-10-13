/**
 * Temas de mesa y de dorso de fichas. Algunos se desbloquean con victorias (estadísticas locales).
 */
export interface TableTheme {
  id: string;
  /** Color base del fieltro (RGB 0-255) y color de las fibras. */
  felt: [number, number, number];
  fiber: string;
  /** Superficie de madera en vez de fieltro. */
  wood?: boolean;
  /** Halo de luz sobre la mesa. */
  glow: string;
  hemi: number;
  key: number;
  background: number;
  /** Swatch para la interfaz. */
  swatch: string;
  unlockWins: number;
}

export interface BackTheme {
  id: string;
  from: string;
  to: string;
  accent: string;
  pattern: 'diamond' | 'star' | 'crown' | 'stars';
  swatch: string;
  unlockWins: number;
}

export const TABLE_THEMES: TableTheme[] = [
  { id: 'green', felt: [22, 82, 66], fiber: '#9fd9c0', glow: 'rgba(255,220,150,0.22)', hemi: 1.1, key: 2.0, background: 0x07090a, swatch: '#1d5a49', unlockWins: 0 },
  { id: 'blue', felt: [20, 56, 96], fiber: '#9cc4ff', glow: 'rgba(200,225,255,0.2)', hemi: 1.1, key: 2.0, background: 0x06080c, swatch: '#1c3f6b', unlockWins: 0 },
  { id: 'red', felt: [102, 22, 30], fiber: '#ffb3a6', glow: 'rgba(255,210,160,0.22)', hemi: 1.15, key: 2.0, background: 0x0b0607, swatch: '#6e1a22', unlockWins: 3 },
  { id: 'wood', felt: [120, 76, 44], fiber: '#e8c9a0', wood: true, glow: 'rgba(255,225,170,0.18)', hemi: 1.05, key: 1.9, background: 0x0a0806, swatch: '#7a4c2c', unlockWins: 6 },
  { id: 'night', felt: [30, 32, 62], fiber: '#a59cff', glow: 'rgba(170,160,255,0.2)', hemi: 0.75, key: 1.5, background: 0x040409, swatch: '#1a1c33', unlockWins: 10 },
];

export const BACK_THEMES: BackTheme[] = [
  { id: 'classic', from: '#173b33', to: '#0d241f', accent: 'rgba(230,190,100,0.9)', pattern: 'diamond', swatch: '#173b33', unlockWins: 0 },
  { id: 'ruby', from: '#5a1420', to: '#2a070d', accent: 'rgba(240,200,120,0.9)', pattern: 'diamond', swatch: '#5a1420', unlockWins: 0 },
  { id: 'royal', from: '#1b2a5e', to: '#0b1230', accent: 'rgba(220,226,240,0.92)', pattern: 'star', swatch: '#1b2a5e', unlockWins: 2 },
  { id: 'gold', from: '#d8b25a', to: '#8f6a1f', accent: 'rgba(40,28,8,0.85)', pattern: 'crown', swatch: '#c9a04a', unlockWins: 5 },
  { id: 'galaxy', from: '#2b1150', to: '#07030f', accent: 'rgba(255,255,255,0.9)', pattern: 'stars', swatch: '#2b1150', unlockWins: 12 },
];

export function tableTheme(id: string): TableTheme {
  return TABLE_THEMES.find((t) => t.id === id) ?? TABLE_THEMES[0]!;
}

export function backTheme(id: string): BackTheme {
  return BACK_THEMES.find((t) => t.id === id) ?? BACK_THEMES[0]!;
}
