// =============================================================================
// Triple Dice - Servidor WebSocket  —  Multi-Sala
// Curso  : ITI-721 - Desarrollo de Aplicaciones para Dispositivos Móviles II
// Puerto : 0.0.0.0:5000
// FIX    : Visores web ya NO cuentan como jugadores activos
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
use mongodb::{Client as MongoClient, options::ClientOptions, bson::{doc, DateTime, to_bson}};

const PUERTO:         &str  = "0.0.0.0:5000";
const MONGO_URI:      &str  = "mongodb://54.86.24.49:27017";
const MONGO_DB:       &str  = "triple_dice";
const MIN_JUGADORES:  usize = 1;
const MAX_JUGADORES:  usize = 10;
const TOTAL_RONDAS:   u8    = 4;
const SEGUNDOS_RONDA: u8    = 15;
const BONUS_CERO:     i32   = 20;

type TxMap    = Arc<Mutex<HashMap<std::net::SocketAddr, mpsc::UnboundedSender<String>>>>;
type Salas    = Arc<Mutex<HashMap<String, Sala>>>;
type Mongo    = Arc<MongoClient>;

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
pub enum Combinacion { Single, Doble, Escalera, Triple }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum Prediccion { Cero, Uno, Tres, Seis }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub enum EstadoJuego { Lobby, EsperandoJugada, Revelando, FinJuego }

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Jugador {
    pub nombre:        String,
    pub addr:          String,
    pub puntos_total:  i32,
    pub jugada_actual: Option<JugadaRonda>,
    pub conectado:     bool,
    pub listo:         bool,
    // FIX: flag para distinguir visores web de jugadores reales
    pub es_visor:      bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JugadaRonda {
    pub dados_elegidos: Vec<String>,
    pub prediccion:     Prediccion,
    pub combinacion:    Option<Combinacion>,
    pub puntos_ronda:   Option<i32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Sala {
    pub sala_id:            String,
    pub nombre_sala:        String,
    pub anfitrion:          String,
    pub estado:             EstadoJuego,
    pub ronda_actual:       u8,
    pub dados_visibles:     Vec<u8>,
    pub dado_rojo:          Option<u8>,
    pub dado_azul:          Option<u8>,
    pub jugadores:          Vec<Jugador>,
    pub segundos_restantes: u8,
    pub partida_id:         String,
}

impl Sala {
    pub fn nueva(sala_id: String, nombre_sala: String, anfitrion: String) -> Self {
        Sala {
            sala_id:            sala_id.clone(),
            nombre_sala,
            anfitrion,
            estado:             EstadoJuego::Lobby,
            ronda_actual:       0,
            dados_visibles:     vec![],
            dado_rojo:          None,
            dado_azul:          None,
            jugadores:          vec![],
            segundos_restantes: 0,
            partida_id:         uuid_simple(),
        }
    }

    pub fn lanzar_dados(&mut self) {
        use std::time::{SystemTime, UNIX_EPOCH};
        let seed = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos();
        let mut rng = seed as u64 ^ 0xDEAD_BEEF_CAFE_1234;
        let mut dado = || -> u8 {
            rng ^= rng << 13; rng ^= rng >> 7; rng ^= rng << 17;
            ((rng % 6) + 1) as u8
        };
        self.dados_visibles = (0..9).map(|_| dado()).collect();
        self.dado_rojo      = Some(dado());
        self.dado_azul      = Some(dado());
    }

    pub fn evaluar_combinacion(valores: &[u8]) -> Combinacion {
        if valores.len() != 3 { return Combinacion::Single; }
        let mut v = valores.to_vec(); v.sort_unstable();
        if v[0] == v[1] && v[1] == v[2]     { return Combinacion::Triple;   }
        if v[1] == v[0]+1 && v[2] == v[1]+1 { return Combinacion::Escalera; }
        if v[0] == v[1]  || v[1] == v[2]    { return Combinacion::Doble;    }
        Combinacion::Single
    }

    pub fn calcular_puntos_ronda(&mut self) {
        let rojo = self.dado_rojo.unwrap_or(1);
        let azul = self.dado_azul.unwrap_or(1);

        for jugador in self.jugadores.iter_mut() {
            // FIX: visores no tienen jugada, saltar
            if jugador.es_visor { continue; }
            if let Some(jugada) = jugador.jugada_actual.as_mut() {
                let vals: Vec<u8> = jugada.dados_elegidos.iter().map(|d| {
                    match d.as_str() {
                        "rojo" => rojo, "azul" => azul,
                        s => {
                            let idx: usize = s.trim_start_matches("visible_").parse().unwrap_or(0);
                            *self.dados_visibles.get(idx).unwrap_or(&1)
                        }
                    }
                }).collect();
                jugada.combinacion = Some(Self::evaluar_combinacion(&vals));
            }
        }

        // FIX: ranking solo con jugadores reales (no visores)
        let mut ranking: Vec<(usize, Combinacion)> = self.jugadores.iter().enumerate()
            .filter_map(|(i, j)| {
                if !j.conectado || j.es_visor { return None; }
                j.jugada_actual.as_ref().and_then(|jug| jug.combinacion.clone()).map(|c| (i, c))
            }).collect();
        ranking.sort_by(|a, b| b.1.cmp(&a.1));

        let n = ranking.len();
        let pts_pos = |pos: usize| -> i32 {
            if pos == n.saturating_sub(1) { return 0; }
            match pos { 0 => 6, 1 => 3, 2 => 1, _ => 0 }
        };

        let mut pos = 0usize;
        while pos < ranking.len() {
            let combo = &ranking[pos].1;
            let mut fin = pos + 1;
            while fin < ranking.len() && &ranking[fin].1 == combo { fin += 1; }
            let suma: i32 = (pos..fin).map(|p| pts_pos(p)).sum();
            let cada_uno  = suma / (fin - pos) as i32;
            for &(idx, _) in &ranking[pos..fin] {
                self.jugadores[idx].jugada_actual.as_mut().unwrap().puntos_ronda = Some(cada_uno);
            }
            pos = fin;
        }

        for jugador in self.jugadores.iter_mut() {
            // FIX: visores no acumulan puntos
            if jugador.es_visor { continue; }
            if let Some(jugada) = jugador.jugada_actual.as_mut() {
                let base  = jugada.puntos_ronda.unwrap_or(0);
                let bonus = Self::calcular_bonus(&jugada.prediccion, base);
                jugada.puntos_ronda   = Some(base + bonus);
                jugador.puntos_total += base + bonus;
            }
        }
    }

    pub fn calcular_bonus(pred: &Prediccion, base: i32) -> i32 {
        let ok = match pred {
            Prediccion::Cero => base == 0, Prediccion::Uno  => base == 1,
            Prediccion::Tres => base == 3, Prediccion::Seis => base == 6,
        };
        if !ok { return 0; }
        if *pred == Prediccion::Cero { BONUS_CERO } else { base }
    }

    // FIX: todos_jugaron ignora visores
    pub fn todos_jugaron(&self) -> bool {
        self.jugadores.iter()
            .filter(|j| j.conectado && !j.es_visor)
            .all(|j| j.jugada_actual.is_some())
    }

    // FIX: jugadores_conectados ignora visores
    pub fn jugadores_conectados(&self) -> usize {
        self.jugadores.iter()
            .filter(|j| j.conectado && !j.es_visor)
            .count()
    }

    // FIX: jugadores_listos ignora visores
    pub fn jugadores_listos(&self) -> usize {
        self.jugadores.iter()
            .filter(|j| j.conectado && j.listo && !j.es_visor)
            .count()
    }

    pub fn preparar_siguiente_ronda(&mut self) {
        for j in self.jugadores.iter_mut() { j.jugada_actual = None; }
    }
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "tipo")]
pub enum MensajeServidor {
    NombreAceptado     { nombre: String },
    ListaSalas         { salas: Vec<InfoSala> },
    SalaCreada         { sala_id: String, nombre_sala: String, anfitrion: String },
    SalaUnido          { sala_id: String, nombre_sala: String, anfitrion: String,
                        jugadores: Vec<InfoJugadorSala>, minimo: usize, maximo: usize },
    SalaActualizada    { sala_id: String, jugadores: Vec<InfoJugadorSala>,
                        total: usize, minimo: usize, maximo: usize },
    JuegoIniciado      { sala_id: String, mensaje: String, total_rondas: u8, jugadores: Vec<String> },
    RondaIniciada      { sala_id: String, ronda: u8, total_rondas: u8,
                        dados_visibles: Vec<u8>, segundos: u8 },
    TiempoRestante     { sala_id: String, segundos: u8, jugaron_ya: usize, total_activos: usize },
    // FIX: cuenta regresiva dedicada entre rondas (no confundir con timer de jugada)
    // El cliente muestra "Próxima ronda en X..." y cuando segundos=0 prepara RondaIniciada
    ProximaRonda       { sala_id: String, ronda_siguiente: u8, segundos: u8 },
    ResultadosRonda    { sala_id: String, ronda: u8, dado_rojo: u8, dado_azul: u8,
                        ranking: Vec<ResultadoJugador> },
    FinJuego           { sala_id: String, tabla_final: Vec<ResultadoJugador>,
                        ganador: String, perdedor: String, mensaje: String },
    JugadaRecibida     { sala_id: String, nombre: String, jugaron_ya: usize, total_activos: usize },
    JugadorDesconectado{ sala_id: String, nombre: String, mensaje: String, total: usize },
    SalaSalida         { sala_id: String, mensaje: String },
    Error              { mensaje: String },
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InfoSala {
    pub sala_id:     String,
    pub nombre_sala: String,
    pub anfitrion:   String,
    pub jugadores:   usize,
    pub maximo:      usize,
    pub en_juego:    bool,
}

// FIX: InfoJugadorSala ahora expone es_visor para que React Native filtre en UI
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct InfoJugadorSala {
    pub nombre:    String,
    pub listo:     bool,
    pub anfitrion: bool,
    pub es_visor:  bool,
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

#[derive(Serialize, Deserialize, Debug)]
#[serde(tag = "tipo")]
pub enum MensajeCliente {
    Unirse       { nombre: String },
    ListarSalas,
    CrearSala    { nombre_sala: String },
    // FIX: como_visor es opcional; true = visor web, ausente/false = jugador real
    UnirseSala   { sala_id: String, como_visor: Option<bool> },
    SalirDeSala  { sala_id: String },
    ToggleListo  { sala_id: String },
    IniciarJuego { sala_id: String },
    SubmitJugada { sala_id: String, dados_elegidos: Vec<String>, prediccion: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum LogNivel { Info, Warn, Error }

async fn conectar_mongo() -> Option<Mongo> {
    match ClientOptions::parse(MONGO_URI).await {
        Err(e) => { eprintln!("[MongoDB] ⚠️  {e}"); None }
        Ok(opts) => match MongoClient::with_options(opts) {
            Err(e) => { eprintln!("[MongoDB] ⚠️  {e}"); None }
            Ok(c)  => { println!("[MongoDB] ✓ Conectado"); Some(Arc::new(c)) }
        }
    }
}

async fn log_mongo(mongo: &Option<Mongo>, nivel: LogNivel, evento: &str, detalle: impl Serialize) {
    let Some(c) = mongo else { return; };
    let col = c.database(MONGO_DB).collection::<mongodb::bson::Document>("logs");
    let det = to_bson(&detalle).unwrap_or(mongodb::bson::Bson::Null);
    let doc = doc! { "ts": DateTime::now(), "nivel": format!("{:?}", nivel), "evento": evento, "detalle": det };
    if let Err(e) = col.insert_one(doc).await { eprintln!("[MongoDB] log error: {e}"); }
}

async fn guardar_partida(mongo: &Option<Mongo>, sala_id: &str, partida_id: &str,
    jugadores: &[ResultadoJugador], ganador: &str, perdedor: &str)
{
    let Some(c) = mongo else { return; };
    let col = c.database(MONGO_DB).collection::<mongodb::bson::Document>("partidas");
    let jbson = to_bson(jugadores).unwrap_or(mongodb::bson::Bson::Array(vec![]));
    let doc = doc! {
        "sala_id": sala_id, "partida_id": partida_id, "ts_fin": DateTime::now(),
        "ganador": ganador, "perdedor": perdedor,
        "total_rondas": TOTAL_RONDAS as i32, "jugadores": jbson,
    };
    match col.insert_one(doc).await {
        Ok(_)  => println!("[MongoDB] ✓ Partida {partida_id} guardada."),
        Err(e) => eprintln!("[MongoDB] ⚠️  guardar_partida: {e}"),
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(PUERTO).await?;
    let clients: TxMap = Arc::new(Mutex::new(HashMap::new()));
    let salas:   Salas = Arc::new(Mutex::new(HashMap::new()));
    let mongo          = conectar_mongo().await;
    let mongo          = Arc::new(mongo);

    println!("╔═══════════════════════════════════════════════╗");
    println!("║   Triple Dice  —  Servidor WebSocket (Multi)  ║");
    println!("║   PROYECTO · PHILIP WALKER Y PAULA SANCHEZ    ║");
    println!("╠═══════════════════════════════════════════════╣");
    println!("║  Puerto : {PUERTO}                            ║");
    println!("║  Min    : {MIN_JUGADORES} jugadores           ║");
    println!("║  Rondas : {TOTAL_RONDAS}                      ║");
    println!("╚═══════════════════════════════════════════════╝\n");

    loop {
        let (socket, addr) = listener.accept().await?;
        let c = Arc::clone(&clients);
        let s = Arc::clone(&salas);
        let m = Arc::clone(&mongo);
        tokio::spawn(async move {
            if let Err(e) = handle_connection(socket, addr, c, s, m).await {
                eprintln!("[ERROR] {addr}: {e}");
            }
        });
    }
}

async fn handle_connection(
    mut socket: TcpStream,
    addr: std::net::SocketAddr,
    clients: TxMap,
    salas: Salas,
    mongo: Arc<Option<Mongo>>,
) -> Result<(), Box<dyn std::error::Error>> {

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
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {}\r\n\r\n", accept
    ).as_bytes()).await?;
    println!("[WS] ✓ {addr}");

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    clients.lock().unwrap().insert(addr, tx);

    let (mut reader, mut writer) = socket.split();
    let mut mi_nombre: Option<String> = None;
    let mut mi_sala:   Option<String> = None;

    loop {
        let mut hdr = [0u8; 2];
        tokio::select! {
            res = reader.read_exact(&mut hdr) => {
                if res.is_err() { break; }
                let opcode = hdr[0] & 0x0F;
                if opcode == 0x8 { let _ = writer.write_all(&[0x88,0x00]).await; break; }
                if opcode == 0x9 { let _ = writer.write_all(&[0x8A,0x00]).await; continue; }

                let masked   = (hdr[1] & 0x80) != 0;
                let mut plen = (hdr[1] & 0x7F) as usize;
                if plen == 126 { let mut e=[0u8;2]; reader.read_exact(&mut e).await?; plen=u16::from_be_bytes(e) as usize; }
                else if plen==127 { let mut e=[0u8;8]; reader.read_exact(&mut e).await?; plen=u64::from_be_bytes(e) as usize; }
                let mut mask=[0u8;4];
                if masked { reader.read_exact(&mut mask).await?; }
                let mut raw=vec![0u8;plen]; reader.read_exact(&mut raw).await?;
                let decoded:Vec<u8>=raw.iter().enumerate().map(|(i,b)| if masked {b^mask[i%4]} else {*b}).collect();
                let texto = String::from_utf8_lossy(&decoded).to_string();
                println!("[RX] {} → {}", addr, &texto[..texto.len().min(120)]);

                match serde_json::from_str::<MensajeCliente>(&texto) {

                    Ok(MensajeCliente::Unirse { nombre }) => {
                        mi_nombre = Some(nombre.clone());
                        log_mongo(&*mongo, LogNivel::Info, "ClienteUnido",
                            doc! { "nombre": &nombre, "addr": addr.to_string() }).await;
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::NombreAceptado { nombre })).await?;
                    }

                    Ok(MensajeCliente::ListarSalas) => {
                        let lista: Vec<InfoSala> = salas.lock().unwrap().values().map(|s| InfoSala {
                            sala_id:     s.sala_id.clone(),
                            nombre_sala: s.nombre_sala.clone(),
                            anfitrion:   s.anfitrion.clone(),
                            // FIX: jugadores ya excluye visores via jugadores_conectados()
                            jugadores:   s.jugadores_conectados(),
                            maximo:      MAX_JUGADORES,
                            en_juego:    s.estado != EstadoJuego::Lobby,
                        }).collect();
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::ListaSalas { salas: lista })).await?;
                    }

                    Ok(MensajeCliente::CrearSala { nombre_sala }) => {
                        let nom = match &mi_nombre {
                            Some(n) => n.clone(),
                            None => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: "Registrate primero.".into() })).await?; continue; }
                        };
                        let sala_id = uuid_simple();
                        let mut sala = Sala::nueva(sala_id.clone(), nombre_sala.clone(), nom.clone());
                        sala.jugadores.push(Jugador {
                            nombre: nom.clone(), addr: addr.to_string(),
                            puntos_total: 0, jugada_actual: None,
                            conectado: true, listo: false,
                            es_visor: false, // quien crea la sala siempre es jugador real
                        });
                        let info_jug: Vec<InfoJugadorSala> = sala.jugadores.iter().map(|j| InfoJugadorSala {
                            nombre:    j.nombre.clone(),
                            listo:     j.listo,
                            anfitrion: j.nombre == sala.anfitrion,
                            es_visor:  j.es_visor,
                        }).collect();
                        salas.lock().unwrap().insert(sala_id.clone(), sala);
                        mi_sala = Some(sala_id.clone());
                        log_mongo(&*mongo, LogNivel::Info, "SalaCreada",
                            doc! { "sala_id": &sala_id, "anfitrion": &nom, "nombre_sala": &nombre_sala }).await;
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::SalaCreada {
                            sala_id: sala_id.clone(), nombre_sala: nombre_sala.clone(), anfitrion: nom.clone(),
                        })).await?;
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::SalaUnido {
                            sala_id: sala_id.clone(),
                            nombre_sala,
                            anfitrion: nom,
                            jugadores: info_jug,
                            minimo: MIN_JUGADORES,
                            maximo: MAX_JUGADORES,
                        })).await?;
                    }

                    // FIX: UnirseSala ahora acepta como_visor opcional
                    Ok(MensajeCliente::UnirseSala { sala_id, como_visor }) => {
                        let nom = match &mi_nombre {
                            Some(n) => n.clone(),
                            None => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: "Registrate primero.".into() })).await?; continue; }
                        };
                        let es_visor = como_visor.unwrap_or(false);
                        let res = {
                            let mut s_map = salas.lock().unwrap();
                            if let Some(sala) = s_map.get_mut(&sala_id) {
                                if sala.estado != EstadoJuego::Lobby && !es_visor {
                                    // FIX: visores pueden unirse aunque el juego esté en curso
                                    Err("La sala ya está en juego.".to_string())
                                } else if !es_visor && sala.jugadores_conectados() >= MAX_JUGADORES {
                                    // FIX: el límite de jugadores no aplica a visores
                                    Err(format!("Sala llena ({MAX_JUGADORES} máximo)."))
                                } else {
                                    if let Some(j) = sala.jugadores.iter_mut().find(|j| j.nombre == nom) {
                                        j.conectado = true;
                                        j.addr      = addr.to_string();
                                        // FIX: preservar/actualizar flag de visor si reconecta
                                        j.es_visor  = es_visor;
                                    } else {
                                        sala.jugadores.push(Jugador {
                                            nombre: nom.clone(), addr: addr.to_string(),
                                            puntos_total: 0, jugada_actual: None,
                                            conectado: true, listo: false,
                                            es_visor, // FIX: asignar según lo que envió el cliente
                                        });
                                    }
                                    let info: Vec<InfoJugadorSala> = sala.jugadores.iter().map(|j| InfoJugadorSala {
                                        nombre:    j.nombre.clone(),
                                        listo:     j.listo,
                                        anfitrion: j.nombre == sala.anfitrion,
                                        es_visor:  j.es_visor,
                                    }).collect();
                                    // FIX: total usa jugadores_conectados que ya excluye visores
                                    Ok((sala.nombre_sala.clone(), sala.anfitrion.clone(), info, sala.jugadores_conectados()))
                                }
                            } else { Err("Sala no encontrada.".to_string()) }
                        };
                        match res {
                            Err(m) => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: m })).await?; }
                            Ok((nombre_sala, anfitrion, jugadores, total)) => {
                                mi_sala = Some(sala_id.clone());
                                if es_visor {
                                    println!("[VISOR] '{}' observando sala={}", nom, sala_id);
                                }
                                send_ws_frame(&mut writer, &ser(&MensajeServidor::SalaUnido {
                                    sala_id: sala_id.clone(), nombre_sala, anfitrion,
                                    jugadores: jugadores.clone(),
                                    minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
                                })).await?;
                                broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::SalaActualizada {
                                    sala_id: sala_id.clone(), jugadores, total,
                                    minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
                                }));
                            }
                        }
                    }

                    Ok(MensajeCliente::SalirDeSala { sala_id }) => {
                        let nom = mi_nombre.clone().unwrap_or_default();
                        let total = {
                            let mut s_map = salas.lock().unwrap();
                            if let Some(sala) = s_map.get_mut(&sala_id) {
                                if let Some(j) = sala.jugadores.iter_mut().find(|j| j.nombre == nom) {
                                    j.conectado = false;
                                }
                                // FIX: jugadores_conectados ya excluye visores
                                let t = sala.jugadores_conectados();
                                if sala.jugadores.iter().filter(|j| j.conectado).count() == 0 {
                                    s_map.remove(&sala_id);
                                }
                                t
                            } else { 0 }
                        };
                        mi_sala = None;
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::SalaSalida {
                            sala_id: sala_id.clone(), mensaje: "Saliste de la sala.".into(),
                        })).await?;
                        if total > 0 {
                            let jugadores: Vec<InfoJugadorSala> = {
                                let s_map = salas.lock().unwrap();
                                s_map.get(&sala_id).map(|sala| sala.jugadores.iter().map(|j| InfoJugadorSala {
                                    nombre:    j.nombre.clone(),
                                    listo:     j.listo,
                                    anfitrion: j.nombre == sala.anfitrion,
                                    es_visor:  j.es_visor,
                                }).collect()).unwrap_or_default()
                            };
                            broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::SalaActualizada {
                                sala_id: sala_id.clone(), jugadores, total,
                                minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
                            }));
                        }
                    }

                    Ok(MensajeCliente::ToggleListo { sala_id }) => {
                        let nom = mi_nombre.clone().unwrap_or_default();
                        let res = {
                            let mut s_map = salas.lock().unwrap();
                            if let Some(sala) = s_map.get_mut(&sala_id) {
                                // FIX: visores no pueden marcar listo
                                if sala.jugadores.iter().any(|j| j.nombre == nom && j.es_visor) {
                                    None
                                } else {
                                    if let Some(j) = sala.jugadores.iter_mut().find(|j| j.nombre == nom) {
                                        j.listo = !j.listo;
                                    }
                                    let info: Vec<InfoJugadorSala> = sala.jugadores.iter().map(|j| InfoJugadorSala {
                                        nombre:    j.nombre.clone(),
                                        listo:     j.listo,
                                        anfitrion: j.nombre == sala.anfitrion,
                                        es_visor:  j.es_visor,
                                    }).collect();
                                    Some((info, sala.jugadores_conectados()))
                                }
                            } else { None }
                        };
                        if let Some((jugadores, total)) = res {
                            broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::SalaActualizada {
                                sala_id: sala_id.clone(), jugadores, total,
                                minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
                            }));
                        }
                    }

                    Ok(MensajeCliente::IniciarJuego { sala_id }) => {
                        let nom = mi_nombre.clone().unwrap_or_default();
                        let res = {
                            let mut s_map = salas.lock().unwrap();
                            if let Some(sala) = s_map.get_mut(&sala_id) {
                                if sala.anfitrion != nom {
                                    Err("Solo el anfitrión puede iniciar.".to_string())
                                } else if sala.estado != EstadoJuego::Lobby {
                                    Err("El juego ya está en curso.".to_string())
                                } else if sala.jugadores_conectados() < MIN_JUGADORES {
                                    // FIX: jugadores_conectados ya no cuenta visores
                                    Err(format!("Se necesitan {MIN_JUGADORES} jugadores (hay {}).", sala.jugadores_conectados()))
                                } else {
                                    sala.estado = EstadoJuego::EsperandoJugada;
                                    // FIX: lista de jugadores del juego excluye visores
                                    let nombres: Vec<String> = sala.jugadores.iter()
                                        .filter(|j| j.conectado && !j.es_visor)
                                        .map(|j| j.nombre.clone()).collect();
                                    let pid = sala.partida_id.clone();
                                    Ok((nombres, pid))
                                }
                            } else { Err("Sala no encontrada.".to_string()) }
                        };
                        match res {
                            Err(m) => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: m })).await?; }
                            Ok((nombres, pid)) => {
                                log_mongo(&*mongo, LogNivel::Info, "JuegoIniciado",
                                    doc! { "sala_id": &sala_id, "partida_id": &pid }).await;
                                broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::JuegoIniciado {
                                    sala_id: sala_id.clone(), mensaje: "🎲 ¡Triple Dice comienza!".into(),
                                    total_rondas: TOTAL_RONDAS, jugadores: nombres,
                                }));
                                let sc = Arc::clone(&salas);
                                let cc = Arc::clone(&clients);
                                let mc = Arc::clone(&mongo);
                                let sid = sala_id.clone();
                                tokio::spawn(async move {
                                    if let Err(e) = ejecutar_rondas(sid, sc, cc, mc).await {
                                        eprintln!("[RONDAS] {e}");
                                    }
                                });
                            }
                        }
                    }

                    Ok(MensajeCliente::SubmitJugada { sala_id, dados_elegidos, prediccion }) => {
                        let nom = match &mi_nombre {
                            Some(n) => n.clone(),
                            None => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: "Registrate primero.".into() })).await?; continue; }
                        };

                        // FIX: bloquear submit si el cliente es un visor
                        let es_visor = salas.lock().unwrap()
                            .get(&sala_id)
                            .and_then(|s| s.jugadores.iter().find(|j| j.nombre == nom))
                            .map(|j| j.es_visor)
                            .unwrap_or(false);
                        if es_visor {
                            send_ws_frame(&mut writer, &ser(&MensajeServidor::Error {
                                mensaje: "Los visores no pueden enviar jugadas.".into()
                            })).await?;
                            continue;
                        }

                        if dados_elegidos.len() != 3 {
                            send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: "Elige exactamente 3 dados.".into() })).await?;
                            continue;
                        }
                        let pred = match prediccion.as_str() {
                            "Cero" => Prediccion::Cero, "Uno" => Prediccion::Uno,
                            "Tres" => Prediccion::Tres, "Seis" => Prediccion::Seis,
                            otro => {
                                send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: format!("Predicción '{otro}' inválida.") })).await?;
                                continue;
                            }
                        };
                        let resultado = {
                            let mut s_map = salas.lock().unwrap();
                            if let Some(sala) = s_map.get_mut(&sala_id) {
                                if sala.estado != EstadoJuego::EsperandoJugada {
                                    Err("No hay ronda activa.".to_string())
                                } else if sala.jugadores.iter().any(|j| j.nombre == nom && j.jugada_actual.is_some()) {
                                    Err("Ya enviaste tu jugada.".to_string())
                                } else {
                                    if let Some(j) = sala.jugadores.iter_mut().find(|j| j.nombre == nom) {
                                        j.jugada_actual = Some(JugadaRonda {
                                            dados_elegidos: dados_elegidos.clone(), prediccion: pred,
                                            combinacion: None, puntos_ronda: None,
                                        });
                                    }
                                    // FIX: conteos excluyen visores via jugadores_conectados()
                                    let ya    = sala.jugadores.iter().filter(|j| j.conectado && !j.es_visor && j.jugada_actual.is_some()).count();
                                    let total = sala.jugadores_conectados();
                                    let ronda = sala.ronda_actual;
                                    Ok((ya, total, ronda))
                                }
                            } else { Err("Sala no encontrada.".to_string()) }
                        };
                        match resultado {
                            Err(m) => { send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: m })).await?; }
                            Ok((ya, total, ronda)) => {
                                println!("[JUGADA] '{nom}' sala={sala_id} ronda={ronda} ({ya}/{total})");
                                send_ws_frame(&mut writer, &ser(&MensajeServidor::JugadaRecibida {
                                    sala_id: sala_id.clone(), nombre: nom, jugaron_ya: ya, total_activos: total,
                                })).await?;
                            }
                        }
                    }

                    Err(e) => {
                        send_ws_frame(&mut writer, &ser(&MensajeServidor::Error { mensaje: format!("JSON inválido: {e}") })).await?;
                    }
                }
            }

            Some(msg) = rx.recv() => {
                if send_ws_frame(&mut writer, &msg).await.is_err() { break; }
            }
        }
    }

    clients.lock().unwrap().remove(&addr);
    if let (Some(nom), Some(sala_id)) = (&mi_nombre, &mi_sala) {
        let total = {
            let mut s_map = salas.lock().unwrap();
            if let Some(sala) = s_map.get_mut(sala_id) {
                if let Some(j) = sala.jugadores.iter_mut().find(|j| j.nombre == *nom) { j.conectado = false; }
                // FIX: jugadores_conectados excluye visores
                let t = sala.jugadores_conectados();
                if sala.jugadores.iter().filter(|j| j.conectado).count() == 0 {
                    s_map.remove(sala_id);
                }
                t
            } else { 0 }
        };
        if total > 0 {
            let jugadores: Vec<InfoJugadorSala> = {
                let s_map = salas.lock().unwrap();
                s_map.get(sala_id).map(|s| s.jugadores.iter().map(|j| InfoJugadorSala {
                    nombre:    j.nombre.clone(),
                    listo:     j.listo,
                    anfitrion: j.nombre == s.anfitrion,
                    es_visor:  j.es_visor,
                }).collect()).unwrap_or_default()
            };
            broadcast_sala(&clients, &salas, sala_id, &ser(&MensajeServidor::JugadorDesconectado {
                sala_id: sala_id.clone(), nombre: nom.clone(),
                mensaje: format!("⚠️ {nom} se desconectó."), total,
            }));
            broadcast_sala(&clients, &salas, sala_id, &ser(&MensajeServidor::SalaActualizada {
                sala_id: sala_id.clone(), jugadores, total, minimo: MIN_JUGADORES, maximo: MAX_JUGADORES,
            }));
        }
        println!("[WS] ✗ '{nom}' ({addr})");
    }
    Ok(())
}

