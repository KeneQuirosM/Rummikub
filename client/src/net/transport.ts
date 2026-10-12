import type { Ack, ChatMessage, DragPayload, Intent, PlayerView } from '@rummi/shared';

export type ConnectionStatus = 'connected' | 'reconnecting' | 'offline';

export interface TransportEvents {
  state: (v: PlayerView) => void;
  drag: (d: DragPayload) => void;
  emote: (e: { from: number; emoji: string }) => void;
  chat: (m: ChatMessage) => void;
  status: (s: ConnectionStatus) => void;
  closed: () => void;
}

/** Abstracción común para jugar online (Socket.IO) o en práctica local contra el bot. */
export interface Transport {
  readonly kind: 'online' | 'local';
  /** Último estado recibido (para no perder el primero mientras se monta la escena). */
  readonly lastState: PlayerView | null;
  intent(i: Intent): Promise<Ack>;
  drag(d: DragPayload): void;
  emote(e: string): void;
  chat(text: string): void;
  rematch(): void;
  leave(): void;
  on<K extends keyof TransportEvents>(ev: K, cb: TransportEvents[K]): () => void;
}

export class Emitter<E extends { [K in keyof E]: (...args: never[]) => void }> {
  private map = new Map<keyof E, Set<E[keyof E]>>();
  on<K extends keyof E>(ev: K, cb: E[K]): () => void {
    let s = this.map.get(ev);
    if (!s) this.map.set(ev, (s = new Set()));
    s.add(cb);
    return () => s!.delete(cb);
  }
  emit<K extends keyof E>(ev: K, ...args: Parameters<E[K]>): void {
    this.map.get(ev)?.forEach((cb) => (cb as (...a: Parameters<E[K]>) => void)(...args));
  }
  clear(): void {
    this.map.clear();
  }
}
