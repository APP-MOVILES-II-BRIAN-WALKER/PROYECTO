// =============================================================================
// Triple Dice - Servidor WebSocket
// Curso  : ITI-721 - Desarrollo de Aplicaciones para Dispositivos Móviles II

// Puerto : 0.0.0.0:5000
// =============================================================================
//
// FLUJO DE UNA PARTIDA:
//   1. Jugadores se conectan y envían { tipo:"Unirse", nombre:"X" }
//   2. Con >=5 conectados, cualquiera envía { tipo:"IniciarJuego" }
//   3. Servidor lanza 11 dados, broadcast RondaIniciada (9 visibles)
//   4. Cada jugador elige 3 dados + predicción → SubmitJugada
//   5. Al recibir todos (o vencer 30s) → ResultadosRonda
//   6. Se repiten TOTAL_RONDAS veces
//   7. FinJuego con tabla, ganador y eliminado
//
// MENSAJES CLIENTE → SERVIDOR:
//   { "tipo": "Unirse",       "nombre": "Juan" }
//   { "tipo": "IniciarJuego" }
//   { "tipo": "SubmitJugada", "dados_elegidos":["visible_0","visible_3","rojo"],
//                             "prediccion":"Seis" }
//   Predicciones válidas: "Cero" | "Uno" | "Tres" | "Seis"
// =============================================================================

use tokio::net::{TcpListener, TcpStream};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::time::{sleep, Duration};
use sha1::{Sha1, Digest};
use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tokio::sync::mpsc;

// =============================================================================
// CONSTANTES DE CONFIGURACIÓN
// =============================================================================
const PUERTO:          &str = "0.0.0.0:5000";
const MIN_JUGADORES:   usize = 5;
const MAX_JUGADORES:   usize = 10;
const TOTAL_RONDAS:    u8   = 4;
const SEGUNDOS_RONDA:  u8   = 30;
const BONUS_CERO:      i32  = 20;

// =============================================================================
// TIPOS COMPARTIDOS
// =============================================================================
type Clients   = Arc<Mutex<HashMap<std::net::SocketAddr, mpsc::UnboundedSender<String>>>>;
type GameState = Arc<Mutex<TripleDiceGame>>;

// =============================================================================
// ENUMS DEL JUEGO
// =============================================================================

/// Combinación de 3 dados — ordenada de peor a mejor
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Combinacion {
    Single,    // números sueltos
    Doble,     // pareja  ej: 5-5-2
    Escalera,  // consecutivos ej: 2-3-4
    Triple,    // tres iguales ej: 6-6-6
}

/// Predicción del jugador ANTES de revelar.
/// Cada variante = uno de los 4 puntajes posibles por posición.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Prediccion {
    Cero,  // predice 0 pts (último)   → +BONUS_CERO si acierta
    Uno,   // predice 1 pt  (3°)       → duplica si acierta
    Tres,  // predice 3 pts (2°)       → duplica si acierta
    Seis,  // predice 6 pts (1°)       → duplica si acierta
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EstadoJuego {
    Lobby,
    EsperandoJugada,
    Revelando,
    FinJuego,
}

