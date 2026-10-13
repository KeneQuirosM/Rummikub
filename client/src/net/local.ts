import {
  applyIntent,
  botMoveToIntent,
  checkTimeout,
  createGame,
  planBotTurn,
  turnContext,
  viewFor,
  winsNeeded,
  type Ack,
  type BotLevel,
  type MatchInfo,
  type DragPayload,
  type GameState,
  type Intent,
  type PlayerView,
} from '@rummi/shared';
import { Emitter, type Transport, type TransportEvents } from './transport';

const BOTS = [
  { name: 'Robo', avatar: '🤖' },
  { name: 'Fichatron', avatar: '👾' },
  { name: 'Tito Bot', avatar: '🦾' },
  { name: 'Byte', avatar: '🛸' },
];

/**
 * Práctica local: el mismo motor del servidor corriendo en el navegador, contra 1 a 3 bots.
 * El jugador humano siempre es el asiento 0.
 */
export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private em = new Emitter<TransportEvents>();
  private game: GameState;
  private wins: number[];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval>;
  private botBusy = false;
  private bots: { name: string; avatar: string }[];
  private counted = false;
  /** Torneo al mejor de N (práctica). */
  private match: MatchInfo | null = null;
  private gamesPlayed = 1;
  private disposed = false;
  lastState: PlayerView | null = null;

  constructor(
    private profile: { name: string; avatar: string },
    private turnSeconds: number,
    botCount = 1,
    readonly level: BotLevel = 'normal',
    private bestOf = 1,
    seed?: number,
  ) {
    const n = Math.max(1, Math.min(3, botCount));
    const pool = [...BOTS].sort(() => Math.random() - 0.5);
    this.bots = pool.slice(0, n);
    this.wins = new Array<number>(n + 1).fill(0);
    if (this.bestOf > 1) this.match = { bestOf: this.bestOf, game: 1, wins: new Array<number>(n + 1).fill(0), champions: null };
    this.game = this.newGame(0, seed);
    this.tick = setInterval(() => {
      if (checkTimeout(this.game)) this.publish();
    }, 500);
    this.later(() => this.publish(), 0);
  }

  private newGame(first: number, seed?: number): GameState {
    this.counted = false;
    return createGame({ players: this.bots.length + 1, turnSeconds: this.turnSeconds, firstPlayer: first, ...(seed !== undefined ? { seed } : {}) });
  }

  private later(f: () => void, ms: number) {
    const id = setTimeout(() => {
      this.timers.delete(id);
      if (!this.disposed) f();
    }, ms);
    this.timers.add(id);
  }

  private view(): PlayerView {
    return viewFor(this.game, 0, {
      roomCode: 'BOT',
      players: [
        { name: this.profile.name, avatar: this.profile.avatar, connected: true, isBot: false, wins: this.wins[0]! },
        ...this.bots.map((b, i) => ({ ...b, connected: true, isBot: true, wins: this.wins[i + 1]! })),
      ],
      rematch: new Array<boolean>(this.bots.length + 1).fill(false),
      host: 0,
      bestOf: this.bestOf,
      match: this.match ? { ...this.match, wins: [...this.match.wins], champions: this.match.champions ? [...this.match.champions] : null } : null,
    });
  }

  private publish() {
    if (this.disposed) return;
    const g = this.game;
    if (g.status === 'ended' && g.result && !this.counted) {
      this.counted = true;
      for (const w of g.result.winners) {
        this.wins[w] = (this.wins[w] ?? 0) + 1;
        if (this.match) this.match.wins[w] = (this.match.wins[w] ?? 0) + 1;
      }
      const m = this.match;
      if (m && !m.champions) {
        const champs = m.wins.map((w, i) => (w >= winsNeeded(m.bestOf) ? i : -1)).filter((i) => i >= 0);
        if (champs.length) m.champions = champs;
      }
    }
    this.lastState = this.view();
    this.em.emit('state', this.lastState);
    if (g.status === 'playing' && g.turn !== 0 && !this.botBusy) this.runBot();
  }

  /** El bot en turno piensa y juega movimiento a movimiento (se ve la animación). */
  private runBot() {
    this.botBusy = true;
    const g = this.game;
    const seat = g.turn;
    const plan = planBotTurn(turnContext(g), undefined, { level: this.level });
    const steps = [...plan.moves];
    const step = () => {
      if (this.disposed || g !== this.game || g.status !== 'playing' || g.turn !== seat) {
        this.botBusy = false;
        return;
      }
      const m = steps.shift();
      if (m) {
        const intent = botMoveToIntent(m, g.working.table);
        if (intent) applyIntent(g, seat, intent);
        this.lastState = this.view();
        this.em.emit('state', this.lastState);
        this.later(step, 380);
        return;
      }
      const r = applyIntent(g, seat, { type: plan.play ? 'endTurn' : 'draw' });
      if (!r.ok) applyIntent(g, seat, { type: 'draw' });
      this.botBusy = false;
      this.publish();
    };
    this.later(step, 900 + Math.random() * 600);
  }

  async intent(i: Intent): Promise<Ack> {
    const r = applyIntent(this.game, 0, i);
    this.publish();
    return r;
  }

  drag(_d: DragPayload): void {}

  emote(e: string): void {
    this.em.emit('emote', { from: 0, emoji: e });
    // Los bots contestan con un emoji o una frase rápida
    const replies = ['😎', '🤔', '👍', '😂', 'phrase:beat', 'phrase:luck', 'phrase:lol', 'phrase:gg'];
    const who = 1 + Math.floor(Math.random() * this.bots.length);
    this.later(() => this.em.emit('emote', { from: who, emoji: replies[Math.floor(Math.random() * replies.length)]! }), 1200);
  }

  chat(text: string): void {
    this.em.emit('chat', { from: 0, text, at: Date.now() });
    this.later(() => this.em.emit('chat', { from: 1, text: '🤖 beep boop', at: Date.now() }), 1000);
  }

  rematch(): void {
    // Torneo: siguiente partida, o uno nuevo si ya hubo campeón
    if (this.match) {
      if (this.match.champions) this.match = { bestOf: this.bestOf, game: 1, wins: this.match.wins.map(() => 0), champions: null };
      else this.match.game++;
    }
    // Alterna quién empieza
    this.game = this.newGame(this.gamesPlayed++ % (this.bots.length + 1));
    this.botBusy = false;
    this.publish();
  }

  leave(): void {
    this.disposed = true;
    clearInterval(this.tick);
    this.timers.forEach(clearTimeout);
    this.timers.clear();
    this.em.clear();
  }

  on<K extends keyof TransportEvents>(ev: K, cb: TransportEvents[K]): () => void {
    return this.em.on(ev, cb);
  }
}
