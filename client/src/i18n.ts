export type Lang = 'es' | 'en';

const es = {
  'app.title': 'Rummi 3D',
  'app.tagline': 'Fichas, mesa y hasta 4 amigos. Sin instalar nada.',
  'loading': 'Cargando…',
  'menu.playFriend': 'Jugar con amigos',
  'menu.join': 'Unirme con código',
  'menu.practice': 'Práctica vs bot',
  'menu.settings': 'Ajustes',
  'menu.howto': 'Cómo se juega',
  'menu.editProfile': 'Editar perfil',
  'profile.title': 'Tu perfil',
  'profile.name': 'Nombre',
  'profile.avatar': 'Avatar',
  'profile.save': 'Guardar',
  'join.title': 'Unirme a una sala',
  'join.placeholder': 'CÓDIGO',
  'join.go': 'Entrar',
  'common.back': 'Volver',
  'common.close': 'Cerrar',
  'common.cancel': 'Cancelar',
  'common.ok': 'Aceptar',
  'common.retry': 'Reintentar',
  'room.waiting': 'Esperando jugadores…',
  'room.code': 'Código de sala',
  'room.share': 'Compartir por WhatsApp',
  'room.copy': 'Copiar link',
  'room.copied': '¡Link copiado!',
  'room.shareText': '¡Juguemos Rummi 3D! Entra a mi sala {code}: {url}',
  'room.leave': 'Salir',
  'settings.title': 'Ajustes',
  'settings.language': 'Idioma',
  'settings.sound': 'Sonido',
  'settings.vibration': 'Vibración',
  'settings.symbols': 'Símbolos por color (daltonismo)',
  'settings.quality': 'Calidad gráfica',
  'settings.quality.auto': 'Auto',
  'settings.quality.high': 'Alta',
  'settings.quality.medium': 'Media',
  'settings.quality.low': 'Baja',
  'settings.timer': 'Tiempo por turno',
  'settings.timer.off': 'Sin límite',
  'settings.fullscreen': 'Pantalla completa al jugar',
  'settings.tutorial': 'Repetir tutorial',
  'hud.yourTurn': 'Tu turno',
  'hud.theirTurn': 'Turno de {name}',
  'hud.pool': 'Pozo',
  'hud.tiles': 'fichas',
  'hud.opening': 'Apertura {pts}/30',
  'hud.disconnected': 'desconectado',
  'hud.connected': 'conectado',
  'hud.botThinking': 'pensando…',
  'btn.endTurn': 'Terminar',
  'btn.undo': 'Deshacer',
  'btn.draw': 'Robar',
  'btn.sortColor': 'Color',
  'btn.sortNumber': 'Número',
  'btn.recenter': 'Centrar',
  'btn.sound': 'Sonido',
  'btn.chat': 'Chat',
  'btn.emote': 'Reacciones',
  'btn.menu': 'Menú',
  'chat.placeholder': 'Escribe un mensaje…',
  'chat.send': 'Enviar',
  'end.win': '¡Ganaste!',
  'end.lose': 'Perdiste',
  'end.draw': 'Empate',
  'end.reasonOut': '{name} se quedó sin fichas',
  'end.reasonPool': 'Se acabó el pozo: gana quien tiene menos puntos',
  'end.points': 'Puntos en atril',
  'end.rematch': 'Revancha',
  'end.rematchWaiting': 'Esperando al rival…',
  'end.rematchAsked': '{name} quiere revancha',
  'end.menu': 'Menú principal',
  'end.score': 'Marcador',
  'game.leaveConfirm': '¿Salir de la partida?',
  'game.timeout': 'Se acabó el tiempo: robaste una ficha',
  'game.drew': '{name} robó una ficha',
  'game.played': '{name} jugó {n} fichas',
  'game.played1': '{name} jugó 1 ficha',
  'err.NOT_YOUR_TURN': 'No es tu turno',
  'err.GAME_OVER': 'La partida terminó',
  'err.BAD_INTENT': 'Movimiento no permitido',
  'err.TILE_NOT_AVAILABLE': 'Esa ficha no está disponible',
  'err.NOT_OPENED': 'Primero debes abrir (30 puntos) para tocar la mesa',
  'err.CANT_TAKE_FROM_TABLE': 'Las fichas de la mesa no pueden volver al atril',
  'err.MELD_NOT_FOUND': 'Esa combinación ya no existe',
  'err.NOTHING_TO_UNDO': 'Nada que deshacer',
  'err.INVALID_MELDS': 'Hay combinaciones inválidas en la mesa',
  'err.OPENING_TOO_LOW': 'La apertura debe sumar al menos 30 puntos',
  'err.OPENING_TABLE_TOUCHED': 'En la apertura solo puedes usar fichas de tu atril',
  'err.TILES_MISSING': 'Faltan fichas en la mesa',
  'err.ROOM_NOT_FOUND': 'La sala no existe o ya terminó',
  'err.ROOM_FULL': 'La sala está llena',
  'err.BAD_REQUEST': 'Solicitud inválida',
  'err.NOT_IN_ROOM': 'No estás en una sala',
  'err.RATE_LIMITED': 'Demasiadas acciones, espera un momento',
  'err.server': 'No se pudo conectar con el servidor',
  'err.offline': 'Sin conexión a internet',
  'err.reconnecting': 'Reconectando…',
  'err.reconnected': 'Conectado de nuevo',
  'howto.title': 'Cómo se juega',
  'howto.body': `<p><b>Objetivo:</b> quedarte sin fichas antes que tus rivales (de 2 a 4 jugadores).</p>
<p><b>Combinaciones:</b></p>
<ul><li><b>Grupo</b>: 3 o 4 fichas del mismo número y colores distintos.</li>
<li><b>Escalera</b>: 3 o más números seguidos del mismo color. El 13 no conecta con el 1.</li>
<li><b>Comodín</b>: reemplaza cualquier ficha. En tu atril al final vale 30 puntos.</li></ul>
<p><b>Apertura:</b> tu primera jugada debe sumar 30 puntos o más usando solo fichas de tu atril.</p>
<p><b>Después de abrir</b> puedes reorganizar la mesa: dividir, unir, mover y reemplazar comodines. Al terminar tu turno todas las combinaciones deben ser válidas.</p>
<p>Si no puedes (o no quieres) jugar, <b>roba</b> una ficha. Si se acaba el tiempo, tu turno se revierte y robas.</p>
<p>Si se acaba el pozo, gana quien tenga menos puntos en el atril.</p>
<p><b>Controles:</b> arrastra fichas o tócalas y luego toca el destino. Atajos: <kbd>Enter</kbd> terminar, <kbd>Z</kbd> deshacer, <kbd>Espacio</kbd> robar.</p>`,
  'howto.tutorial': 'Tutorial interactivo',
  'tut.skip': 'Saltar',
  'tut.next': 'Siguiente',
  'tut.done': '¡A jugar!',
  'tut.1': '¡Bienvenido! Este es tu <b>atril</b>. Tus fichas están abajo y solo tú las ves.',
  'tut.2': 'Toca <b>Color</b> o <b>Número</b> para ordenar tu atril y encontrar combinaciones.',
  'tut.3': 'Arrastra una ficha a la <b>mesa</b> (o tócala y luego toca la mesa). Suelta otras fichas encima para formar grupos y escaleras.',
  'tut.4': 'Tu primera jugada debe sumar <b>30 puntos</b>. El contador de apertura te ayuda. Las combinaciones válidas brillan; las inválidas se ven rojas.',
  'tut.5': 'Pulsa <b>Terminar</b> para confirmar o <b>Robar</b> si no puedes jugar. <b>Deshacer</b> revierte movimientos del turno.',
  'offline.banner': 'Sin conexión',
  'end.sharedWin': '¡Empate en el primer lugar!',
  'hud.replaced': 'bot',
  'lobby.start': 'Empezar partida ({n}/4)',
  'lobby.waitHost': 'Esperando a que {name} empiece…',
  'lobby.needMore': 'Comparte el link: hace falta al menos 1 jugador más',
  'lobby.canStart': 'Pueden entrar hasta 4. Empieza cuando estén listos',
  'lobby.host': 'anfitrión',
  'lobby.you': 'tú',
  'lobby.empty': 'Lugar libre',
  'practice.title': '¿Contra cuántos bots?',
  'practice.rivals': 'rivales',
  'practice.rival': 'rival',
  'game.replaced': '{name} salió: un bot juega por él',
  'err.GAME_IN_PROGRESS': 'La partida de esa sala ya empezó',
  'err.NOT_HOST': 'Solo el anfitrión puede empezar',
  'err.NOT_ENOUGH_PLAYERS': 'Hacen falta al menos 2 jugadores',
};

