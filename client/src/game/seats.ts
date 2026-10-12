import type { PlayerView } from '@rummi/shared';

export type SeatSide = 'left' | 'top' | 'right';

export interface OpponentSeat {
  seat: number;
  side: SeatSide;
}

/**
 * Posición de cada rival alrededor de la mesa, vista desde mi asiento (yo siempre abajo).
 * El turno avanza en sentido horario: el siguiente se sienta a mi izquierda, luego enfrente, luego a la derecha.
 *   2 jugadores: enfrente · 3: izquierda y derecha · 4: izquierda, enfrente y derecha.
 */
export function opponentSeats(view: Pick<PlayerView, 'players' | 'you'>): OpponentSeat[] {
  const n = view.players.length;
  const sides: SeatSide[] = n <= 2 ? ['top'] : n === 3 ? ['left', 'right'] : ['left', 'top', 'right'];
  const out: OpponentSeat[] = [];
  for (let k = 1; k < n; k++) out.push({ seat: (view.you + k) % n, side: sides[k - 1]! });
  return out;
}

/** Orden visual en el HUD: izquierda, enfrente, derecha (igual que en la mesa). */
export function opponentsForHud(view: Pick<PlayerView, 'players' | 'you'>): OpponentSeat[] {
  const order: Record<SeatSide, number> = { left: 0, top: 1, right: 2 };
  return opponentSeats(view).sort((a, b) => order[a.side] - order[b.side]);
}
