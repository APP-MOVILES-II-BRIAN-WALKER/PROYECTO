# Triple Dice

**Proyecto:** ITI-721 - Desarrollo de Aplicaciones para Dispositivos Moviles II  
**Autores:** Philip Walker & Paula Sanchez

Triple Dice es un juego multijugador en tiempo real construido con Rust + Tokio en el servidor, React Native 0.85 en Android, Java 17,  MongoDB para persistencia, y un visor web en HTML/JS puro.

---

## Estructura del repositorio

```
/
├── server-rust/          # Servidor WebSocket en Rust
│   ├── Cargo.toml
│   ├── Cargo.lock
│   └── src/
│       └── main.rs
│
├── TripleDice/           # App React Native
│   ├── android/          # Proyecto Android nativo
│   ├── index.js
│   ├── App.tsx           # agregar manualmente
│   ├── babel.config.js
│   ├── metro.config.js
│   ├── app.json
│   ├── package.json
│   └── src/              # agregar manualmente
│
└── web view/
    └── index.html
```

---

## 1. Servidor Rust

### Prerequisitos

- Rust toolchain >= 1.75 ([rustup.rs](https://rustup.rs))
- Puerto 5000 disponible en la red

### Instalacion y ejecucion

```bash
cd server-rust
cargo build --release
cargo run --release
```

El servidor escucha en `0.0.0.0:5000`.

### Configuracion en `src/main.rs`

| Constante | Valor por defecto | Descripcion |
|-----------|------------------|-------------|
| `PUERTO` | `0.0.0.0:5000` | Puerto TCP del servidor |
| `MONGO_URI` | `mongodb://54.86.24.49:27017` | URI de MongoDB |
| `MONGO_DB` | `triple_dice` | Nombre de la base de datos |
| `MIN_JUGADORES` | `1` | Minimo de jugadores para iniciar |
| `MAX_JUGADORES` | `10` | Maximo por sala |
| `TOTAL_RONDAS` | `4` | Rondas por partida |
| `SEGUNDOS_RONDA` | `15` | Segundos para enviar jugada |

Para cambiar la IP o el puerto, edita las constantes al inicio de `src/main.rs` y recompila.

---

## 2. Base de datos MongoDB

No es necesario crear colecciones manualmente, MongoDB las genera al primer insert. Solo se necesita que el servidor de Mongo este corriendo y accesible desde la URI configurada.

Las colecciones que crea el servidor son dos: `logs` con eventos del servidor (conexiones, salas, errores), y `partidas` con el resultado completo de cada partida finalizada.

Para usar una instancia local en lugar del servidor remoto, cambia en `src/main.rs`:

```rust
const MONGO_URI: &str = "mongodb://localhost:27017";
```

Si MongoDB no esta disponible, el servidor sigue funcionando normalmente pero sin persistir logs ni partidas.

---

## 3. App React Native (Android)

### Archivos que hay que agregar manualmente

El repositorio no incluye el codigo fuente de la app en si. Hay que colocar los siguientes archivos en sus rutas correspondientes:

```
TripleDice/
├── App.tsx          # componente raiz, va en la raiz junto a index.js
└── src/             # carpeta con pantallas, contexto y componentes
    ├── screens/
    │   ├── HomeScreen.tsx
    │   ├── LobbyScreen.tsx
    │   ├── GameScreen.tsx
    │   └── ResultsScreen.tsx
    ├── context/
    │   └── WebSocketContext.tsx
    └── components/
        └── DiceBoard.tsx
```

### Prerequisitos

- Node.js >= 22.11
- JDK 17 (Android Studio lo incluye)
- Android SDK - API 36
- Android Studio Hedgehog o superior
- `adb` en PATH (viene con Android Studio)

### IP del servidor

En el contexto WebSocket de la app, apunta a la IP correcta:

```typescript
const WS_URL = 'ws://TU_IP:5000';
```

En emulador usa `10.0.2.2`; en dispositivo fisico usa la IP local de la maquina que corre el servidor.

### Instalacion de dependencias

```bash
cd TripleDice
npm install
```

### Keystore para release

El `build.gradle` espera las siguientes variables en `TripleDice/android/gradle.properties`:

```properties
MYAPP_RELEASE_STORE_FILE=release.keystore
MYAPP_RELEASE_STORE_PASSWORD=tu_password
MYAPP_RELEASE_KEY_ALIAS=tu_alias
MYAPP_RELEASE_KEY_PASSWORD=tu_password
```

Para debug no hace falta, el `debug.keystore` ya esta incluido.

### Correr en modo desarrollo

```bash
# Terminal 1 - Metro bundler
cd TripleDice
npm start

# Terminal 2 - instalar en Android
npm run android
```

---

## 4. Visor Web

Abri `web view/index.html` directamente en cualquier navegador. No requiere servidor web ni dependencias.

Ingresa la IP del servidor, conecta, y selecciona una sala para observar. El visor se conecta como `[VISOR-WEB]` y no cuenta como jugador activo, puede unirse a partidas que ya estan en curso.

---

## 5. Generar el APK e instalarlo por ADB

### APK debug

```bash
cd TripleDice/android
./gradlew assembleDebug
```

El APK queda en:

```
TripleDice/android/app/build/outputs/apk/debug/app-debug.apk
```

### APK release

```bash
cd TripleDice/android
./gradlew assembleRelease
```

El APK queda en:

```
TripleDice/android/app/build/outputs/apk/release/app-release.apk
```

Tene configurado el keystore en `gradle.properties` antes de correr este comando.

### Instalar en dispositivo fisico

Conecta el dispositivo por USB con depuracion USB habilitada:

```bash
# verificar que el dispositivo es reconocido
adb devices

# instalar
adb install TripleDice/android/app/build/outputs/apk/debug/app-debug.apk
```

Si ya hay una version instalada y queres reemplazarla:

```bash
adb install -r TripleDice/android/app/build/outputs/apk/debug/app-debug.apk
```

### Instalar en emulador

```bash
adb -e install TripleDice/android/app/build/outputs/apk/debug/app-debug.apk
```

### Ver logs en tiempo real

```bash
adb logcat -s ReactNativeJS
```