// =============================================================================
// ESTRUCTURAS
// =============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jugador {
    pub nombre:        String,
    pub addr:          String,
    pub puntos_total:  i32,
    pub jugada_actual: Option<JugadaRonda>,
    pub conectado:     bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JugadaRonda {
    pub dados_elegidos: Vec<String>,   // "visible_N" | "rojo" | "azul"
    pub prediccion:     Prediccion,
    pub combinacion:    Option<Combinacion>,
    pub puntos_ronda:   Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TripleDiceGame {
    pub estado:             EstadoJuego,
    pub ronda_actual:       u8,
    pub dados_visibles:     Vec<u8>,
    pub dado_rojo:          Option<u8>,
    pub dado_azul:          Option<u8>,
    pub jugadores:          Vec<Jugador>,
    pub segundos_restantes: u8,
}

// =============================================================================
// LÓGICA DEL JUEGO
// =============================================================================
impl TripleDiceGame {
    pub fn nuevo() -> Self {
        TripleDiceGame {
            estado:             EstadoJuego::Lobby,
            ronda_actual:       0,
            dados_visibles:     vec![],
            dado_rojo:          None,
            dado_azul:          None,
            jugadores:          vec![],
            segundos_restantes: 0,
        }
    }

    /// Lanza 9 dados visibles + rojo + azul (xorshift64)
    pub fn lanzar_dados(&mut self) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now()
            .duration_since(UNIX_EPOCH).unwrap()
            .subsec_nanos();
        let mut rng = seed as u64 ^ 0xDEAD_BEEF_CAFE_1234;
        let mut dado = || -> u8 {
            rng ^= rng << 13;
            rng ^= rng >> 7;
            rng ^= rng << 17;
            ((rng % 6) + 1) as u8
        };
        self.dados_visibles = (0..9).map(|_| dado()).collect();
        self.dado_rojo      = Some(dado());
        self.dado_azul      = Some(dado());
    }

    /// Evalúa 3 valores y retorna la mejor combinación
    pub fn evaluar_combinacion(valores: &[u8]) -> Combinacion {
        if valores.len() != 3 { return Combinacion::Single; }
        let mut v = valores.to_vec();
        v.sort_unstable();
        if v[0] == v[1] && v[1] == v[2]        { return Combinacion::Triple;   }
        if v[1] == v[0]+1 && v[2] == v[1]+1    { return Combinacion::Escalera; }
        if v[0] == v[1]   || v[1] == v[2]      { return Combinacion::Doble;    }
        Combinacion::Single
    }

    /// Resuelve dados → combinaciones → ranking → puntos base → bonus
    pub fn calcular_puntos_ronda(&mut self) {
        let rojo = self.dado_rojo.unwrap_or(1);
        let azul = self.dado_azul.unwrap_or(1);

        // Paso 1 — resolver valor de cada dado elegido
        for jugador in self.jugadores.iter_mut() {
            if let Some(jugada) = jugador.jugada_actual.as_mut() {
                let vals: Vec<u8> = jugada.dados_elegidos.iter().map(|d| {
                    match d.as_str() {
                        "rojo" => rojo,
                        "azul" => azul,
                        s => {
                            let idx: usize = s.trim_start_matches("visible_")
                                .parse().unwrap_or(0);
                            *self.dados_visibles.get(idx).unwrap_or(&1)
                        }
                    }
                }).collect();
                jugada.combinacion = Some(Self::evaluar_combinacion(&vals));
            }
        }

        // Paso 2 — ranking mayor → menor
        let mut ranking: Vec<(usize, Combinacion)> = self.jugadores
            .iter().enumerate()
            .filter_map(|(i, j)| {
                j.jugada_actual.as_ref()
                    .and_then(|jug| jug.combinacion.clone())
                    .map(|c| (i, c))
            }).collect();
        ranking.sort_by(|a, b| b.1.cmp(&a.1));

        let n = ranking.len();

        // Paso 3 — puntos por posición: 1°=6, 2°=3, 3°=1, resto=0, último=0
        let pts_pos = |pos: usize| -> i32 {
            if pos == n.saturating_sub(1) { return 0; }
            match pos { 0=>6, 1=>3, 2=>1, _=>0 }
        };

        // Paso 4 — empates: promedian puntos de las posiciones que ocupan
        let mut pos = 0usize;
        while pos < ranking.len() {
            let combo = &ranking[pos].1;
            let mut fin = pos + 1;
            while fin < ranking.len() && &ranking[fin].1 == combo { fin += 1; }
            let suma: i32 = (pos..fin).map(|p| pts_pos(p)).sum();
            let cada_uno  = suma / (fin - pos) as i32;
            for &(idx, _) in &ranking[pos..fin] {
                self.jugadores[idx].jugada_actual.as_mut().unwrap()
                    .puntos_ronda = Some(cada_uno);
            }
            pos = fin;
        }

        // Paso 5 — bonus + acumular total
        for jugador in self.jugadores.iter_mut() {
            if let Some(jugada) = jugador.jugada_actual.as_mut() {
                let base    = jugada.puntos_ronda.unwrap_or(0);
                let bonus   = Self::calcular_bonus(&jugada.prediccion, base);
                let final_  = base + bonus;
                jugada.puntos_ronda   = Some(final_);
                jugador.puntos_total += final_;
            }
        }
    }

    /// Cero correcto → +BONUS_CERO | Uno/Tres/Seis correcto → duplica | fallo → 0
    pub fn calcular_bonus(pred: &Prediccion, base: i32) -> i32 {
        let ok = match pred {
            Prediccion::Cero => base == 0,
            Prediccion::Uno  => base == 1,
            Prediccion::Tres => base == 3,
            Prediccion::Seis => base == 6,
        };
        if !ok { return 0; }
        if *pred == Prediccion::Cero { BONUS_CERO } else { base }
    }

    pub fn todos_jugaron(&self) -> bool {
        self.jugadores.iter().filter(|j| j.conectado).all(|j| j.jugada_actual.is_some())
    }

    pub fn jugadores_conectados(&self) -> usize {
        self.jugadores.iter().filter(|j| j.conectado).count()
    }

    pub fn preparar_siguiente_ronda(&mut self) {
        for j in self.jugadores.iter_mut() { j.jugada_actual = None; }
    }
}

