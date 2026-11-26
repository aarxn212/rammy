# Rummy Club — versión estática para GitHub Pages

Esta aplicación está hecha con HTML, CSS y JavaScript nativo. No necesita Node, compilación ni servidor propio. GitHub Pages sirve los archivos estáticos; **Firebase Realtime Database** proporciona la sincronización multijugador.

## Publicar en GitHub Pages

1. Crea un repositorio público llamado `rummy-club` en GitHub.
2. Sube `index.html`, `style.css`, `app.js` y `README.md` a la raíz del repositorio.
3. En GitHub: **Settings → Pages → Deploy from a branch → main → /(root) → Save**.
4. La web aparecerá en `https://TU-USUARIO.github.io/rummy-club/`.

## Configurar Firebase (necesario para multijugador real)

1. Entra en https://console.firebase.google.com/ y crea un proyecto.
2. Añade una aplicación web y copia la configuración.
3. En **Authentication → Sign-in method**, activa **Anonymous**.
4. En **Realtime Database**, crea una base de datos. Elige una región europea si procede.
5. Copia la configuración del SDK web y sustituye los valores de `firebaseConfig` al principio de `app.js`:
   - `apiKey`
   - `authDomain`
   - `databaseURL` (URL exacta que muestra Firebase)
   - `projectId`
   - `appId`
6. En Firebase Authentication → Settings → Authorized domains, añade `TU-USUARIO.github.io`.
7. Configura las reglas iniciales de Realtime Database indicadas más abajo.

### Reglas iniciales de Realtime Database

Para una prueba privada con amigos puedes usar estas reglas de desarrollo, que requieren autenticación. No son un sistema anti-trampas completo: la aplicación realiza validaciones en el navegador y un cliente modificado podría intentar escribir estados no permitidos. Para partidas competitivas o públicas, mueve el motor de juego a Cloud Functions/servidor y valida cada acción allí.

```json
{
  "rules": {
    ".read": false,
    ".write": false,
    "rooms": {
      "$room": {
        ".read": "auth != null",
        ".write": "auth != null"
      }
    }
  }
}
```

Estas reglas permiten que cualquier usuario autenticado lea/escriba el estado de cualquier sala si conoce su código. Úsalas solo para prototipo privado y no compartas códigos públicamente. Para una versión segura hay que endurecer las reglas o usar un backend autoritativo.

## Reglas implementadas en esta base

- Salas con código de seis caracteres.
- Entre 2 y 4 participantes.
- 14 cartas iniciales.
- Baraja de dos mazos franceses sin comodines (104 cartas), necesaria para repartir 14 cartas a cuatro jugadores.
- As vale 10; J/Q/K valen 10; cartas numéricas conservan su valor.
- Escaleras, tríos y cuartetos.
- As bajo (A-2-3) y alto (10-J-Q-K-A).
- Para bajar por primera vez basta con seleccionar una combinación válida (trío, cuarteto o escalera); ya no hay mínimo de puntos.
- Tras abrir, se puede robar del descarte.
- Las combinaciones bajadas son visibles para todos los jugadores.
- Cualquier jugador que ya haya bajado al menos una combinación puede añadir cartas a cualquier combinación de la mesa, durante su turno y después de robar.
- Las cartas se pueden añadir arrastrándolas desde la mano hasta la combinación; el juego solo las incorpora si la combinación sigue siendo válida.
- No se permite quitar cartas de combinaciones.
- Turnos: robar, jugar y descartar una carta.
- Temporizador de 40 segundos visible y sincronizado mediante el estado de la sala.
- Si el tiempo termina antes de robar, se pierde el turno. Si ya robó, se descarta una carta aleatoria y pasa el turno.
- Puntuación de ronda: el ganador suma el valor de las cartas que quedan en las manos de los rivales; gana la partida al alcanzar o superar 100 puntos.

## Reglas pendientes de confirmar

Para no inventar reglas de vuestra variante, quedan por definir:
- Cómo se puntúa la mano de los jugadores cuando alguien cierra.
- Qué significa exactamente “terminar con una carta en mano” en relación con las 14 cartas iniciales y el descarte de fin de turno.
- Gestión de final de ronda, eliminación al llegar a 100 y cierre de partida.

## Limitaciones importantes de esta versión

Es una **base funcional de prototipo**, no una versión de producción certificada. La base actual sincroniza estado usando Firebase Realtime Database, pero todavía no incorpora seguridad anti-trampas real, presencia robusta, recuperación completa de sesión, validación de servidor, desempate, cierre y puntuación final. La escritura directa desde el navegador no puede considerarse segura para partidas públicas.

No hace falta instalar paquetes. Firebase se carga desde la CDN oficial mediante módulos ES.


## Importante sobre el temporizador y la seguridad

El temporizador se sincroniza usando `turnStartedAt` en Firebase Realtime Database. Los clientes conectados intentan aplicar el timeout mediante una transacción, por lo que solo una actualización debería consolidarse. Es una solución adecuada para pruebas privadas, pero no es anti-trampas: un cliente modificado puede intentar manipular datos. Para partidas públicas, la gestión del tiempo, los descartes aleatorios y la puntuación deben ejecutarse en Cloud Functions o en un backend autoritativo.

La puntuación se aplica cuando un jugador se queda sin cartas tras bajar una combinación: suma los puntos de las cartas que conservan los demás jugadores. Si alcanza 100 puntos, la partida termina; en caso contrario, el anfitrión puede iniciar otra ronda. La variante de cierre debe probarse con las reglas exactas de vuestra mesa antes de usarla como versión definitiva.


## Organización y detección de combinaciones

- Puedes arrastrar una carta de tu mano y soltarla sobre otra para cambiar su posición.
- El orden de tu mano se guarda en la sala de Firebase y solo reorganiza tus propias cartas; no cambia las manos de los demás jugadores.
- El juego analiza automáticamente los subconjuntos de tu mano y marca en verde todas las cartas que participan en al menos una combinación válida.
- Las combinaciones detectadas incluyen escaleras del mismo palo, con As bajo o alto, tríos y cuartetos de palos distintos. Las combinaciones pueden solaparse; por eso una carta puede participar en varias.
