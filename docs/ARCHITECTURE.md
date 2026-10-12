# Arquitectura

## Estructura

```
/shared   Motor de reglas puro (sin dependencias), compartido por cliente y servidor
  src/tiles.ts     Fichas (ids 0..105), PRNG con semilla, ordenamientos, puntos
  src/melds.ts     analyzeMeld / validateMelds / arrangeMeld (grupos, escaleras, comodines)
  src/rules.ts     applyMove (movimiento de ficha), canOpen, applyTurn (validación de fin de turno), scoring
  src/game.ts      Máquina de estados de la partida: createGame, applyIntent, checkTimeout, viewFor
  src/bot.ts       IA de práctica (backtracking + extensiones + comodines + préstamos)
  src/protocol.ts  Tipos del protocolo cliente-servidor
/server   Node + Socket.IO: salas, tokens de sesión, temporizador, reconexión, anti-trampa
/client   Vite + Three.js + GSAP. HUD/menús en HTML/CSS. PWA
  src/net/         Transportes: SocketTransport (online) y LocalTransport (práctica con bot)
  src/three/       Escena, mesa, fichas instanciadas, atril, interacción, efectos
  src/ui/          Menús, HUD, ajustes, tutorial, i18n
/e2e      Playwright (dos navegadores, sala, turno, sincronización)
```

## Modelo de estado

```ts
GameState {
  numPlayers: 2..4
  pool: TileId[]                 // orden del pozo: solo en el servidor
  racks: TileId[][]              // atriles confirmados, uno por asiento
  table: Meld[]                  // mesa confirmada (inicio del turno)
  opened: bool[]
  turn, status, turnDeadline, turnSeconds
  working: { rack, table }       // edición del turno en curso (pública salvo el atril)
  history: Snapshot[]            // deshacer ilimitado dentro del turno
  nextMeldSeq, result, lastEvent, version
}
Meld { id: string, tiles: TileId[] }
```

Cada movimiento se aplica con `applyMove` (función pura) sobre `working`; al terminar el turno `applyTurn`
revalida todo desde cero (conservación de fichas, nada vuelve de la mesa al atril, combinaciones válidas,
apertura >= 30 con mesa intacta). Rollback = restaurar `racks[turn]` + `table`.

## Protocolo (Socket.IO)

Cliente → servidor (todas con *ack* `{ok}|{ok:false,error}`):

| Evento | Payload |
|---|---|
| `room:create` | `{name, avatar, settings:{turnSeconds}}` → `{code, token, seat}` |
| `room:join` | `{code, name, avatar, token?}` → `{code, token, seat}` (con token = reconexión). Errores: `ROOM_NOT_FOUND`, `ROOM_FULL` (4), `GAME_IN_PROGRESS` |
| `room:start` | — (anfitrión, 2–4 jugadores) → `{ok}` o `NOT_HOST` / `NOT_ENOUGH_PLAYERS` |
| `game:intent` | `{type:'move', tileId, to:{kind:'rack'|'new'|'meld', meldId?, index?}}`, `undo`, `reset`, `draw`, `endTurn` |
| `game:rematch` | — |
| `drag` | `{tileId|null, x, z, active}` (volátil, ~20 Hz) |
| `emote` / `chat` | emoji / texto |

Servidor → cliente: `state` (PlayerView filtrada), `drag` (fantasma del jugador en turno, a todos los demás), `emote`, `chat`, `room:closed`.

`PlayerView.players` tiene 2–4 entradas por asiento (`you`, `turn` y `host` son índices). `result.winners` es una lista
(empates con el pozo agotado) y `result.points` tiene los puntos de cada asiento. Un asiento con `replaced: true`
abandonó y lo juega el bot del servidor. Los asientos se identifican por token (pueden reordenarse en una revancha).

`PlayerView` nunca contiene el atril rival (solo `rackCount`) ni el pozo (solo `poolCount`). El fantasma de
arrastre solo incluye el id de la ficha si ésta ya es pública (está en la mesa).

## Predicción en el cliente

El cliente aplica el mismo `applyIntent` sobre una copia local para respuesta instantánea y envía la intención.
Mientras haya intenciones sin *ack*, los `state` entrantes se guardan; al recibir el último *ack* se aplica el
estado autoritativo (si el servidor rechazó algo, la vista vuelve sola al estado correcto).
Los ids de combinaciones nuevas son deterministas (`nextMeldSeq` viaja en la vista) para que la predicción
coincida con el servidor.
