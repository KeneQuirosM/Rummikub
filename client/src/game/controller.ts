import {
  analyzeMeld,
  applyMove,
  compareByColor,
  compareByNumber,
  openingPoints,
  type GameErrorCode,
  type GameEvent,
  type Intent,
  type MoveTarget,
  type PlayerView,
  type RoomErrorCode,
  type TileId,
  type TurnContext,
} from '@rummi/shared';
import { Emitter, type Transport } from '../net/transport';

export interface ControllerEvents {
  change: (view: PlayerView, prev: PlayerView | null) => void;
  error: (code: GameErrorCode | RoomErrorCode) => void;
  gameEvent: (e: GameEvent, view: PlayerView) => void;
}

function turnCtx(v: PlayerView): TurnContext {
  return {
    start: { rack: [...v.rack, ...v.playedThisTurn], table: [{ id: '__start', tiles: v.turnStartTable }] },
    opened: v.players[v.you].opened,
  };
}

/** Predicción local de un movimiento con el mismo motor que el servidor. */
export function predictMove(v: PlayerView, tileId: TileId, to: MoveTarget): PlayerView | null {
  let seq = v.nextMeldSeq;
  const r = applyMove(turnCtx(v), { rack: v.rack, table: v.table }, tileId, to, () => `m${seq++}`);
  if (!r.ok) return null;
  const startRack = [...v.rack, ...v.playedThisTurn];
  const rackSet = new Set(r.snapshot.rack);
  return {
    ...v,
    rack: r.snapshot.rack,
    table: r.snapshot.table,
    playedThisTurn: startRack.filter((t) => !rackSet.has(t)),
    nextMeldSeq: seq,
    canUndo: true,
    players: v.players.map((p, i) => (i === v.you ? { ...p, rackCount: r.snapshot.rack.length } : p)) as PlayerView['players'],
  };
}

/**
 * Mantiene la vista (con predicción optimista), el orden del atril y traduce acciones a intenciones.
 */
export class GameController {
  readonly em = new Emitter<ControllerEvents>();
  view: PlayerView | null = null;
  private latestServer: PlayerView | null = null;
  private pending = 0;
  rackOrder: TileId[] = [];
  private lastEventSeq = -1;
  private offs: (() => void)[] = [];

  constructor(public readonly transport: Transport) {
    this.offs.push(
      transport.on('state', (v) => this.receive(v)),
      transport.on('status', (s) => {
        if (s !== 'connected') this.pending = 0;
      }),
    );
  }

  get isMyTurn(): boolean {
    return !!this.view && this.view.status === 'playing' && this.view.turn === this.view.you;
  }

  get opened(): boolean {
    return !!this.view && this.view.players[this.view.you].opened;
  }

  openingPoints(): number {
    if (!this.view) return 0;
    return openingPoints(turnCtx(this.view), { rack: this.view.rack, table: this.view.table });
  }

  invalidMeldIds(): Set<string> {
    const s = new Set<string>();
    for (const m of this.view?.table ?? []) if (!analyzeMeld(m.tiles).valid) s.add(m.id);
    return s;
  }

  /** Estado autoritativo recibido del servidor (o del motor local). */
  receive(v: PlayerView) {
    this.latestServer = v;
    if (this.pending > 0) return;
    this.apply(v);
  }

  private apply(v: PlayerView) {
    const prev = this.view;
    this.view = v;
    this.syncRackOrder(v.rack);
    this.em.emit('change', v, prev);
    if (v.lastEvent && v.lastEvent.seq !== this.lastEventSeq) {
      const first = this.lastEventSeq === -1;
      this.lastEventSeq = v.lastEvent.seq;
      if (!first || v.lastEvent.type === 'start') this.em.emit('gameEvent', v.lastEvent, v);
    }
  }

  private syncRackOrder(rack: TileId[], insertAt?: { tile: TileId; index: number }) {
    const set = new Set(rack);
    const order = this.rackOrder.filter((t) => set.has(t));
    const known = new Set(order);
    for (const t of rack) if (!known.has(t)) order.push(t);
    if (insertAt && set.has(insertAt.tile)) {
      const i = order.indexOf(insertAt.tile);
      order.splice(i, 1);
      order.splice(Math.max(0, Math.min(order.length, insertAt.index)), 0, insertAt.tile);
    }
    this.rackOrder = order;
  }

  private async send(i: Intent): Promise<boolean> {
    this.pending++;
    let ok = false;
    try {
      const r = await this.transport.intent(i);
      ok = r.ok;
      if (!r.ok) this.em.emit('error', r.error);
    } catch {
      ok = false;
    } finally {
      this.pending = Math.max(0, this.pending - 1);
      if (this.pending === 0 && this.latestServer && this.latestServer !== this.view) this.apply(this.latestServer);
    }
    return ok;
  }

  /** Mueve una ficha (predicción inmediata + intención al servidor). */
  move(tileId: TileId, to: MoveTarget, rackIndex?: number): boolean {
    const v = this.view;
    if (!v) return false;
    // Reordenar dentro del atril: solo local
    if (to.kind === 'rack' && v.rack.includes(tileId)) {
      this.reorderRack(tileId, rackIndex ?? this.rackOrder.length);
      return true;
    }
    if (!this.isMyTurn) {
      this.em.emit('error', 'NOT_YOUR_TURN');
      return false;
    }
    const next = predictMove(v, tileId, to);
    if (!next) {
      // Dejar que el servidor diga por qué (y mostrar el error); localmente no cambia nada
      void this.send({ type: 'move', tileId, to });
      return false;
    }
    const prev = this.view;
    this.view = next;
    this.syncRackOrder(next.rack, rackIndex !== undefined ? { tile: tileId, index: rackIndex } : undefined);
    this.em.emit('change', next, prev);
    void this.send({ type: 'move', tileId, to });
    return true;
  }

  reorderRack(tileId: TileId, index: number) {
    const v = this.view;
    if (!v) return;
    this.syncRackOrder(v.rack, { tile: tileId, index });
    this.em.emit('change', v, v);
  }

  sort(mode: 'color' | 'number') {
    const v = this.view;
    if (!v) return;
    this.rackOrder = [...v.rack].sort(mode === 'color' ? compareByColor : compareByNumber);
    this.em.emit('change', v, v);
  }

  undo() {
    if (!this.isMyTurn || !this.view?.canUndo) return;
    void this.send({ type: 'undo' });
  }
  reset() {
    if (!this.isMyTurn) return;
    void this.send({ type: 'reset' });
  }
  draw() {
    if (!this.isMyTurn) return;
    void this.send({ type: 'draw' });
  }
  endTurn() {
    if (!this.isMyTurn) return;
    void this.send({ type: 'endTurn' });
  }

  dispose() {
    this.offs.forEach((f) => f());
    this.em.clear();
  }
}