async fn ejecutar_rondas(
    sala_id: String,
    salas: Salas,
    clients: TxMap,
    mongo: Arc<Option<Mongo>>,
) -> Result<(), Box<dyn std::error::Error>> {

    let partida_id = { salas.lock().unwrap().get(&sala_id).map(|s| s.partida_id.clone()).unwrap_or_default() };

    for ronda in 1u8..=TOTAL_RONDAS {
        println!("\n[SALA {sala_id}][RONDA {ronda}] ══════ Iniciando ══════");

        let msg = {
            let mut s_map = salas.lock().unwrap();
            if let Some(sala) = s_map.get_mut(&sala_id) {
                sala.ronda_actual = ronda;
                sala.estado       = EstadoJuego::EsperandoJugada;
                sala.lanzar_dados();
                sala.preparar_siguiente_ronda();
                ser(&MensajeServidor::RondaIniciada {
                    sala_id: sala_id.clone(), ronda, total_rondas: TOTAL_RONDAS,
                    dados_visibles: sala.dados_visibles.clone(), segundos: SEGUNDOS_RONDA,
                })
            } else { return Ok(()); }
        };
        broadcast_sala(&clients, &salas, &sala_id, &msg);

        // --- timer de la ronda ---
        let mut todos_jugaron_temprano = false;
        for seg in (1u8..=SEGUNDOS_RONDA).rev() {
            sleep(Duration::from_secs(1)).await;
            let (todos, ya, total) = {
                let s = salas.lock().unwrap();
                if let Some(sala) = s.get(&sala_id) {
                    let ya    = sala.jugadores.iter().filter(|j| j.conectado && !j.es_visor && j.jugada_actual.is_some()).count();
                    let total = sala.jugadores_conectados();
                    (sala.todos_jugaron(), ya, total)
                } else { break; }
            };
            if todos {
                // FIX: avisar al cliente que el timer terminó antes de mostrar resultados
                broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::TiempoRestante {
                    sala_id: sala_id.clone(), segundos: 0, jugaron_ya: ya, total_activos: total,
                }));
                todos_jugaron_temprano = true;
                break;
            }
            if seg % 5 == 0 || seg <= 5 {
                broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::TiempoRestante {
                    sala_id: sala_id.clone(), segundos: seg, jugaron_ya: ya, total_activos: total,
                }));
            }
        }

        // FIX: pausa generosa para que React Native procese TiempoRestante=0
        // y navegue a la pantalla de "calculando" antes de recibir ResultadosRonda.
        // Si todos jugaron temprano damos 3s; si se agotó el timer damos 2s.
        if todos_jugaron_temprano {
            sleep(Duration::from_secs(3)).await;
        } else {
            sleep(Duration::from_secs(2)).await;
        }

        let msg_res = {
            let mut s_map = salas.lock().unwrap();
            if let Some(sala) = s_map.get_mut(&sala_id) {
                sala.estado = EstadoJuego::Revelando;
                sala.calcular_puntos_ronda();
                let rojo = sala.dado_rojo.unwrap_or(1);
                let azul = sala.dado_azul.unwrap_or(1);
                // FIX: ranking solo con jugadores reales
                let mut ranking: Vec<ResultadoJugador> = sala.jugadores.iter()
                    .filter(|j| j.conectado && !j.es_visor)
                    .map(|j| {
                        let jug  = j.jugada_actual.as_ref();
                        let base = jug.and_then(|x| x.puntos_ronda).unwrap_or(0);
                        let bonus = jug.map(|x| Sala::calcular_bonus(&x.prediccion, base)).unwrap_or(0);
                        ResultadoJugador {
                            nombre: j.nombre.clone(),
                            combinacion: jug.and_then(|x| x.combinacion.as_ref()).map(|c| format!("{c:?}")).unwrap_or_default(),
                            dados: jug.map(|x| x.dados_elegidos.clone()).unwrap_or_default(),
                            puntos_ronda: base, puntos_total: j.puntos_total,
                            prediccion: jug.map(|x| format!("{:?}", x.prediccion)).unwrap_or_default(),
                            acierto: bonus > 0, bonus,
                        }
                    }).collect();
                ranking.sort_by(|a, b| b.puntos_ronda.cmp(&a.puntos_ronda));
                ser(&MensajeServidor::ResultadosRonda {
                    sala_id: sala_id.clone(), ronda, dado_rojo: rojo, dado_azul: azul, ranking,
                })
            } else { return Ok(()); }
        };
        broadcast_sala(&clients, &salas, &sala_id, &msg_res);

        // FIX: cuenta regresiva dedicada entre rondas usando ProximaRonda
        // El cliente puede distinguirla del timer de jugada y preparar la UI
        if ronda < TOTAL_RONDAS {
            let ronda_sig = ronda + 1;
            for cuenta in (1u8..=15).rev() {
                sleep(Duration::from_secs(1)).await;
                // Enviar ProximaRonda en momentos clave para no saturar el canal
                if cuenta <= 10 {
                    broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::ProximaRonda {
                        sala_id: sala_id.clone(),
                        ronda_siguiente: ronda_sig,
                        segundos: cuenta,
                    }));
                }
            }
            // ProximaRonda con segundos=0 señala "ya viene" — el cliente limpia estado
            broadcast_sala(&clients, &salas, &sala_id, &ser(&MensajeServidor::ProximaRonda {
                sala_id: sala_id.clone(),
                ronda_siguiente: ronda_sig,
                segundos: 0,
            }));
            // Pausa final — el cliente tiene tiempo de limpiar antes de RondaIniciada
            sleep(Duration::from_secs(2)).await;
        }
    }

    let msg_fin = {
        let mut s_map = salas.lock().unwrap();
        if let Some(sala) = s_map.get_mut(&sala_id) {
            sala.estado = EstadoJuego::FinJuego;
            // FIX: tabla final solo con jugadores reales
            let mut tabla: Vec<ResultadoJugador> = sala.jugadores.iter()
                .filter(|j| j.conectado && !j.es_visor)
                .map(|j| ResultadoJugador {
                    nombre: j.nombre.clone(), combinacion: String::new(), dados: vec![],
                    puntos_ronda: 0, puntos_total: j.puntos_total,
                    prediccion: String::new(), acierto: false, bonus: 0,
                }).collect();
            tabla.sort_by(|a, b| b.puntos_total.cmp(&a.puntos_total));
            let ganador  = tabla.first().map(|j| j.nombre.clone()).unwrap_or_default();
            let perdedor = tabla.last().map(|j|  j.nombre.clone()).unwrap_or_default();

            let mc = Arc::clone(&mongo);
            let sid2 = sala_id.clone();
            let pid2 = partida_id.clone();
            let tab2 = tabla.clone();
            let gan2 = ganador.clone();
            let per2 = perdedor.clone();
            tokio::spawn(async move {
                guardar_partida(&*mc, &sid2, &pid2, &tab2, &gan2, &per2).await;
            });

            sala.estado       = EstadoJuego::Lobby;
            sala.ronda_actual = 0;
            sala.dados_visibles = vec![];
            sala.dado_rojo = None; sala.dado_azul = None;
            sala.partida_id = uuid_simple();
            for j in sala.jugadores.iter_mut() {
                j.puntos_total = 0; j.jugada_actual = None; j.listo = false;
            }

            ser(&MensajeServidor::FinJuego {
                sala_id: sala_id.clone(), tabla_final: tabla,
                ganador: ganador.clone(), perdedor: perdedor.clone(),
                mensaje: format!("🏆 {ganador} ganó. ☠️ {perdedor} eliminado."),
            })
        } else { return Ok(()); }
    };
    broadcast_sala(&clients, &salas, &sala_id, &msg_fin);
    Ok(())
}