type Dict = Record<keyof typeof es, string>;

const en: Dict = {
  'app.title': 'Rummi 3D',
  'app.tagline': 'Tiles, a table and up to 4 friends. Nothing to install.',
  'loading': 'Loading…',
  'menu.playFriend': 'Play with friends',
  'menu.join': 'Join with code',
  'menu.practice': 'Practice vs bot',
  'menu.settings': 'Settings',
  'menu.howto': 'How to play',
  'menu.editProfile': 'Edit profile',
  'profile.title': 'Your profile',
  'profile.name': 'Name',
  'profile.avatar': 'Avatar',
  'profile.save': 'Save',
  'join.title': 'Join a room',
  'join.placeholder': 'CODE',
  'join.go': 'Join',
  'common.back': 'Back',
  'common.close': 'Close',
  'common.cancel': 'Cancel',
  'common.ok': 'OK',
  'common.retry': 'Retry',
  'room.waiting': 'Waiting for players…',
  'room.code': 'Room code',
  'room.share': 'Share on WhatsApp',
  'room.copy': 'Copy link',
  'room.copied': 'Link copied!',
  'room.shareText': "Let's play Rummi 3D! Join my room {code}: {url}",
  'room.leave': 'Leave',
  'settings.title': 'Settings',
  'settings.language': 'Language',
  'settings.sound': 'Sound',
  'settings.vibration': 'Vibration',
  'settings.symbols': 'Color symbols (color blindness)',
  'settings.quality': 'Graphics quality',
  'settings.quality.auto': 'Auto',
  'settings.quality.high': 'High',
  'settings.quality.medium': 'Medium',
  'settings.quality.low': 'Low',
  'settings.timer': 'Turn timer',
  'settings.timer.off': 'No limit',
  'settings.fullscreen': 'Fullscreen while playing',
  'settings.tutorial': 'Replay tutorial',
  'hud.yourTurn': 'Your turn',
  'hud.theirTurn': "{name}'s turn",
  'hud.pool': 'Pool',
  'hud.tiles': 'tiles',
  'hud.opening': 'Opening {pts}/30',
  'hud.disconnected': 'disconnected',
  'hud.connected': 'connected',
  'hud.botThinking': 'thinking…',
  'btn.endTurn': 'End turn',
  'btn.undo': 'Undo',
  'btn.draw': 'Draw',
  'btn.sortColor': 'Color',
  'btn.sortNumber': 'Number',
  'btn.recenter': 'Center',
  'btn.sound': 'Sound',
  'btn.chat': 'Chat',
  'btn.emote': 'Reactions',
  'btn.menu': 'Menu',
  'chat.placeholder': 'Type a message…',
  'chat.send': 'Send',
  'end.win': 'You win!',
  'end.lose': 'You lose',
  'end.draw': 'Draw',
  'end.reasonOut': '{name} ran out of tiles',
  'end.reasonPool': 'The pool ran out: lowest points wins',
  'end.points': 'Points on rack',
  'end.rematch': 'Rematch',
  'end.rematchWaiting': 'Waiting for opponent…',
  'end.rematchAsked': '{name} wants a rematch',
  'end.menu': 'Main menu',
  'end.score': 'Score',
  'game.leaveConfirm': 'Leave the game?',
  'game.timeout': 'Time is up: you drew a tile',
  'game.drew': '{name} drew a tile',
  'game.played': '{name} played {n} tiles',
  'game.played1': '{name} played 1 tile',
  'err.NOT_YOUR_TURN': "It's not your turn",
  'err.GAME_OVER': 'The game is over',
  'err.BAD_INTENT': 'Move not allowed',
  'err.TILE_NOT_AVAILABLE': 'That tile is not available',
  'err.NOT_OPENED': 'You must open (30 points) before touching the table',
  'err.CANT_TAKE_FROM_TABLE': 'Table tiles cannot go back to your rack',
  'err.MELD_NOT_FOUND': 'That set no longer exists',
  'err.NOTHING_TO_UNDO': 'Nothing to undo',
  'err.INVALID_MELDS': 'There are invalid sets on the table',
  'err.OPENING_TOO_LOW': 'Your opening must total at least 30 points',
  'err.OPENING_TABLE_TOUCHED': 'For your opening you can only use tiles from your rack',
  'err.TILES_MISSING': 'Tiles are missing from the table',
  'err.ROOM_NOT_FOUND': "That room doesn't exist or has ended",
  'err.ROOM_FULL': 'The room is full',
  'err.BAD_REQUEST': 'Invalid request',
  'err.NOT_IN_ROOM': 'You are not in a room',
  'err.RATE_LIMITED': 'Too many actions, wait a moment',
  'err.server': 'Could not reach the server',
  'err.offline': 'No internet connection',
  'err.reconnecting': 'Reconnecting…',
  'err.reconnected': 'Back online',
  'howto.title': 'How to play',
  'howto.body': `<p><b>Goal:</b> be the first to get rid of all your tiles (2 to 4 players).</p>
<p><b>Sets:</b></p>
<ul><li><b>Group</b>: 3 or 4 tiles of the same number in different colors.</li>
<li><b>Run</b>: 3 or more consecutive numbers of the same color. 13 does not connect to 1.</li>
<li><b>Joker</b>: replaces any tile. Left on your rack it costs 30 points.</li></ul>
<p><b>Opening:</b> your first play must total 30 points or more using only tiles from your rack.</p>
<p><b>After opening</b> you can rearrange the table: split, join, move tiles and replace jokers. When you end your turn every set must be valid.</p>
<p>If you can't (or don't want to) play, <b>draw</b> a tile. If time runs out your turn is reverted and you draw.</p>
<p>If the pool runs out, the lowest points on the rack wins.</p>
<p><b>Controls:</b> drag tiles, or tap a tile and then tap the destination. Shortcuts: <kbd>Enter</kbd> end turn, <kbd>Z</kbd> undo, <kbd>Space</kbd> draw.</p>`,
  'howto.tutorial': 'Interactive tutorial',
  'tut.skip': 'Skip',
  'tut.next': 'Next',
  'tut.done': "Let's play!",
  'tut.1': 'Welcome! This is your <b>rack</b>. Your tiles are at the bottom and only you can see them.',
  'tut.2': 'Tap <b>Color</b> or <b>Number</b> to sort your rack and spot sets.',
  'tut.3': 'Drag a tile onto the <b>table</b> (or tap it, then tap the table). Drop more tiles on it to build groups and runs.',
  'tut.4': 'Your first play must total <b>30 points</b>. The opening counter helps. Valid sets glow; invalid ones turn red.',
  'tut.5': 'Press <b>End turn</b> to confirm or <b>Draw</b> if you cannot play. <b>Undo</b> reverts moves this turn.',
  'offline.banner': 'Offline',
  'end.sharedWin': 'Tied for first!',
  'hud.replaced': 'bot',
  'lobby.start': 'Start game ({n}/4)',
  'lobby.waitHost': 'Waiting for {name} to start…',
  'lobby.needMore': 'Share the link: at least 1 more player needed',
  'lobby.canStart': 'Up to 4 can join. Start when you are ready',
  'lobby.host': 'host',
  'lobby.you': 'you',
  'lobby.empty': 'Open seat',
  'practice.title': 'How many bots?',
  'practice.rivals': 'opponents',
  'practice.rival': 'opponent',
  'game.replaced': '{name} left: a bot plays for them',
  'err.GAME_IN_PROGRESS': 'That room is already playing',
  'err.NOT_HOST': 'Only the host can start',
  'err.NOT_ENOUGH_PLAYERS': 'At least 2 players are needed',
};

