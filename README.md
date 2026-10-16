# Rummi 3D 🀄

Rummy de fichas (estilo Rummikub) en **3D** para jugar **de 2 a 4 jugadores** desde el celular o la computadora.
Creas una sala, compartes el link por WhatsApp y tus amigos entran con un toque; el anfitrión toca **Empezar**
(con 4 jugadores la partida empieza sola). Sin registro y sin instalar nada
(aunque se puede "instalar" como PWA).

- Mesa de fieltro con borde de madera, fichas biseladas con numeral grabado, sombras de contacto, animaciones GSAP y sonido sintetizado.
- Motor de reglas **100 % en el servidor**, compartido con el cliente para predicción instantánea.
- Modo práctica contra **1 a 3 bots** en tres niveles (Fácil / Normal / Difícil) que funciona sin conexión.
  Difícil reorganiza toda la mesa con un solucionador (cubre todas las fichas de la mesa + el máximo del atril).
  Torneos deterministas en los tests: Normal le gana ~80 % a Fácil y Difícil ~85 % a Normal.
- **Varias fichas a la vez**: tocar fichas del atril las selecciona (se levantan en dorado); arrastrar cualquiera de ellas (o tocar el destino) lleva todas juntas a la mesa en un único movimiento (`moveTiles`), que se deshace con un solo "Deshacer".
- **Mover combinaciones enteras**: mantener presionada una ficha de la mesa (o Shift + arrastrar) levanta su combinación;
  se suelta sobre otra para unirlas, en un espacio libre o en el atril (intención `moveMeld`, un solo paso de deshacer).
- **Estadísticas e historial** guardados en el teléfono: partidas, victorias, rachas, mejor jugada, victoria más rápida
  y las últimas 20 partidas (por modo: amigos / bots).
- **Reacciones**: 16 emojis y 8 frases rápidas que cada jugador ve traducidas a su idioma (`phrase:<id>`).
- **Torneo al mejor de 3** (online y práctica): el anfitrión elige el modo en la sala de espera (`room:config`); gana
  quien primero llegue a 2 partidas. Marcador con trofeos en el HUD, campeón al final y "Nuevo torneo".
- **Personalizar**: 5 colores de mesa (incl. madera y medianoche) y 5 dorsos de fichas; algunos se desbloquean con victorias.
- **Resaltado de jugadas ajenas**: al empezar tu turno, lo que pusieron los demás desde tu último turno pulsa en dorado.
- **Cámara cinemática al terminar**: giro alrededor de la mesa con la jugada ganadora brillando (se salta con un toque).
- Si alguien abandona a mitad de partida, **un bot toma su lugar** y la mesa sigue.
- Móvil primero: portrait y landscape, arrastrar y soltar o *tocar y tocar*, safe areas, Wake Lock y pantalla completa.

---

## Requisitos

- Node.js **20+** (probado con 22) y npm 10+.

## Correr en local (un solo comando)

```bash
npm install
npm run dev
```

Esto levanta a la vez:

| Proceso | URL | Notas |
|---|---|---|
| Cliente (Vite) | http://localhost:5173 | HMR; hace proxy de `/socket.io` al servidor |
| Servidor (Socket.IO) | http://localhost:3001 | `GET /healthz` para comprobar |

Abre http://localhost:5173 en dos pestañas (o una normal y una de incógnito) para jugar contra ti mismo, o usa **Práctica vs bot**.

### Probar desde el celular en la misma red WiFi

1. Ejecuta `npm run dev`. Vite imprime una línea `Network: http://192.168.x.y:5173/`.
2. Abre esa URL en el celular (misma WiFi). Como el cliente usa el proxy de Vite, el WebSocket va al mismo origen y no hay que configurar nada más.
3. Crea una sala en el celular y comparte el link: tus amigos (en la misma red) entran directo. Con 2 o más en la sala, el anfitrión toca **Empezar**.
4. Si no carga: revisa que el firewall del PC permita los puertos 5173/3001.

> Nota: Web Share, Wake Lock y el Service Worker requieren HTTPS fuera de `localhost`. En la LAN funcionan con
> *fallbacks* (WhatsApp vía `wa.me`, copiar link). Para probarlos en el celular usa el despliegue o un túnel HTTPS
> (p. ej. `npx localtunnel --port 5173` o `cloudflared tunnel --url http://localhost:5173`).

