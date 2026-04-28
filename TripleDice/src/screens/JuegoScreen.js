/**
 * screens/JuegoScreen.js — Triple Dice (Multi-Sala)
 *
 * FIXES:
 * - Actualiza correctamente cuántos jugadores confirmaron.
 * - Maneja JugadaRecibida y TiempoRestante.
 * - Maneja ProximaRonda para que la UI no quede congelada entre rondas.
 * - Usa listener seguro del socket para evitar que Lobby borre el listener de Juego.
 *
 * route.params:
 *   miNombre    → nombre del jugador local
 *   salaId      → ID de la sala actual
 *   jugadores   → array de nombres al inicio
 *   totalRondas → número de rondas de la partida
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  StatusBar,
  Alert,
} from 'react-native';

import { onMensaje, offMensaje } from '../services/socket';
import { enviarMensaje } from '../services/socket';

import Dado from '../components/Dado';
import Countdown from '../components/Countdown';
import PanelPrediccion from '../components/PanelPrediccion';
import Marcador from '../components/Marcador';

import S, { COLORS, SPACING, RADIUS } from '../styles/style_01';

export default function JuegoScreen({ route, navigation }) {
  const {
    miNombre,
    salaId,
    jugadores: jugadoresIniciales = [],
    totalRondas = 4,
  } = route.params;

  const [fase, setFase] = useState('esperando');
  const [ronda, setRonda] = useState(1);

  const [dadosVisibles, setDadosVisibles] = useState([]);
  const [dadoRojo, setDadoRojo] = useState(null);
  const [dadoAzul, setDadoAzul] = useState(null);

  const [dadosElegidos, setDadosElegidos] = useState([]);
  const [prediccion, setPrediccion] = useState(null);
  const [confirmado, setConfirmado] = useState(false);

  const [jugadasConfirmadas, setJugadasConfirmadas] = useState({
    ya: 0,
    total: jugadoresIniciales.length || 0,
  });

  const [segsIniciales, setSegsIniciales] = useState(60);
  const [segsActuales, setSegsActuales] = useState(null);

  const [ranking, setRanking] = useState([]);
  const [acumulados, setAcumulados] = useState({});
  const [revelando, setRevelando] = useState(false);

  const [segsEntreRondas, setSegsEntreRondas] = useState(null);
  const [rondaSiguiente, setRondaSiguiente] = useState(null);

  const navigationRef = useRef(navigation);
  const miNombreRef = useRef(miNombre);
  const salaIdRef = useRef(salaId);
  const jugadoresInicialesRef = useRef(jugadoresIniciales);
  const handleMensajeRef = useRef(null);
  const timeoutRevelandoRef = useRef(null);

  useEffect(() => {
    navigationRef.current = navigation;
  }, [navigation]);

  useEffect(() => {
    salaIdRef.current = salaId;
  }, [salaId]);

  useEffect(() => {
    jugadoresInicialesRef.current = jugadoresIniciales;
  }, [jugadoresIniciales]);

  useEffect(() => {
    handleMensajeRef.current = handleMensaje;
  });

  /**
   * Listener del socket.
   *
   * Recomendado:
   * onMensaje(listener) debe devolver unsubscribe.
   *
   * Fallback:
   * Si tu socket.js todavía usa offMensaje(listener), también funciona.
   */
  useEffect(() => {
    const listener = (msg) => {
      if (handleMensajeRef.current) {
        handleMensajeRef.current(msg);
      }
    };

    const unsubscribe = onMensaje(listener);

    return () => {
      if (timeoutRevelandoRef.current) {
        clearTimeout(timeoutRevelandoRef.current);
      }

      if (typeof unsubscribe === 'function') {
        unsubscribe();
      } else {
        offMensaje(listener);
      }
    };
  }, []);

  function handleMensaje(msg) {
    if (!msg || !msg.tipo) return;

    // Ignorar mensajes de otras salas.
    if (msg.sala_id && msg.sala_id !== salaIdRef.current) return;

    switch (msg.tipo) {
      case 'RondaIniciada': {
        const totalJugadores =
          msg.total_activos ??
          jugadoresInicialesRef.current.length ??
          0;

        setRonda(msg.ronda);
        setDadosVisibles(msg.dados_visibles || []);

        setDadoRojo(null);
        setDadoAzul(null);

        setDadosElegidos([]);
        setPrediccion(null);
        setConfirmado(false);

        setFase('esperando');

        setSegsIniciales(msg.segundos);
        setSegsActuales(null);

        setRanking([]);
        setRevelando(false);

        setJugadasConfirmadas({
          ya: 0,
          total: totalJugadores,
        });

        setSegsEntreRondas(null);
        setRondaSiguiente(null);
        break;
      }

      case 'TiempoRestante': {
        setSegsActuales(msg.segundos);

        setJugadasConfirmadas({
          ya: msg.jugaron_ya ?? 0,
          total: msg.total_activos ?? jugadasConfirmadas.total ?? 0,
        });

        break;
      }

      case 'JugadaRecibida': {
        setJugadasConfirmadas({
          ya: msg.jugaron_ya ?? 0,
          total: msg.total_activos ?? jugadasConfirmadas.total ?? 0,
        });

        break;
      }

      case 'ResultadosRonda': {
        setDadoRojo(msg.dado_rojo);
        setDadoAzul(msg.dado_azul);

        setRevelando(true);
        setFase('revelando');

        const nuevoRanking = msg.ranking || [];
        setRanking(nuevoRanking);

        const nuevoAcum = {};
        nuevoRanking.forEach((r) => {
          nuevoAcum[r.nombre] = r.puntos_total;
        });
        setAcumulados(nuevoAcum);

        if (timeoutRevelandoRef.current) {
          clearTimeout(timeoutRevelandoRef.current);
        }

        timeoutRevelandoRef.current = setTimeout(() => {
          setRevelando(false);
        }, 1500);

        break;
      }

      case 'ProximaRonda': {
        setFase('entre-rondas');
        setRondaSiguiente(msg.ronda_siguiente);
        setSegsEntreRondas(msg.segundos);

        // El servidor manda segundos=0 justo antes de RondaIniciada.
        // Limpiamos visualmente para que no queden los dados revelados.
        if (msg.segundos === 0) {
          setDadoRojo(null);
          setDadoAzul(null);
          setDadosElegidos([]);
          setPrediccion(null);
          setConfirmado(false);
          setRanking([]);
          setRevelando(false);
          setSegsActuales(null);
        }

        break;
      }

      case 'FinJuego': {
        navigationRef.current.replace('Resultados', {
          tablaFinal: msg.tabla_final,
          ganador: msg.ganador,
          perdedor: msg.perdedor,
          mensaje: msg.mensaje,
          miNombre: miNombreRef.current,
          salaId: salaIdRef.current,
        });

        break;
      }

      case 'Error': {
        Alert.alert('Error del servidor', msg.mensaje || 'Error desconocido.');
        break;
      }

      case '_Desconectado': {
        Alert.alert(
          'Conexión perdida',
          'Se perdió la conexión con el servidor.'
        );
        navigationRef.current.replace('Lobby');
        break;
      }

      default:
        break;
    }
  }

  function toggleDado(id) {
    if (confirmado || fase !== 'esperando') return;

    setDadosElegidos((prev) => {
      if (prev.includes(id)) {
        return prev.filter((d) => d !== id);
      }

      if (prev.length >= 3) {
        return prev;
      }

      return [...prev, id];
    });
  }

  function handleConfirmar() {
    if (dadosElegidos.length !== 3 || !prediccion || confirmado) return;

    enviarMensaje({
      tipo: 'SubmitJugada',
      sala_id: salaIdRef.current,
      dados_elegidos: dadosElegidos,
      prediccion,
    });

    // Bloquea doble tap local. El contador real llega por JugadaRecibida.
    setConfirmado(true);
  }

  const puedeConfirmar =
    dadosElegidos.length === 3 &&
    prediccion !== null &&
    !confirmado &&
    fase === 'esperando';

  function subtituloFase() {
    if (fase === 'esperando') {
      return 'Elegí 3 dados y tu predicción';
    }

    if (fase === 'revelando') {
      return 'Revelando resultados...';
    }

    if (fase === 'entre-rondas') {
      if (segsEntreRondas > 0) {
        return `Próxima ronda en ${segsEntreRondas}s`;
      }

      return 'Preparando próxima ronda...';
    }

    return '';
  }

  const rankingAcumulado = Object.entries(acumulados)
    .map(([nombre, puntos_total]) => ({
      nombre,
      puntos_total,
      puntos_ronda: 0,
      combinacion: '',
      acierto: false,
      bonus: 0,
    }))
    .sort((a, b) => b.puntos_total - a.puntos_total);

  return (
    <View style={S.screen}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <ScrollView contentContainerStyle={[S.scroll, { paddingTop: SPACING.md }]}>
        {/* Header de ronda */}
        <View style={[S.rowBetween, styles.headerRonda]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rondaTxt}>
              RONDA {ronda} / {totalRondas}
            </Text>

            <Text style={styles.subtituloTxt}>
              {subtituloFase()}
            </Text>
          </View>

          <View style={styles.rightHeader}>
            {fase !== 'entre-rondas' && (
              <Countdown
                segundosIniciales={segsIniciales}
                segundosActuales={segsActuales}
              />
            )}

            <Text style={styles.confirmadosTxt}>
              {jugadasConfirmadas.ya}/{jugadasConfirmadas.total} confirmaron
            </Text>
          </View>
        </View>

        {/* Vista entre rondas */}
        {fase === 'entre-rondas' && (
          <View style={[S.card, styles.entreRondasCard]}>
            <Text style={styles.entreRondasEmoji}>⏳</Text>

            <Text style={styles.entreRondasTitulo}>
              PRÓXIMA RONDA {rondaSiguiente || ronda + 1} / {totalRondas}
            </Text>

            <Text style={styles.entreRondasSeg}>
              {segsEntreRondas > 0
                ? `Comienza en ${segsEntreRondas}s`
                : 'Preparando la ronda...'}
            </Text>

            {rankingAcumulado.length > 0 && (
              <View style={styles.acumuladoEntreRondas}>
                <Text style={S.cardLabel}>PUNTOS ACUMULADOS</Text>
                <Marcador ranking={rankingAcumulado} miNombre={miNombre} />
              </View>
            )}
          </View>
        )}

        {/* Dados */}
        {fase !== 'entre-rondas' && (
          <View style={S.card}>
            <Text style={S.cardLabel}>DADOS VISIBLES — elegí hasta 3</Text>

            <View style={styles.gridDados}>
              {dadosVisibles.map((val, i) => {
                const id = `visible_${i}`;

                return (
                  <Dado
                    key={id}
                    valor={val}
                    tipo="blanco"
                    seleccionado={dadosElegidos.includes(id)}
                    onPress={() => toggleDado(id)}
                    size={56}
                  />
                );
              })}
            </View>

            <Text style={[S.cardLabel, { marginTop: SPACING.md }]}>
              DADOS OCULTOS
            </Text>

            <View style={styles.dadosOcultos}>
              <TouchableOpacity
                style={[
                  styles.dadoOcultoWrap,
                  styles.dadoOcultoRojo,
                  dadosElegidos.includes('rojo') && styles.dadoOcultoSel,
                ]}
                onPress={() => toggleDado('rojo')}
                activeOpacity={0.75}
                disabled={confirmado || fase !== 'esperando'}
              >
                <Text style={styles.dadoOcultoLabel}>ROJO</Text>

                <Dado
                  valor={dadoRojo}
                  tipo={dadoRojo !== null ? 'rojo' : 'oculto'}
                  seleccionado={dadosElegidos.includes('rojo')}
                  size={52}
                  revelando={revelando && dadoRojo !== null}
                />

                <Text style={styles.dadoOcultoHint}>
                  {dadoRojo !== null ? `Valor: ${dadoRojo}` : '¿? Valor oculto'}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.dadoOcultoWrap,
                  styles.dadoOcultoAzul,
                  dadosElegidos.includes('azul') && styles.dadoOcultoSel,
                ]}
                onPress={() => toggleDado('azul')}
                activeOpacity={0.75}
                disabled={confirmado || fase !== 'esperando'}
              >
                <Text style={styles.dadoOcultoLabel}>AZUL</Text>

                <Dado
                  valor={dadoAzul}
                  tipo={dadoAzul !== null ? 'azul' : 'oculto'}
                  seleccionado={dadosElegidos.includes('azul')}
                  size={52}
                  revelando={revelando && dadoAzul !== null}
                />

                <Text style={styles.dadoOcultoHint}>
                  {dadoAzul !== null ? `Valor: ${dadoAzul}` : '¿? Valor oculto'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.elegidosBar}>
              {[0, 1, 2].map((i) => (
                <View
                  key={i}
                  style={[
                    styles.elegidoPunto,
                    i < dadosElegidos.length && styles.elegidoPuntoActivo,
                  ]}
                />
              ))}

              <Text style={styles.elegidosTxt}>
                {dadosElegidos.length}/3 dados elegidos
              </Text>
            </View>
          </View>
        )}

        {/* Panel de predicción */}
        {fase === 'esperando' && (
          <View style={S.card}>
            <PanelPrediccion
              seleccionada={prediccion}
              onChange={setPrediccion}
              disabled={confirmado}
            />
          </View>
        )}

        {/* Botón confirmar */}
        {fase === 'esperando' && (
          <TouchableOpacity
            style={[
              S.btn,
              styles.btnConfirmar,
              !puedeConfirmar && S.btnDisabled,
            ]}
            onPress={handleConfirmar}
            disabled={!puedeConfirmar}
          >
            <Text style={[S.btnText, styles.btnConfirmarTxt]}>
              {confirmado ? '✓ JUGADA CONFIRMADA' : 'CONFIRMAR JUGADA'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Resultado de ronda */}
        {fase === 'revelando' && ranking.length > 0 && (
          <View style={S.card}>
            <Text style={S.cardLabel}>
              RESULTADO DE LA RONDA {ronda}
            </Text>

            <Marcador ranking={ranking} miNombre={miNombre} />
          </View>
        )}

        {/* Tabla acumulada */}
        {fase !== 'entre-rondas' && rankingAcumulado.length > 0 && (
          <View style={S.card}>
            <Text style={S.cardLabel}>PUNTOS ACUMULADOS</Text>
            <Marcador ranking={rankingAcumulado} miNombre={miNombre} />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  headerRonda: {
    marginBottom: SPACING.md,
    paddingHorizontal: 4,
    alignItems: 'center',
  },

  rondaTxt: {
    fontSize: 20,
    fontWeight: '900',
    color: COLORS.text,
    letterSpacing: 1,
  },

  subtituloTxt: {
    color: COLORS.textMuted,
    fontSize: 12,
    marginTop: 2,
  },

  rightHeader: {
    alignItems: 'center',
  },

  confirmadosTxt: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  gridDados: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'space-between',
  },

  dadosOcultos: {
    flexDirection: 'row',
    gap: 10,
  },

  dadoOcultoWrap: {
    flex: 1,
    alignItems: 'center',
    padding: SPACING.sm,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    gap: 6,
  },

  dadoOcultoRojo: {
    backgroundColor: 'rgba(230,57,70,0.08)',
    borderColor: 'rgba(230,57,70,0.3)',
  },

  dadoOcultoAzul: {
    backgroundColor: 'rgba(69,123,157,0.08)',
    borderColor: 'rgba(69,123,157,0.3)',
  },

  dadoOcultoSel: {
    borderColor: COLORS.accent,
    borderWidth: 2,
  },

  dadoOcultoLabel: {
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    color: COLORS.textMuted,
  },

  dadoOcultoHint: {
    fontSize: 10,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  elegidosBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: SPACING.md,
  },

  elegidoPunto: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },

  elegidoPuntoActivo: {
    backgroundColor: COLORS.accent,
    borderColor: COLORS.accent,
  },

  elegidosTxt: {
    fontSize: 12,
    color: COLORS.textMuted,
  },

  btnConfirmar: {
    backgroundColor: COLORS.accent,
    marginBottom: SPACING.md,
  },

  btnConfirmarTxt: {
    color: COLORS.bg,
    fontSize: 16,
  },

  entreRondasCard: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },

  entreRondasEmoji: {
    fontSize: 48,
    marginBottom: SPACING.sm,
  },

  entreRondasTitulo: {
    fontSize: 22,
    fontWeight: '900',
    color: COLORS.accent,
    letterSpacing: 1,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },

  entreRondasSeg: {
    fontSize: 15,
    color: COLORS.textMuted,
    textAlign: 'center',
  },

  acumuladoEntreRondas: {
    marginTop: SPACING.md,
    width: '100%',
  },
});