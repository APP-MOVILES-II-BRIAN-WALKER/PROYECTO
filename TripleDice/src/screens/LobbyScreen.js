/**
 * screens/LobbyScreen.js — Triple Dice (Multi-Sala)
 *
 * FIXES:
 * - Listener seguro: onMensaje(listener) devuelve unsubscribe.
 * - Lobby ya no borra todos los listeners del socket.
 * - Filtra visores en UI.
 * - Evita navegar al juego por mensajes de otra sala.
 *
 * Fase 1 — CONEXIÓN: IP + nombre → Conectar
 * Fase 2 — SALAS: lista de salas abiertas + Crear sala
 * Fase 3 — SALA: jugadores listo/no-listo + iniciar partida
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  ActivityIndicator,
  Modal,
} from 'react-native';

import {
  iniciarConexion,
  onMensaje,
  desconectar,
} from '../services/socket';

import { enviarMensaje } from '../services/socket';

import S, { COLORS, SPACING, RADIUS } from '../styles/style_01';

const TOTAL_RONDAS_DISPLAY = 4;
const MIN_JUG_DISPLAY = 2;
const MAX_JUG_DISPLAY = 10;

const REGLAS = [
  {
    icono: '🎲',
    texto: 'Se lanzan 9 dados visibles + 1 rojo oculto + 1 azul oculto.',
  },
  {
    icono: '✋',
    texto: 'Elegí exactamente 3 dados (visibles u ocultos).',
  },
  {
    icono: '🔮',
    texto: 'Predecí cuántos puntos sacarás: Cero | Uno | Tres | Seis.',
  },
  {
    icono: '🏆',
    texto: '1.° lugar → 6 pts · 2.° → 3 pts · 3.° → 1 pt · último → 0 pts.',
  },
  {
    icono: '⚡',
    texto: 'Acertar la predicción duplica los puntos. Predecir Cero y acertar suma 20 pts extra.',
  },
  {
    icono: '🔁',
    texto: 'Se juegan 4 rondas. Al final, el de mayor puntaje gana y el de menor es eliminado.',
  },
  {
    icono: '⏱️',
    texto: 'Tenés tiempo limitado por ronda para confirmar tu jugada.',
  },
];

export default function LobbyScreen({ navigation }) {
  const [fase, setFase] = useState('conexion');

  const [ip, setIp] = useState('');
  const [nombre, setNombre] = useState('');
  const [conectando, setConectando] = useState(false);

  const [salas, setSalas] = useState([]);
  const [cargandoSalas, setCargandoSalas] = useState(false);
  const [modalCrear, setModalCrear] = useState(false);
  const [nombreSala, setNombreSala] = useState('');
  const [creando, setCreando] = useState(false);

  const [salaActual, setSalaActual] = useState(null);
  const [jugadoresSala, setJugadoresSala] = useState([]);
  const [minimo, setMinimo] = useState(2);
  const [maximo, setMaximo] = useState(10);
  const [iniciando, setIniciando] = useState(false);
  const [modalReglas, setModalReglas] = useState(false);

  const [error, setError] = useState('');

  const miNombreRef = useRef('');
  const salaIdRef = useRef('');
  const handleMensajeRef = useRef(null);
  const navigationRef = useRef(navigation);

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    handleMensajeRef.current = handleMensaje;
  });

  /**
   * FIX IMPORTANTE:
   * No usar return () => offMensaje();
   * Eso borraba todos los listeners y podía dejar a JuegoScreen sin socket.
   */
  useEffect(() => {
    const listener = (msg) => {
      if (handleMensajeRef.current) {
        handleMensajeRef.current(msg);
      }
    };

    const unsubscribe = onMensaje(listener);

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, []);

  function jugadoresReales(lista) {
    return (lista || []).filter((j) => j && !j.es_visor);
  }

  function handleMensaje(msg) {
    if (!msg || !msg.tipo) return;

    switch (msg.tipo) {
      case 'NombreAceptado': {
        setError('');
        setConectando(false);
        setFase('salas');
        pedirListaSalas();
        break;
      }

      case 'ListaSalas': {
        setError('');
        setSalas(msg.salas || []);
        setCargandoSalas(false);
        break;
      }

      case 'SalaCreada': {
        // No hacemos nada aquí porque inmediatamente llega SalaUnido.
        break;
      }

      case 'SalaUnido': {
        setError('');
        setCreando(false);
        setModalCrear(false);
        setNombreSala('');

        salaIdRef.current = msg.sala_id;

        setSalaActual({
          sala_id: msg.sala_id,
          nombre_sala: msg.nombre_sala,
          anfitrion: msg.anfitrion,
        });

        setJugadoresSala(msg.jugadores || []);
        setMinimo(msg.minimo);
        setMaximo(msg.maximo);
        setFase('sala');
        setIniciando(false);
        break;
      }

      case 'SalaActualizada': {
        if (msg.sala_id !== salaIdRef.current) return;

        setError('');
        setJugadoresSala(msg.jugadores || []);
        setMinimo(msg.minimo);
        setMaximo(msg.maximo);
        break;
      }

      case 'JugadorDesconectado': {
        // Lo actualiza SalaActualizada. No hace falta mostrar alerta.
        break;
      }

      case 'JuegoIniciado': {
        // FIX: navegar solo si es nuestra sala.
        if (msg.sala_id !== salaIdRef.current) return;

        setError('');
        setIniciando(false);

        navigationRef.current.replace('Juego', {
          miNombre: miNombreRef.current,
          salaId: msg.sala_id,
          jugadores: msg.jugadores || [],
          totalRondas: msg.total_rondas,
        });

        break;
      }

      case 'SalaSalida': {
        setError('');
        setFase('salas');
        setSalaActual(null);
        setJugadoresSala([]);
        salaIdRef.current = '';
        pedirListaSalas();
        break;
      }

      case 'Error': {
        setError(msg.mensaje || 'Error desconocido.');
        setConectando(false);
        setCreando(false);
        setIniciando(false);
        setCargandoSalas(false);
        break;
      }

      case '_Desconectado': {
        setFase('conexion');
        setSalaActual(null);
        setJugadoresSala([]);
        setSalas([]);
        salaIdRef.current = '';
        setConectando(false);
        setCreando(false);
        setIniciando(false);
        setCargandoSalas(false);
        setError('Conexión perdida con el servidor.');
        break;
      }

      default:
        break;
    }
  }

  function pedirListaSalas() {
    setCargandoSalas(true);
    enviarMensaje({ tipo: 'ListarSalas' });
  }

  function handleConectar() {
    setError('');

    const ipT = ip.trim();
    const nomT = nombre.trim();

    if (!ipT) {
      setError('Ingresá la IP del servidor.');
      return;
    }

    if (!nomT) {
      setError('Ingresá tu nombre.');
      return;
    }

    if (nomT.length > 20) {
      setError('El nombre no puede superar 20 caracteres.');
      return;
    }

    miNombreRef.current = nomT;
    setConectando(true);

    iniciarConexion(ipT)
      .then(() => {
        setTimeout(() => {
          enviarMensaje({
            tipo: 'Unirse',
            nombre: nomT,
          });
        }, 50);
      })
      .catch((e) => {
        setError(e.message);
        setConectando(false);
      });
  }

  function handleCrearSala() {
    const nom = nombreSala.trim() || `Sala de ${miNombreRef.current}`;
    setCreando(true);

    enviarMensaje({
      tipo: 'CrearSala',
      nombre_sala: nom,
    });
  }

  function handleUnirseSala(sala_id) {
    enviarMensaje({
      tipo: 'UnirseSala',
      sala_id,
    });
  }

  function handleToggleListo() {
    if (!salaIdRef.current) return;

    enviarMensaje({
      tipo: 'ToggleListo',
      sala_id: salaIdRef.current,
    });
  }

  function handleIniciar() {
    if (jugadoresConectados < minimo) {
      setError(
        `Se necesitan al menos ${minimo} jugadores (hay ${jugadoresConectados}).`
      );
      return;
    }

    setIniciando(true);

    enviarMensaje({
      tipo: 'IniciarJuego',
      sala_id: salaIdRef.current,
    });
  }

  function handleSalirDeSala() {
    if (!salaIdRef.current) return;

    enviarMensaje({
      tipo: 'SalirDeSala',
      sala_id: salaIdRef.current,
    });
  }

  function handleDesconectar() {
    desconectar();

    setFase('conexion');
    setSalas([]);
    setSalaActual(null);
    setJugadoresSala([]);
    setError('');
    setConectando(false);
    setCreando(false);
    setIniciando(false);
    setCargandoSalas(false);

    salaIdRef.current = '';
  }

  const jugadoresRealesSala = jugadoresReales(jugadoresSala);

  const soyAnfitrion =
    salaActual && salaActual.anfitrion === miNombreRef.current;

  const jugadoresConectados = jugadoresRealesSala.length;

  const jugadoresListos = jugadoresRealesSala.filter((j) => j.listo).length;

  const miJugador = jugadoresRealesSala.find(
    (j) => j.nombre === miNombreRef.current
  );

  const estoyListo = miJugador?.listo ?? false;

  const puedeIniciar =
    soyAnfitrion && jugadoresConectados >= minimo && !iniciando;

  // ==========================================================================
  // RENDER — CONEXIÓN
  // ==========================================================================
  if (fase === 'conexion') {
    return (
      <View style={S.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

        <ScrollView contentContainerStyle={[S.scroll, styles.centrado]}>
          <View style={S.header}>
            <Text style={styles.logo}>🎲</Text>
            <Text style={S.headerTitle}>TRIPLE DICE</Text>
            <Text style={S.headerSubtitle}>ITI-721 · WALKER & SANCHEZ</Text>
          </View>

          <View style={[S.card, styles.formCard]}>
            <Text style={S.cardLabel}>SERVIDOR</Text>

            <TextInput
              style={S.input}
              placeholder="IP del servidor  ej: 192.168.1.10"
              placeholderTextColor={COLORS.textMuted}
              value={ip}
              onChangeText={setIp}
              autoCapitalize="none"
              keyboardType="default"
              returnKeyType="next"
            />

            <Text style={[S.cardLabel, { marginTop: SPACING.sm }]}>
              TU NOMBRE
            </Text>

            <TextInput
              style={S.input}
              placeholder="Juan, Paula, …"
              placeholderTextColor={COLORS.textMuted}
              value={nombre}
              onChangeText={setNombre}
              autoCapitalize="words"
              maxLength={20}
              returnKeyType="done"
              onSubmitEditing={handleConectar}
            />

            {!!error && (
              <View style={S.errorBox}>
                <Text style={S.errorText}>{error}</Text>
              </View>
            )}

            <TouchableOpacity
              style={[
                S.btn,
                S.btnPrimary,
                styles.btnConectar,
                conectando && S.btnDisabled,
              ]}
              onPress={handleConectar}
              disabled={conectando}
            >
              {conectando ? (
                <ActivityIndicator color={COLORS.bg} />
              ) : (
                <Text style={[S.btnText, { color: COLORS.bg }]}>
                  CONECTAR
                </Text>
              )}
            </TouchableOpacity>
          </View>

          <View style={[S.card, { gap: 6 }]}>
            <Text style={S.cardLabel}>CÓMO JUGAR</Text>

            {REGLAS.slice(0, 4).map((r, i) => (
              <Text key={i} style={styles.reglaTxt}>
                {r.icono} {r.texto}
              </Text>
            ))}
          </View>
        </ScrollView>
      </View>
    );
  }

  // ==========================================================================
  // RENDER — SALAS
  // ==========================================================================
  if (fase === 'salas') {
    return (
      <View style={S.screen}>
        <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

        <ScrollView contentContainerStyle={S.scroll}>
          <View style={S.header}>
            <Text style={S.headerTitle}>🎲 SALAS</Text>

            <View style={[S.row, { gap: 6, marginTop: SPACING.sm }]}>
              <View style={S.dotVerde} />

              <Text
                style={{
                  color: COLORS.verde,
                  fontSize: 13,
                  fontWeight: '600',
                }}
              >
                {miNombreRef.current}
              </Text>

              <TouchableOpacity onPress={handleDesconectar}>
                <Text style={{ color: COLORS.textMuted, fontSize: 12 }}>
                  {'  '}Salir
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={S.card}>
            <View style={[S.rowBetween, { marginBottom: SPACING.sm }]}>
              <Text style={S.cardLabel}>SALAS DISPONIBLES</Text>

              <TouchableOpacity
                onPress={pedirListaSalas}
                style={styles.btnActualizar}
              >
                {cargandoSalas ? (
                  <ActivityIndicator size="small" color={COLORS.accent} />
                ) : (
                  <Text style={styles.btnActualizarTxt}>↻ ACTUALIZAR</Text>
                )}
              </TouchableOpacity>
            </View>

            {salas.length === 0 && !cargandoSalas && (
              <Text style={styles.sinSalas}>
                No hay salas abiertas. ¡Creá la primera!
              </Text>
            )}

            {salas.map((sala) => (
              <View key={sala.sala_id} style={styles.filaSala}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.salaNombre}>{sala.nombre_sala}</Text>

                  <Text style={styles.salaInfo}>
                    Anfitrión: {sala.anfitrion} · {sala.jugadores}/
                    {sala.maximo} jugadores
                    {sala.en_juego ? '  🔴 En juego' : '  🟢 Abierta'}
                  </Text>
                </View>

                <TouchableOpacity
                  style={[styles.btnUnirse, sala.en_juego && S.btnDisabled]}
                  onPress={() => !sala.en_juego && handleUnirseSala(sala.sala_id)}
                  disabled={sala.en_juego}
                >
                  <Text style={styles.btnUnirseTxt}>
                    {sala.en_juego ? 'En juego' : 'UNIRSE'}
                  </Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>

          {!!error && (
            <View style={S.errorBox}>
              <Text style={S.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[S.btn, S.btnPrimary]}
            onPress={() => setModalCrear(true)}
          >
            <Text style={[S.btnText, { color: COLORS.bg }]}>
              + CREAR NUEVA SALA
            </Text>
          </TouchableOpacity>
        </ScrollView>

        <Modal visible={modalCrear} transparent animationType="fade">
          <View style={styles.modalOverlay}>
            <View style={styles.modalBox}>
              <Text style={styles.modalTitulo}>NUEVA SALA</Text>

              <TextInput
                style={S.input}
                placeholder={`Sala de ${miNombreRef.current}`}
                placeholderTextColor={COLORS.textMuted}
                value={nombreSala}
                onChangeText={setNombreSala}
                autoCapitalize="sentences"
                maxLength={30}
              />

              <View style={styles.modalBotones}>
                <TouchableOpacity
                  style={[S.btn, S.btnSecondary, { flex: 1 }]}
                  onPress={() => {
                    setModalCrear(false);
                    setNombreSala('');
                  }}
                >
                  <Text style={S.btnTextLight}>CANCELAR</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    S.btn,
                    S.btnPrimary,
                    { flex: 1 },
                    creando && S.btnDisabled,
                  ]}
                  onPress={handleCrearSala}
                  disabled={creando}
                >
                  {creando ? (
                    <ActivityIndicator color={COLORS.bg} />
                  ) : (
                    <Text style={[S.btnText, { color: COLORS.bg }]}>
                      CREAR
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </View>
    );
  }

  // ==========================================================================
  // RENDER — SALA DE ESPERA
  // ==========================================================================
  return (
    <View style={S.screen}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView contentContainerStyle={S.scroll}>
        <View style={S.header}>
          <Text style={S.headerTitle}>
            🎲 {salaActual?.nombre_sala ?? 'SALA'}
          </Text>

          <Text style={styles.headerSub}>
            Anfitrión: {salaActual?.anfitrion}
            {soyAnfitrion ? ' (vos)' : ''}
          </Text>
        </View>

        <View style={S.card}>
          <View style={[S.rowBetween, { marginBottom: SPACING.sm }]}>
            <Text style={S.cardLabel}>
              JUGADORES ({jugadoresConectados}/{maximo} · mín {minimo})
            </Text>

            <Text style={styles.listosTxt}>
              {jugadoresListos}/{jugadoresConectados} listos
            </Text>
          </View>

          {jugadoresRealesSala.map((j) => (
            <View
              key={j.nombre}
              style={[
                styles.filaJugador,
                j.nombre === miNombreRef.current && styles.filaYo,
              ]}
            >
              <View
                style={[
                  styles.estadoBadge,
                  j.listo ? styles.estadoListo : styles.estadoNoListo,
                ]}
              >
                <Text style={styles.estadoTxt}>
                  {j.listo ? '✓' : '…'}
                </Text>
              </View>

              <View style={{ flex: 1 }}>
                <Text
                  style={[
                    styles.nombreJugador,
                    j.nombre === miNombreRef.current && {
                      color: COLORS.accent,
                    },
                  ]}
                >
                  {j.nombre}
                  {j.anfitrion ? ' 👑' : ''}
                  {j.nombre === miNombreRef.current ? ' (vos)' : ''}
                </Text>

                <Text style={styles.estadoLabel}>
                  {j.listo ? 'Listo' : 'No listo'}
                </Text>
              </View>
            </View>
          ))}

          {jugadoresConectados < minimo && (
            <View style={styles.esperandoBox}>
              <Text style={styles.esperandoHint}>
                Faltan {minimo - jugadoresConectados} jugador
                {minimo - jugadoresConectados !== 1 ? 'es' : ''} para poder
                iniciar
              </Text>
            </View>
          )}

          {soyAnfitrion &&
            jugadoresConectados >= minimo &&
            jugadoresListos < jugadoresConectados && (
              <View style={[styles.esperandoBox, styles.esperandoBoxWarn]}>
                <Text style={[styles.esperandoHint, styles.esperandoHintWarn]}>
                  {jugadoresConectados - jugadoresListos} jugador
                  {jugadoresConectados - jugadoresListos !== 1
                    ? 'es no están'
                    : ' no está'}{' '}
                  listo, pero podés iniciar igual.
                </Text>
              </View>
            )}
        </View>

        <TouchableOpacity
          style={S.card}
          onPress={() => setModalReglas(true)}
          activeOpacity={0.8}
        >
          <View style={S.rowBetween}>
            <Text style={S.cardLabel}>📖 VER REGLAS DEL JUEGO</Text>
            <Text style={styles.chevron}>›</Text>
          </View>

          <Text style={styles.reglasSub}>
            Triple Dice · {TOTAL_RONDAS_DISPLAY} rondas · {MIN_JUG_DISPLAY}–
            {MAX_JUG_DISPLAY} jugadores
          </Text>
        </TouchableOpacity>

        {!!error && (
          <View style={S.errorBox}>
            <Text style={S.errorText}>{error}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[S.btn, estoyListo ? styles.btnNoListo : styles.btnListo]}
          onPress={handleToggleListo}
        >
          <Text style={[S.btnText, { color: COLORS.bg }]}>
            {estoyListo ? '✗ NO ESTOY LISTO' : '✓ ESTOY LISTO'}
          </Text>
        </TouchableOpacity>

        {soyAnfitrion && (
          <TouchableOpacity
            style={[
              S.btn,
              S.btnPrimary,
              !puedeIniciar && S.btnDisabled,
              { marginTop: SPACING.sm },
            ]}
            onPress={handleIniciar}
            disabled={!puedeIniciar}
          >
            {iniciando ? (
              <ActivityIndicator color={COLORS.bg} />
            ) : (
              <Text style={[S.btnText, { color: COLORS.bg }]}>
                {jugadoresConectados < minimo
                  ? `ESPERANDO JUGADORES (${jugadoresConectados}/${minimo})`
                  : '🎲 INICIAR PARTIDA'}
              </Text>
            )}
          </TouchableOpacity>
        )}

        <TouchableOpacity
          style={[S.btn, S.btnSecondary, { marginTop: SPACING.sm }]}
          onPress={handleSalirDeSala}
        >
          <Text style={S.btnTextLight}>← SALIR DE LA SALA</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={modalReglas} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { maxHeight: '80%' }]}>
            <Text style={styles.modalTitulo}>📖 REGLAS — TRIPLE DICE</Text>

            <ScrollView style={{ marginTop: SPACING.sm }}>
              {REGLAS.map((r, i) => (
                <View key={i} style={styles.reglaFila}>
                  <Text style={styles.reglaIcono}>{r.icono}</Text>
                  <Text style={styles.reglaTxtModal}>{r.texto}</Text>
                </View>
              ))}

              <View style={styles.prediccionesBox}>
                <Text style={[S.cardLabel, { marginBottom: 4 }]}>
                  PREDICCIONES VÁLIDAS
                </Text>

                {[
                  ['Cero', '0 pts base → bonus +20 pts'],
                  ['Uno', '1 pt base → bonus +1 pt'],
                  ['Tres', '3 pts base → bonus +3 pts'],
                  ['Seis', '6 pts base → bonus +6 pts'],
                ].map(([p, d]) => (
                  <View key={p} style={styles.prediccionFila}>
                    <View style={styles.prediccionBadge}>
                      <Text style={styles.prediccionBadgeTxt}>{p}</Text>
                    </View>

                    <Text style={styles.prediccionDesc}>{d}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>

            <TouchableOpacity
              style={[S.btn, S.btnPrimary, { marginTop: SPACING.md }]}
              onPress={() => setModalReglas(false)}
            >
              <Text style={[S.btnText, { color: COLORS.bg }]}>
                ENTENDIDO
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  centrado: {
    flexGrow: 1,
    justifyContent: 'center',
  },

  logo: {
    fontSize: 56,
    marginBottom: SPACING.sm,
  },

  formCard: {
    marginBottom: SPACING.md,
  },

  btnConectar: {
    marginTop: SPACING.sm,
  },

  reglaTxt: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 20,
  },

  btnActualizar: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.accent,
  },

  btnActualizarTxt: {
    fontSize: 11,
    fontWeight: '800',
    color: COLORS.accent,
    letterSpacing: 1,
  },

  sinSalas: {
    color: COLORS.textMuted,
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },

  filaSala: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 10,
  },

  salaNombre: {
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.text,
  },

  salaInfo: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
  },

  btnUnirse: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.accent,
  },

  btnUnirseTxt: {
    fontSize: 12,
    fontWeight: '800',
    color: COLORS.bg,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },

  modalBox: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    padding: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  modalTitulo: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: 1,
    marginBottom: SPACING.sm,
  },

  modalBotones: {
    flexDirection: 'row',
    gap: 10,
    marginTop: SPACING.sm,
  },

  headerSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4,
  },

  listosTxt: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  filaJugador: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },

  filaYo: {
    backgroundColor: 'rgba(255,215,0,0.05)',
    borderRadius: RADIUS.sm,
  },

  estadoBadge: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },

  estadoListo: {
    backgroundColor: 'rgba(34,197,94,0.25)',
    borderWidth: 1,
    borderColor: 'rgba(34,197,94,0.6)',
  },

  estadoNoListo: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  estadoTxt: {
    fontSize: 14,
    fontWeight: '800',
    color: COLORS.text,
  },

  estadoLabel: {
    fontSize: 11,
    color: COLORS.textMuted,
  },

  nombreJugador: {
    fontSize: 15,
    fontWeight: '600',
    color: COLORS.text,
  },

  esperandoBox: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    backgroundColor: 'rgba(255,215,0,0.06)',
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: 'rgba(255,215,0,0.2)',
  },

  esperandoBoxWarn: {
    borderColor: 'rgba(255,165,0,0.4)',
    backgroundColor: 'rgba(255,165,0,0.06)',
  },

  esperandoHint: {
    fontSize: 12,
    color: COLORS.accent,
    textAlign: 'center',
  },

  esperandoHintWarn: {
    color: 'rgba(255,165,0,0.9)',
  },

  btnListo: {
    backgroundColor: 'rgba(34,197,94,0.85)',
  },

  btnNoListo: {
    backgroundColor: 'rgba(248,113,113,0.7)',
  },

  chevron: {
    color: COLORS.accent,
    fontSize: 18,
  },

  reglasSub: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 4,
  },

  reglaFila: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 10,
    alignItems: 'flex-start',
  },

  reglaIcono: {
    fontSize: 20,
    width: 28,
    textAlign: 'center',
  },

  reglaTxtModal: {
    flex: 1,
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 20,
  },

  prediccionesBox: {
    marginTop: SPACING.md,
    flexDirection: 'column',
    gap: 6,
  },

  prediccionFila: {
    flexDirection: 'row',
    gap: 8,
    alignItems: 'center',
  },

  prediccionBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: RADIUS.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  prediccionBadgeTxt: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },

  prediccionDesc: {
    color: COLORS.textMuted,
    fontSize: 13,
  },
});