// =============================================================================
// MENSAJES JSON — SERVIDOR → CLIENTES
// =============================================================================
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "tipo")]
pub enum MensajeServidor {
    SalaActualizada    { jugadores: Vec<String>, total: usize, minimo: usize, maximo: usize },
    JuegoIniciado      { mensaje: String, total_rondas: u8, jugadores: Vec<String> },
    RondaIniciada      { ronda: u8, total_rondas: u8, dados_visibles: Vec<u8>, segundos: u8 },
    TiempoRestante     { segundos: u8, jugaron_ya: usize, total_activos: usize },
    ResultadosRonda    { ronda: u8, dado_rojo: u8, dado_azul: u8, ranking: Vec<ResultadoJugador> },
    FinJuego           { tabla_final: Vec<ResultadoJugador>, ganador: String, perdedor: String, mensaje: String },
    JugadaRecibida     { nombre: String, jugaron_ya: usize, total_activos: usize },
    JugadorUnido       { nombre: String, mensaje: String, total: usize, minimo: usize },
    JugadorDesconectado{ nombre: String, mensaje: String, total: usize },
    Error              { mensaje: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ResultadoJugador {
    pub nombre:       String,
    pub combinacion:  String,
    pub dados:        Vec<String>,
    pub puntos_ronda: i32,
    pub puntos_total: i32,
    pub prediccion:   String,
    pub acierto:      bool,
    pub bonus:        i32,
}

// =============================================================================
// MENSAJES JSON — CLIENTES → SERVIDOR
// =============================================================================
#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "tipo")]
pub enum MensajeCliente {
    Unirse      { nombre: String },
    IniciarJuego,
    SubmitJugada { dados_elegidos: Vec<String>, prediccion: String },
}

// =============================================================================
// MAIN
// =============================================================================
#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(PUERTO).await?;
    let clients: Clients   = Arc::new(Mutex::new(HashMap::new()));
    let game:    GameState = Arc::new(Mutex::new(TripleDiceGame::nuevo()));

    println!("╔═══════════════════════════════════════════════╗");
    println!("║     Triple Dice  —  Servidor WebSocket        ║");
    println!("║     PROYECTO  • PHILIP WALKER Y PAULA SANCHEZ ║");
    println!("╠═══════════════════════════════════════════════╣");
    println!("║  Puerto : {}                                  ║", PUERTO);
    println!("║  Min    : {} jugadores                        ║", MIN_JUGADORES);
    println!("║  Max    : {} jugadores                        ║", MAX_JUGADORES);
    println!("║  Rondas : {}                                  ║", TOTAL_RONDAS);
    println!("╚═══════════════════════════════════════════════╝\n");

    loop {
        let (socket, addr) = listener.accept().await?;
        let c = Arc::clone(&clients);
        let g = Arc::clone(&game);
        tokio::spawn(async move {
            if let Err(e) = handle_connection(socket, addr, c, g).await {
                eprintln!("[ERROR] {}: {}", addr, e);
            }
        });
    }
}

// =============================================================================
// HANDLE CONNECTION
// =============================================================================
async fn handle_connection(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    clients: Clients,
    game: GameState,
) -> Result<(), Box<dyn std::error::Error>> {

    // ── Handshake RFC 6455 ───────────────────────────────────────────────────
    let mut buf = [0u8; 2048];
    let n   = socket.read(&mut buf).await?;
    let req = String::from_utf8_lossy(&buf[..n]);

    let key = req.lines()
        .find(|l| l.starts_with("Sec-WebSocket-Key:"))
        .and_then(|l| l.split(':').nth(1)).map(str::trim)
        .ok_or("Sec-WebSocket-Key no encontrada")?;

    let mut sha1 = Sha1::new();
    sha1.update(format!("{}258EAFA5-E914-47DA-95CA-C5AB0DC85B11", key).as_bytes());
    let accept = general_purpose::STANDARD.encode(sha1.finalize());

    socket.write_all(format!(
        "HTTP/1.1 101 Switching Protocols\r\n\
         Upgrade: websocket\r\nConnection: Upgrade\r\n\
         Sec-WebSocket-Accept: {}\r\n\r\n", accept
    ).as_bytes()).await?;
    println!("[WS] ✓ {}", addr);

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    clients.lock().unwrap().insert(addr, tx);

    let (mut reader, mut writer) = socket.split();
    let mut mi_nombre: Option<String> = None;

    // ── Loop principal ───────────────────────────────────────────────────────
    loop {
        let mut hdr = [0u8; 2];
        tokio::select! {

            res = reader.read_exact(&mut hdr) => {
                if res.is_err() { break; }

                let opcode = hdr[0] & 0x0F;
                if opcode == 0x8 { let _ = writer.write_all(&[0x88,0x00]).await; break; }
                if opcode == 0x9 { let _ = writer.write_all(&[0x8A,0x00]).await; continue; }

                let masked          = (hdr[1] & 0x80) != 0;
                let mut plen        = (hdr[1] & 0x7F) as usize;
                if plen == 126 {
                    let mut e=[0u8;2]; reader.read_exact(&mut e).await?;
                    plen = u16::from_be_bytes(e) as usize;
                } else if plen == 127 {
                    let mut e=[0u8;8]; reader.read_exact(&mut e).await?;
                    plen = u64::from_be_bytes(e) as usize;
                }

                let mut mask = [0u8;4];
                if masked { reader.read_exact(&mut mask).await?; }
                let mut raw = vec![0u8; plen];
                reader.read_exact(&mut raw).await?;

                let decoded: Vec<u8> = raw.iter().enumerate()
                    .map(|(i,b)| if masked { b^mask[i%4] } else { *b }).collect();
                let texto = String::from_utf8_lossy(&decoded).to_string();
                println!("[RX] {} → {}", addr, &texto[..texto.len().min(100)]);

                match serde_json::from_str::<MensajeCliente>(&texto) {

                    // ── Unirse ────────────────────────────────────────────────
                    Ok(MensajeCliente::Unirse { nombre }) => {
                        let res = {
                            let mut g = game.lock().unwrap();
                            if g.estado != EstadoJuego::Lobby {
                                Err("El juego ya comenzó.".to_string())
                            } else if g.jugadores_conectados() >= MAX_JUGADORES
                                && !g.jugadores.iter().any(|j| j.nombre == nombre) {
                                Err(format!("Sala llena ({} máximo).", MAX_JUGADORES))
                            } else {
                                if let Some(j) = g.jugadores.iter_mut().find(|j| j.nombre == nombre) {
                                    j.conectado = true; j.addr = addr.to_string();
                                } else {
                                    g.jugadores.push(Jugador {
                                        nombre: nombre.clone(), addr: addr.to_string(),
                                        puntos_total: 0, jugada_actual: None, conectado: true,
                                    });
                                }
                                let total   = g.jugadores_conectados();
                                let nombres = g.jugadores.iter().filter(|j|j.conectado)
                                    .map(|j|j.nombre.clone()).collect::<Vec<_>>();
                                Ok((nombre.clone(), total, nombres))
                            }
                        };
                        match res {
                            Err(m) => { send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{mensaje:m})).await?; }
                            Ok((nom, total, nombres)) => {
                                mi_nombre = Some(nom.clone());
                                println!("[SALA] '{}' unido ({}/{})", nom, total, MAX_JUGADORES);
                                broadcast_all(&clients, &serialize_msg(&MensajeServidor::JugadorUnido {
                                    nombre: nom.clone(), mensaje: format!("👤 {} entró a la sala.", nom),
                                    total, minimo: MIN_JUGADORES,
                                }));
                                broadcast_all(&clients, &serialize_msg(&MensajeServidor::SalaActualizada {
                                    jugadores: nombres, total, minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
                                }));
                            }
                        }
                    }

                    // ── IniciarJuego ──────────────────────────────────────────
                    Ok(MensajeCliente::IniciarJuego) => {
                        let res = {
                            let mut g = game.lock().unwrap();
                            if g.estado != EstadoJuego::Lobby {
                                Err("El juego ya está en curso.".to_string())
                            } else if g.jugadores_conectados() < MIN_JUGADORES {
                                Err(format!("Se necesitan {} jugadores (hay {}).",
                                    MIN_JUGADORES, g.jugadores_conectados()))
                            } else {
                                g.estado = EstadoJuego::EsperandoJugada;
                                let nombres = g.jugadores.iter().filter(|j|j.conectado)
                                    .map(|j|j.nombre.clone()).collect::<Vec<_>>();
                                Ok(nombres)
                            }
                        };
                        match res {
                            Err(m) => { send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{mensaje:m})).await?; }
                            Ok(nombres) => {
                                broadcast_all(&clients, &serialize_msg(&MensajeServidor::JuegoIniciado {
                                    mensaje: "🎲 ¡Triple Dice comienza!".into(),
                                    total_rondas: TOTAL_RONDAS, jugadores: nombres,
                                }));
                                let gc = Arc::clone(&game);
                                let cc = Arc::clone(&clients);
                                tokio::spawn(async move {
                                    if let Err(e) = ejecutar_rondas(gc, cc).await {
                                        eprintln!("[RONDAS] {}", e);
                                    }
                                });
                            }
                        }
                    }

                    // ── SubmitJugada ──────────────────────────────────────────
                    Ok(MensajeCliente::SubmitJugada { dados_elegidos, prediccion }) => {
                        let nom = match &mi_nombre {
                            Some(n) => n.clone(),
                            None => { send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{mensaje:"Únete primero.".into()})).await?; continue; }
                        };