fn ser(msg: &MensajeServidor) -> String {
    serde_json::to_string(msg).unwrap_or_else(|_| r#"{"tipo":"Error","mensaje":"error interno"}"#.into())
}

fn broadcast_sala(clients: &TxMap, salas: &Salas, sala_id: &str, msg: &str) {
    // FIX: broadcast incluye visores (solo lectura está bien, solo no cuentan como jugadores)
    let addrs: Vec<String> = salas.lock().unwrap()
        .get(sala_id).map(|s| s.jugadores.iter().filter(|j| j.conectado).map(|j| j.addr.clone()).collect())
        .unwrap_or_default();
    if let Ok(c) = clients.lock() {
        for (addr, tx) in c.iter() {
            if addrs.contains(&addr.to_string()) { let _ = tx.send(msg.to_string()); }
        }
    }
}

async fn send_ws_frame(writer: &mut tokio::net::tcp::WriteHalf<'_>, text: &str)
    -> Result<(), Box<dyn std::error::Error>>
{
    let p = text.as_bytes();
    let mut h = Vec::with_capacity(10);
    h.push(0x81u8);
    match p.len() {
        n if n <= 125   => h.push(n as u8),
        n if n <= 65535 => { h.push(126); h.extend_from_slice(&(n as u16).to_be_bytes()); }
        n               => { h.push(127); h.extend_from_slice(&(n as u64).to_be_bytes()); }
    }
    writer.write_all(&h).await?;
    writer.write_all(p).await?;
    Ok(())
}

// FIX: wrapping_mul evita overflow en debug mode (cargo run)
fn uuid_simple() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let t = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().subsec_nanos();
    let mixed = (t as u64).wrapping_mul(0x517CC1B727220A95);
    format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
        t, t >> 16, t & 0xFFF, (t >> 8) & 0x3FFF | 0x8000, mixed)
}