import {
  applyIntent,
  botMoveToIntent,
  checkTimeout,
  createGame,
  planBotTurn,
  turnContext,
  viewFor,
  type Ack,
  type DragPayload,
  type GameState,
  type Intent,
  type PlayerView,
} from '@rummi/shared';
import { Emitter, type Transport, type TransportEvents } from './transport';

const BOT_NAMES = ['Robo', 'Tito Bot', 'Fichatron'];

/**
 * Práctica local: el mismo motor del servidor corriendo en el navegador, con el bot como rival.
 */
export class LocalTransport implements Transport {
  readonly kind = 'local' as const;
  private em = new Emitter<TransportEvents>();
  private game: GameState;
  private wins: [number, number] = [0, 0];
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private tick: ReturnType<typeof setInterval>;
  private botBusy = false;
  private botName = BOT_NAMES[Math.floor(Math.random() * BOT_NAMES.length)]!;
  private disposed = false;
  lastState: PlayerView | null = null;

  constructor(private profile: { name: string; avatar: string }, private turnSeconds: number, seed?: number) {
    this.game = createGame({ turnSeconds, firstPlayer: 0, ...(seed !== undefined ? { seed } : {}) });
    this.tick = setInterval(() => {
      if (checkTimeout(this.game)) this.publish();
    }, 500);
    this.later(() => this.publish(), 0);
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
        { name: this.profile.name, avatar: this.profile.avatar, connected: true, isBot: false, wins: this.wins[0] },
        { name: this.botName, avatar: '🤖', connected: true, isBot: true, wins: this.wins[1] },
      ],
      rematch: [false, false],
    });
  }

  private publish() {
    if (this.disposed) return;
    this.lastState = this.view();
    if (this.game.status === 'ended' && this.game.result && !(this.game as { counted?: boolean }).counted) {
      (this.game as { counted?: boolean }).counted = true;
      if (this.game.result.winner !== null) this.wins[this.game.result.winner]++;
    }
    this.em.emit('state', this.view());
    if (this.game.status === 'playing' && this.game.turn === 1 && !this.botBusy) this.runBot();
  }

  private runBot() {
    this.botBusy = true;
    const g = this.game;
    const plan = planBotTurn(turnContext(g));
    const steps = [...plan.moves];
    const step = () => {
      if (this.disposed || g !== this.game || g.status !== 'playing' || g.turn !== 1) {
        this.botBusy = false;
        return;
      }
      const m = steps.shift();
      if (m) {
        const intent = botMoveToIntent(m, g.working.table);
        if (intent) applyIntent(g, 1, intent);
        this.em.emit('state', this.view());
        this.later(step, 380);
        return;
      }
      applyIntent(g, 1, { type: plan.play ? 'endTurn' : 'draw' });
      this.botBusy = false;
      this.publish();
    };
    this.later(step, 900 + Math.random() * 600);
  }

  async intent(i: Intent): Promise<Ack> {
    const r = applyIntent(this.game, 0, i);
    // Publicar en el siguiente microtask para imitar el orden red: state y luego ack
    this.publish();
    return r;
  }

  drag(_d: DragPayload): void {}

  emote(e: string): void {
    this.em.emit('emote', { from: 0, emoji: e });
    const replies = ['😎', '🤔', '👍', '😂'];
    this.later(() => this.em.emit('emote', { from: 1, emoji: replies[Math.floor(Math.random() * replies.length)]! }), 1200);
  }

  chat(text: string): void {
    this.em.emit('chat', { from: 0, text, at: Date.now() });
    this.later(() => this.em.emit('chat', { from: 1, text: '🤖 beep boop', at: Date.now() }), 1000);
  }

  rematch(): void {
    this.game = createGame({ turnSeconds: this.turnSeconds, firstPlayer: (this.wins[0] + this.wins[1]) % 2 === 0 ? 0 : 1 });
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