                        if dados_elegidos.len() != 3 {
                            send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{mensaje:"Elige exactamente 3 dados.".into()})).await?;
                            continue;
                        }

                        let pred = match prediccion.as_str() {
                            "Cero" => Prediccion::Cero, "Uno" => Prediccion::Uno,
                            "Tres" => Prediccion::Tres, "Seis" => Prediccion::Seis,
                            otro => {
                                send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{
                                    mensaje: format!("Predicción '{}' inválida. Usa: Cero|Uno|Tres|Seis", otro)
                                })).await?;
                                continue;
                            }
                        };

                        let resultado = {
                            let mut g = game.lock().unwrap();
                            if g.estado != EstadoJuego::EsperandoJugada {
                                Err("No hay ronda activa.".to_string())
                            } else if g.jugadores.iter().any(|j| j.nombre == nom && j.jugada_actual.is_some()) {
                                Err("Ya enviaste tu jugada en esta ronda.".to_string())
                            } else {
                                if let Some(j) = g.jugadores.iter_mut().find(|j| j.nombre == nom) {
                                    j.jugada_actual = Some(JugadaRonda {
                                        dados_elegidos: dados_elegidos.clone(),
                                        prediccion: pred, combinacion: None, puntos_ronda: None,
                                    });
                                }
                                let ya    = g.jugadores.iter().filter(|j|j.conectado && j.jugada_actual.is_some()).count();
                                let total = g.jugadores_conectados();
                                Ok((ya, total))
                            }
                        };

                        match resultado {
                            Err(m) => { send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{mensaje:m})).await?; }
                            Ok((ya, total)) => {
                                println!("[JUGADA] '{}' jugó ({}/{})", nom, ya, total);
                                send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::JugadaRecibida {
                                    nombre: nom, jugaron_ya: ya, total_activos: total,
                                })).await?;
                            }
                        }
                    }

                    Err(e) => {
                        send_ws_frame(&mut writer, &serialize_msg(&MensajeServidor::Error{
                            mensaje: format!("JSON inválido: {}", e)
                        })).await?;
                    }
                }
            }

            Some(msg) = rx.recv() => {
                if send_ws_frame(&mut writer, &msg).await.is_err() { break; }
            }
        }
    }

    // ── Limpieza ─────────────────────────────────────────────────────────────
    clients.lock().unwrap().remove(&addr);
    if let Some(nom) = &mi_nombre {
        let total = {
            let mut g = game.lock().unwrap();
            if let Some(j) = g.jugadores.iter_mut().find(|j| j.nombre == *nom) { j.conectado = false; }
            g.jugadores_conectados()
        };
        broadcast_all(&clients, &serialize_msg(&MensajeServidor::JugadorDesconectado {
            nombre: nom.clone(), mensaje: format!("⚠️ {} se desconectó.", nom), total,
        }));
        println!("[WS] ✗ '{}' ({})", nom, addr);
    }
    Ok(())
}