### Producción en local

```bash
npm run build      # cliente (client/dist) + servidor (server/dist)
npm start          # el servidor sirve también el cliente en http://localhost:3001
```

## Tests

```bash
npm test           # Vitest: motor de reglas, bot y servidor (integración con clientes Socket.IO reales)
npm run test:e2e   # Playwright: 2 navegadores, crear sala, unirse por link, jugar un turno, sincronización, reconexión
```

El e2e compila todo y levanta el servidor en el puerto 4321 (`E2E_PORT`). Usa Chromium headless con WebGL por software
(SwiftShader). Si no tienes los navegadores de Playwright: `npx playwright install chromium`.

Cobertura del motor (casos borde pedidos): comodines en escaleras y grupos, `12-13-1` inválida, reemplazo de comodín,
apertura de 30 (incluido que las fichas de la mesa no cuentan), rollback de turno por timeout y deshacer ilimitado,
pozo agotado, partidas completas bot vs bot con invariantes (106 fichas, mesa siempre válida).

---

## Cómo se juega (reglas implementadas)

- 106 fichas: 1–13 en 4 colores × 2 copias + 2 comodines. 14 por jugador; el resto es el pozo.
- **Grupo**: 3–4 fichas del mismo número y colores distintos. **Escalera**: 3+ consecutivas del mismo color; el 1 no conecta con el 13.
- **Apertura**: combinaciones nuevas con fichas propias que sumen ≥ 30. En el turno de apertura no se puede tocar la mesa.
- Tras abrir: dividir, unir, mover y reemplazar comodines libremente; al terminar el turno **todas** las combinaciones
  deben ser válidas y ninguna ficha de la mesa puede volver al atril.
- Si no juegas, robas una ficha y pasa el turno. Temporizador configurable (60 s por defecto): al agotarse se revierte el turno y se roba.
- Gana quien se queda sin fichas. Si se acaba el pozo, gana quien tenga menos puntos en el atril (comodín = 30).

### Controles

| Acción | Táctil | Escritorio |
|---|---|---|
| Mover ficha | Arrastrar, o tocar ficha y tocar destino | Arrastrar con el mouse |
| Insertar en una combinación | Soltar sobre ella (se abre un hueco "magnético") | Igual |
| Nueva combinación | Soltar en un área libre de la mesa | Igual |
| Dividir una escalera | Sacar una ficha del medio la divide en dos | Igual |
| Mover la cámara | Arrastrar la mesa (pan), pellizcar (zoom), botón ⌖ re-centrar | Arrastrar / rueda |
| Terminar turno / Deshacer / Robar | Botones siempre visibles | `Enter` / `Z` / `Espacio` |
| Ordenar atril | Botón Color/Número | `C` / `N` |

Al arrastrar una ficha la cámara no se mueve; en táctil la ficha se dibuja por encima del dedo.

---

## Arquitectura

```
/shared   Motor puro TypeScript (sin dependencias) usado por servidor y cliente
/server   Node + Socket.IO (autoridad total)
/client   Vite + Three.js + GSAP; HUD y menús en HTML/CSS; PWA
/e2e      Playwright
```