export type I18nKey = keyof typeof es;
const dicts: Record<Lang, Dict> = { es, en };
let current: Lang = 'es';
const listeners = new Set<() => void>();

export function setLang(l: Lang): void {
  current = l;
  document.documentElement.lang = l;
  applyI18n(document.body);
  listeners.forEach((f) => f());
}

export function getLang(): Lang {
  return current;
}

export function onLangChange(f: () => void): () => void {
  listeners.add(f);
  return () => listeners.delete(f);
}

export function t(key: I18nKey | string, vars?: Record<string, string | number>): string {
  let s = (dicts[current] as Record<string, string>)[key] ?? (es as Record<string, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

/** Aplica traducciones a elementos con data-i18n / data-i18n-html / data-i18n-title / data-i18n-ph. */
export function applyI18n(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => (el.textContent = t(el.dataset.i18n!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-html]').forEach((el) => (el.innerHTML = t(el.dataset.i18nHtml!)));
  root.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach((el) => {
    el.title = t(el.dataset.i18nTitle!);
    el.setAttribute('aria-label', el.title);
  });
  root.querySelectorAll<HTMLInputElement>('[data-i18n-ph]').forEach((el) => (el.placeholder = t(el.dataset.i18nPh!)));
}

export function detectLang(): Lang {
  return navigator.language?.toLowerCase().startsWith('es') ? 'es' : navigator.language ? 'en' : 'es';
}