// =============================================================================
// LOOP DE RONDAS
// =============================================================================
async fn ejecutar_rondas(game: GameState, clients: Clients) -> Result<(), Box<dyn std::error::Error>> {

    for ronda in 1u8..=TOTAL_RONDAS {
        println!("\n[RONDA {}] ══════ Iniciando ══════", ronda);

        let msg = {
            let mut g = game.lock().unwrap();
            g.ronda_actual = ronda;
            g.estado       = EstadoJuego::EsperandoJugada;
            g.lanzar_dados();
            g.preparar_siguiente_ronda();
            println!("[RONDA {}] Visibles: {:?} | Rojo:{:?} Azul:{:?}",
                ronda, g.dados_visibles, g.dado_rojo, g.dado_azul);
            serialize_msg(&MensajeServidor::RondaIniciada {
                ronda, total_rondas: TOTAL_RONDAS,
                dados_visibles: g.dados_visibles.clone(), segundos: SEGUNDOS_RONDA,
            })
        };
        broadcast_all(&clients, &msg);

        // Countdown
        for seg in (1u8..=SEGUNDOS_RONDA).rev() {
            sleep(Duration::from_secs(1)).await;
            let (todos, ya, total) = {
                let g = game.lock().unwrap();
                let ya    = g.jugadores.iter().filter(|j|j.conectado && j.jugada_actual.is_some()).count();
                let total = g.jugadores_conectados();
                (g.todos_jugaron(), ya, total)
            };
            if todos { println!("[RONDA {}] ✓ Todos jugaron.", ronda); break; }
            if seg % 5 == 0 || seg <= 5 {
                broadcast_all(&clients, &serialize_msg(&MensajeServidor::TiempoRestante {
                    segundos: seg, jugaron_ya: ya, total_activos: total,
                }));
            }
        }

        sleep(Duration::from_secs(2)).await;

        // Calcular y revelar
        let msg_res = {
            let mut g = game.lock().unwrap();
            g.estado = EstadoJuego::Revelando;
            g.calcular_puntos_ronda();
            let rojo = g.dado_rojo.unwrap_or(1);
            let azul = g.dado_azul.unwrap_or(1);

            let mut ranking: Vec<ResultadoJugador> = g.jugadores.iter()
                .filter(|j| j.conectado)
                .map(|j| {
                    let jug      = j.jugada_actual.as_ref();
                    let base_pts = jug.and_then(|x| x.puntos_ronda).unwrap_or(0);
                    let bonus    = jug.map(|x| TripleDiceGame::calcular_bonus(&x.prediccion, base_pts)).unwrap_or(0);
                    ResultadoJugador {
                        nombre:       j.nombre.clone(),
                        combinacion:  jug.and_then(|x|x.combinacion.as_ref()).map(|c|format!("{:?}",c)).unwrap_or_default(),
                        dados:        jug.map(|x|x.dados_elegidos.clone()).unwrap_or_default(),
                        puntos_ronda: base_pts,
                        puntos_total: j.puntos_total,
                        prediccion:   jug.map(|x|format!("{:?}",x.prediccion)).unwrap_or_default(),
                        acierto:      bonus > 0,
                        bonus,
                    }
                }).collect();
            ranking.sort_by(|a,b| b.puntos_ronda.cmp(&a.puntos_ronda));

            println!("[RONDA {}] Resultados:", ronda);
            for r in &ranking {
                println!("  {:12} | {:8} | ronda:{:2} total:{:3} | pred:{:4} | bonus:{:2} | acierto:{}",
                    r.nombre, r.combinacion, r.puntos_ronda, r.puntos_total, r.prediccion, r.bonus, r.acierto);
            }
            serialize_msg(&MensajeServidor::ResultadosRonda { ronda, dado_rojo:rojo, dado_azul:azul, ranking })
        };
        broadcast_all(&clients, &msg_res);

        if ronda < TOTAL_RONDAS { sleep(Duration::from_secs(5)).await; }
    }

    // Fin del juego
    let msg_fin = {
        let mut g = game.lock().unwrap();
        g.estado = EstadoJuego::FinJuego;
        let mut tabla: Vec<ResultadoJugador> = g.jugadores.iter().filter(|j|j.conectado)
            .map(|j| ResultadoJugador {
                nombre: j.nombre.clone(), combinacion: String::new(), dados: vec![],
                puntos_ronda: 0, puntos_total: j.puntos_total,
                prediccion: String::new(), acierto: false, bonus: 0,
            }).collect();
        tabla.sort_by(|a,b| b.puntos_total.cmp(&a.puntos_total));
        let ganador  = tabla.first().map(|j|j.nombre.clone()).unwrap_or_default();
        let perdedor = tabla.last().map(|j|j.nombre.clone()).unwrap_or_default();
        println!("\n[FIN] 🏆 {} | ☠️ {}", ganador, perdedor);
        serialize_msg(&MensajeServidor::FinJuego {
            tabla_final: tabla,
            ganador: ganador.clone(), perdedor: perdedor.clone(),
            mensaje: format!("🏆 {} ganó. ☠️ {} eliminado.", ganador, perdedor),
        })
    };
    broadcast_all(&clients, &msg_fin);
    Ok(())
}

// =============================================================================
// UTILIDADES
// =============================================================================
fn serialize_msg(msg: &MensajeServidor) -> String {
    serde_json::to_string(msg).unwrap_or_else(|_| r#"{"tipo":"Error","mensaje":"error interno"}"#.into())
}

fn broadcast_all(clients: &Clients, msg: &str) {
    if let Ok(g) = clients.lock() {
        for tx in g.values() { let _ = tx.send(msg.to_string()); }
    }
}

async fn send_ws_frame(writer: &mut tokio::net::tcp::WriteHalf<'_>, text: &str)
    -> Result<(), Box<dyn std::error::Error>>
{
    let p = text.as_bytes();
    let mut h = Vec::with_capacity(10);
    h.push(0x81u8);
    match p.len() {
        n if n <= 125     => h.push(n as u8),
        n if n <= 65535   => { h.push(126); h.extend_from_slice(&(n as u16).to_be_bytes()); }
        n                 => { h.push(127); h.extend_from_slice(&(n as u64).to_be_bytes()); }
    }
    writer.write_all(&h).await?;
    writer.write_all(p).await?;
    Ok(())
}