Detalle del modelo de estado y del protocolo en [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Resumen:

- **El cliente envía intenciones** (`move`, `undo`, `reset`, `draw`, `endTurn`); el servidor las valida con
  `applyMove`/`applyTurn` y emite a cada jugador una `PlayerView` filtrada.
- **Anti-trampa**: la vista nunca incluye el atril rival (solo `rackCount`) ni el orden del pozo (solo `poolCount`).
  El fantasma de arrastre solo revela el id de la ficha si ya es pública (está en la mesa). El servidor sanea nombres,
  chat, emojis e intenciones y aplica *rate limiting* por socket.
- **Predicción**: el cliente aplica el mismo motor a una copia local para que mover fichas sea instantáneo; al recibir el
  *ack* del servidor aplica el estado autoritativo (si algo se rechazó, la vista se corrige sola).
- **Reconexión**: al crear/unirse se entrega un token de sesión (guardado en `localStorage` por sala). Socket.IO reconecta
  solo y el cliente reenvía `room:join` con el token: recupera el asiento y el atril. El rival ve "desconectado" mientras tanto.
- **Práctica**: `LocalTransport` ejecuta el mismo `GameState` en el navegador con 1 a 3 bots como rivales (misma interfaz `Transport` que el online).

### Partidas de 2 a 4 jugadores

- **Sala de espera**: muestra los asientos (hasta 4) y quién es el anfitrión 👑. El anfitrión empieza con 2–4; con 4 empieza sola.
  Si el anfitrión sale de la espera, el siguiente pasa a serlo. Una vez empezada la partida no entra nadie nuevo
  (`GAME_IN_PROGRESS`), salvo quien vuelve con su token.
- **Turnos**: rotan en sentido horario (`(asiento + 1) % n`). Cada jugador recibe 14 fichas (con 4 quedan 50 en el pozo).
- **Mesa 3D**: tú siempre abajo; los rivales se sientan alrededor en orden de turno — 2 jugadores: enfrente;
  3: izquierda y derecha; 4: izquierda, enfrente y derecha. Sus atriles son fichas boca abajo en cada borde y el del
  jugador en turno brilla en dorado. Las fichas jugadas por un rival vuelan desde su lado de la mesa.
- **HUD**: una ficha compacta por rival (avatar, fichas, conexión) en el mismo orden que en la mesa; pozo, reacciones y
  chat en la columna derecha. El encuadre de la cámara reserva el espacio de esas columnas.
- **Abandono o desconexión**: si alguien toca "Salir" en plena partida, o se desconecta (cierra la app, sin batería,
  sin señal) y no vuelve en 30 s, el servidor marca su asiento como `replaced` y un bot juega por él (los demás lo ven
  con 🤖). Si vuelve con su token, recupera el asiento. La partida sigue aunque quede un solo humano (contra los bots);
  si no queda nadie conectado, los bots no juegan solos.
- **Fin**: ranking por puntos de todos los jugadores; con el pozo agotado puede haber varios ganadores empatados.
- **Revancha**: votan todos los humanos conectados; los que se fueron no entran. Si quedan menos de 2, la sala vuelve a la espera.

### ¿Por qué Socket.IO y no Colyseus?

El estado de la partida y sus reglas ya viven en un módulo puro compartido (`/shared`), así que no necesitamos el
sistema de *schemas*/sincronización de estado de Colyseus. Socket.IO aporta lo que sí hace falta — salas, reconexión
automática con *fallback* a long-polling (redes móviles y proxies), *acks* y eventos volátiles para el arrastre — con un
cliente pequeño (~14 KB gzip) y sin acoplar el modelo de datos a un framework. El servidor queda en ~500 líneas fáciles de testear.

### Render y rendimiento

- **InstancedMesh** para todas las fichas: cuerpo biselado (`RoundedBoxGeometry`), cara con **atlas generado por canvas**
  (UV por instancia inyectada en el shader) y sombra de contacto: 3 draw calls por conjunto de fichas.
- **Render on demand**: solo se dibuja cuando algo cambia (tweens, arrastre, cámara); el menú anima a ~30 fps.
- `devicePixelRatio` limitado a 2 (Alta), 1.5 (Media), 1 (Baja). **Calidad adaptativa**: si durante animaciones sostenidas
  el promedio baja de ~38 fps se reduce la calidad automáticamente (sin sombras, sin reflejos de entorno, menos partículas).
  Ajuste manual Alta/Media/Baja/Auto en Ajustes.
- **Sin texturas que descargar**: fieltro, madera, atlas de fichas e íconos se generan por código, y los sonidos se sintetizan con WebAudio.
  Peso inicial ≈ 200 KB gzip (three.js ≈ 120 KB). *Code splitting*: el menú carga primero; la escena 3D, la partida,
  Socket.IO y el bot van en chunks aparte.
- Al salir de la partida se liberan geometrías, materiales, texturas, tweens y listeners (`BoardScene.dispose`).

### Decisiones tomadas ante ambigüedades

- **Robar con jugadas en curso**: "Robar" revierte lo movido en el turno y roba. "Terminar" sin fichas jugadas equivale a robar.
- **Pozo agotado**: la partida termina cuando a alguien le toca robar y no quedan fichas; gana el de menos puntos; si empatan varios, todos ganan.
- **Grupo vs escalera ambiguos** (p. ej. `5 + J + J`): se valora con la interpretación de mayor puntaje.
- **Orden dentro de una combinación**: se respeta el orden del jugador si es válido; si no, las escaleras se ordenan solas y los comodines rellenan huecos.
- **Dividir**: sacar una ficha del interior de una escalera válida la parte en dos combinaciones.
- **Timeout**: se revierte el turno y se roba **una** ficha (como pide el enunciado; el reglamento oficial usa 3).
- **Desconexión**: se espera 30 s; si no vuelve, el bot juega por él hasta que regrese con su token. Las salas se borran tras 30 min sin nadie conectado.
- **Revancha**: requiere que ambos acepten; se alterna quién empieza. El marcador de victorias se mantiene en la sala.
- **Profundidad de campo**: se omitió (coste de post-procesado alto en gama media); la sensación de profundidad viene de la
  perspectiva, niebla y viñeta CSS.
- **Salas en memoria**: un único proceso de servidor (suficiente para cientos de mesas de 2 a 4). Para escalar horizontalmente habría que añadir
  el adaptador Redis de Socket.IO y mover las salas a Redis.

---

## Despliegue

### Opción A — Todo en un contenedor (recomendado)

El `Dockerfile` compila cliente y servidor; el servidor sirve el cliente estático y el WebSocket en el mismo origen.

```bash
docker build -t rummi3d .
docker run -p 8080:8080 rummi3d
```

**Fly.io**

```bash
fly launch --no-deploy        # usa fly.toml (cambia "app" si el nombre está tomado)
fly deploy
```

**Render**: *New → Blueprint* apuntando a este repo (usa `render.yaml`), o *New → Web Service → Docker*.
Health check: `/healthz`.

### Opción B — Cliente en Netlify/Vercel + servidor en Fly.io/Render

1. Despliega el servidor (Opción A). Opcionalmente `SERVE_CLIENT=false` como *build arg* para no incluir el cliente.
2. En el servidor define `CORS_ORIGINS=https://tu-cliente.netlify.app`.
3. Cliente:
   - **Netlify**: importa el repo; `netlify.toml` ya define build y carpeta. Variable `VITE_SERVER_URL=https://rummi3d.fly.dev`.
   - **Vercel**: importa el repo; `vercel.json` ya define build y salida. Variable `VITE_SERVER_URL`.

### Variables de entorno

| Variable | Dónde | Default | Descripción |
|---|---|---|---|
| `PORT` | servidor | `3001` (8080 en Docker) | Puerto HTTP/WebSocket |
| `CORS_ORIGINS` | servidor | *(vacío = cualquiera)* | Orígenes permitidos separados por coma |
| `STATIC_DIR` | servidor | `client/dist` o `./public` | Carpeta del cliente compilado a servir |
| `SERVE_CLIENT` | servidor / build arg | `true` | `false` para no servir el cliente |
| `VITE_SERVER_URL` | cliente (build) | *(mismo origen)* | URL del servidor Socket.IO si el cliente está en otro dominio |
| `SERVER_PORT` | Vite dev | `3001` | Puerto al que apunta el proxy de desarrollo |
| `E2E_PORT` | Playwright | `4321` | Puerto del servidor en los tests e2e |
| `SUPABASE_URL` | servidor | *(vacío = sin cuentas)* | URL del proyecto Supabase (activa las cuentas) |
| `SUPABASE_ANON_KEY` | servidor | – | Llave pública (anon/publishable); se entrega al cliente en `/config.json` |
| `SUPABASE_SERVICE_ROLE_KEY` | servidor | – | Llave **secreta** (service_role); solo el servidor la usa para anotar partidas online. Nunca en el cliente |

Ver `.env.example`.

### Cuentas (opcional, con Supabase)

Sin las variables `SUPABASE_*` el juego funciona igual que siempre (estadísticas solo en el teléfono). Con ellas:

- **Cuenta anónima automática** al abrir el juego: nadie tiene que registrarse para empezar.
- En **Tu perfil → Guarda tu progreso**: *Continuar con Google* o *enlace por correo*. Se **vincula** a la cuenta anónima, así no se pierde nada; en otro dispositivo, el mismo Google/correo recupera la cuenta (nombre, avatar, estadísticas y temas desbloqueados).
- **Partidas online**: las anota el **servidor** (verifica el token de cada jugador al conectar y escribe con la llave secreta), así que nadie puede inventarse victorias. Quien abandona y es reemplazado por el bot no suma ni resta.
- **Práctica contra bots**: corre en el teléfono, así que la anota el propio cliente (la base de datos solo le permite insertar partidas de práctica propias).
- Las estadísticas que ya había en el teléfono se suben **una sola vez** por cuenta (`legacy_stats`).

Con cuentas también hay:

- **Amigos**: cada cuenta tiene un **código de amigo** de 6 letras (Amigos → Agregar). También se puede agregar desde el historial a quien jugó contigo una partida online. La lista muestra quién está **en línea** o **en partida** (lo informa el servidor del juego) y permite **invitar a tu sala** con un toque; el invitado recibe un aviso con "Unirme".
- **Ranking entre amigos**: victorias online (las anota el servidor) y el cara a cara de las partidas que jugaron juntos. Se calcula en la base de datos (`friends_leaderboard`) para que nadie lea resultados ajenos.
- **Logros** (15) calculados desde el historial (`shared/src/achievements.ts`): primera victoria, rachas, 10 fichas en un turno, ganar sin robar, victoria relámpago, mesa llena, torneo, bot difícil… Varios temas de mesa y dorsos se desbloquean con logros.
- **Historial detallado**: toca una partida para ver rivales con su puesto y puntos, duración, mejor jugada y fichas robadas.

- **Salas que sobreviven reinicios**: con Supabase configurado, el servidor guarda cada sala (`rooms_state`, solo accesible con la llave secreta) poco después de cada cambio y todas al apagarse (SIGTERM). Tras un reinicio o redespliegue no carga nada de golpe: recupera la sala cuando un jugador reconecta, así lee lo último que guardó el servidor anterior. El turno en curso recibe 30 s de margen y el relevo del bot se cuenta de nuevo. Las salas guardadas que nadie recupera se borran a las 12 h.
- **Volver a tu partida**: si cierras la pestaña sin querer, el menú muestra un botón para volver a tu sala (consulta `/room-status`). Salir a propósito lo quita.

Configuración (una vez):
1. Crear un proyecto en [supabase.com](https://supabase.com) y ejecutar [`supabase/schema.sql`](supabase/schema.sql) en *SQL Editor*. El archivo se puede ejecutar de nuevo sin problema: hazlo cada vez que cambie (añade columnas y funciones nuevas sin borrar datos). Sus reglas de seguridad y funciones se prueban contra Postgres real con PGlite (`server/test/schema.test.ts`).
2. *Authentication → Sign In / Providers*: activar **Allow anonymous sign-ins**, **Allow manual linking**, **Email** y **Google** (Client ID/Secret de Google Cloud; en Google Cloud, URI de redirección autorizada `https://<proyecto>.supabase.co/auth/v1/callback`).
3. *Authentication → URL Configuration*: *Site URL* = la URL del juego (p. ej. `https://rummi3d.onrender.com`) y añadirla también en *Redirect URLs* (`https://rummi3d.onrender.com/**`).
4. En Render: `SUPABASE_URL`, `SUPABASE_ANON_KEY` y `SUPABASE_SERVICE_ROLE_KEY`.
5. Recomendado: SMTP propio (p. ej. Resend) en *Authentication → Emails*; el correo integrado de Supabase solo envía unos pocos enlaces por hora.

---

## Estructura de carpetas

```
client/
  index.html                 Shell + pantalla de carga crítica
  public/                    manifest, service worker, íconos
  src/main.ts                Arranque, navegación, salas, Wake Lock, fullscreen
  src/game/controller.ts     Vista + predicción + orden del atril
  src/net/                   SocketTransport / LocalTransport (bot)
  src/three/                 engine (render on demand, calidad), board (mesa+atril+input), tileset (instancing), textures, effects
  src/ui/                    HUD, menús, tutorial, toasts
server/src/                  app.ts (Socket.IO + estáticos), rooms.ts (salas, saneado), index.ts
shared/src/                  tiles, melds, rules, game, bot, protocol
e2e/                         multiplayer.spec.ts
scripts/make-icons.mjs       Genera los PNG de la PWA sin dependencias
```
