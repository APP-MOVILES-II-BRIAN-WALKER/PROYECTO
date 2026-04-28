/**
 * screens/ResultadosScreen.js — Triple Dice  (Multi-Sala)
 *
 * Cambios respecto a la versión anterior:
 *   - Recibe `salaId` via route.params
 *   - "NUEVA PARTIDA" navega de vuelta a Lobby en fase 'salas' (sin desconectarse)
 *   - Muestra nombre de sala en el header
 *
 * route.params:
 *   tablaFinal  → array de ResultadoJugador del servidor
 *   ganador     → nombre del ganador
 *   perdedor    → nombre del eliminado
 *   mensaje     → mensaje del servidor
 *   miNombre    → para resaltar al jugador local
 *   salaId      → ID de la sala (para poder reingresar)
 */

import React, { useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity,
  StyleSheet, StatusBar, Animated,
} from 'react-native';
import { enviarMensaje } from '../services/socket';
import S, { COLORS, SPACING, RADIUS } from '../styles/style_01';

export default function ResultadosScreen({ route, navigation }) {
  const { tablaFinal = [], ganador, perdedor, miNombre, salaId } = route.params;

  const fadeAnim  = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(40)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fadeAnim,  { toValue: 1, duration: 700, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 0, duration: 700, useNativeDriver: true }),
    ]).start();
  }, []);

  /**
   * "Nueva Partida" → vuelve a la lista de salas sin desconectarse del servidor.
   * El servidor ya reinició el estado de la sala al enviar FinJuego,
   * así que el jugador puede volver a unirse a la misma sala o elegir otra.
   */
  function handleNuevaPartida() {
    // Salir formalmente de la sala en el servidor
    if (salaId) {
      enviarMensaje({ tipo: 'SalirDeSala', sala_id: salaId });
    }
    // Volver al Lobby en fase 'salas' (la conexión WebSocket sigue activa)
    navigation.replace('Lobby');
  }

  const soYoGanador   = miNombre === ganador;
  const soYoEliminado = miNombre === perdedor;

  return (
    <View style={S.screen}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg} />

      <Animated.ScrollView
        style={{ opacity: fadeAnim, transform: [{ translateY: slideAnim }] }}
        contentContainerStyle={[S.scroll, { paddingTop: SPACING.xl, alignItems: 'center' }]}
      >
        {/* Título */}
        <Text style={styles.titulo}>🎲 FIN DEL JUEGO</Text>
        <Text style={{ color: COLORS.textMuted, fontSize: 13, marginBottom: SPACING.xl }}>
          Partida finalizada
        </Text>

        {/* Mi resultado personal */}
        {(soYoGanador || soYoEliminado) && (
          <View style={[styles.miResultado, soYoGanador ? styles.miGanador : styles.miEliminado]}>
            <Text style={styles.miResultadoIcon}>{soYoGanador ? '🏆' : '☠️'}</Text>
            <Text style={styles.miResultadoTxt}>
              {soYoGanador ? '¡Ganaste!' : 'Fuiste eliminado'}
            </Text>
          </View>
        )}

        {/* Podio */}
        <View style={styles.podioRow}>
          <View style={[styles.podioCard, styles.podioGanador]}>
            <Text style={styles.podioIcon}>🏆</Text>
            <Text style={styles.podioLabel}>GANADOR</Text>
            <Text style={styles.podioNombre}>{ganador}</Text>
            <Text style={styles.podioScore}>
              {tablaFinal[0]?.puntos_total ?? '–'} pts
            </Text>
          </View>
          <View style={[styles.podioCard, styles.podioPerdedor]}>
            <Text style={styles.podioIcon}>☠️</Text>
            <Text style={styles.podioLabel}>ELIMINADO</Text>
            <Text style={styles.podioNombre}>{perdedor}</Text>
            <Text style={styles.podioScore}>
              {tablaFinal[tablaFinal.length - 1]?.puntos_total ?? '–'} pts
            </Text>
          </View>
        </View>

        {/* Tabla final */}
        <View style={[S.card, { width: '100%' }]}>
          <Text style={S.cardLabel}>CLASIFICACIÓN FINAL</Text>

          {tablaFinal.map((j, i) => {
            const pos        = i + 1;
            const esGanador  = j.nombre === ganador;
            const esEliminado = j.nombre === perdedor;
            const esYo       = j.nombre === miNombre;

            return (
              <View key={j.nombre} style={[
                styles.filaTabla,
                esGanador   && styles.filaGanador,
                esEliminado && styles.filaEliminado,
                esYo && !esGanador && !esEliminado && styles.filaYo,
              ]}>
                <View style={[
                  styles.posBadge,
                  pos === 1 && styles.pos1,
                  pos === 2 && styles.pos2,
                  pos === 3 && styles.pos3,
                ]}>
                  <Text style={styles.posNum}>
                    {pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos}
                  </Text>
                </View>
                <Text style={[styles.filaNombre, esYo && { color: COLORS.accent }]} numberOfLines={1}>
                  {j.nombre}
                  {esGanador   ? ' 🏆' : ''}
                  {esEliminado ? ' ☠️' : ''}
                  {esYo        ? ' (vos)' : ''}
                </Text>
                <Text style={[styles.filaPuntos, esGanador && { color: COLORS.accent }]}>
                  {j.puntos_total} pts
                </Text>
              </View>
            );
          })}
        </View>

        {/* Botones */}
        <TouchableOpacity
          style={[S.btn, styles.btnNueva, { width: '100%' }]}
          onPress={handleNuevaPartida}
        >
          <Text style={[S.btnText, { color: COLORS.bg }]}>🎲 NUEVA PARTIDA</Text>
        </TouchableOpacity>

        <Text style={{ color: COLORS.textMuted, fontSize: 11, marginTop: SPACING.sm, textAlign: 'center' }}>
          Volverás a la lista de salas. La conexión con el servidor se mantiene.
        </Text>

      </Animated.ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  titulo: {
    fontSize: 30, fontWeight: '900', color: COLORS.text,
    letterSpacing: 2, textAlign: 'center', marginBottom: 6,
  },
  miResultado: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: SPACING.lg, paddingVertical: SPACING.md,
    borderRadius: RADIUS.xl, borderWidth: 1,
    marginBottom: SPACING.lg, width: '100%', justifyContent: 'center',
  },
  miGanador:   { backgroundColor: 'rgba(255,215,0,0.12)', borderColor: COLORS.accent },
  miEliminado: { backgroundColor: 'rgba(248,113,113,0.12)', borderColor: COLORS.dadoRojo },
  miResultadoIcon: { fontSize: 28 },
  miResultadoTxt: { fontSize: 20, fontWeight: '900', color: COLORS.text },

  podioRow: { flexDirection: 'row', gap: 10, width: '100%', marginBottom: SPACING.md },
  podioCard: {
    flex: 1, borderRadius: RADIUS.lg, borderWidth: 1,
    padding: SPACING.md, alignItems: 'center', gap: 4,
  },
  podioGanador:  { backgroundColor: 'rgba(255,215,0,0.10)', borderColor: COLORS.accent },
  podioPerdedor: { backgroundColor: 'rgba(248,113,113,0.08)', borderColor: 'rgba(248,113,113,0.4)' },
  podioIcon:  { fontSize: 28 },
  podioLabel: { fontSize: 10, fontWeight: '800', letterSpacing: 2, color: COLORS.textMuted },
  podioNombre: { fontSize: 16, fontWeight: '900', color: COLORS.text, textAlign: 'center' },
  podioScore: { fontSize: 13, color: COLORS.textMuted },

  filaTabla: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: 10,
  },
  filaGanador:  { backgroundColor: 'rgba(255,215,0,0.06)' },
  filaEliminado:{ backgroundColor: 'rgba(248,113,113,0.06)' },
  filaYo:       { backgroundColor: 'rgba(255,255,255,0.03)' },
  posBadge: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  pos1: { backgroundColor: 'rgba(255,215,0,0.2)' },
  pos2: { backgroundColor: 'rgba(203,213,225,0.15)' },
  pos3: { backgroundColor: 'rgba(180,120,60,0.15)' },
  posNum: { fontSize: 14, fontWeight: '800', color: COLORS.text },
  filaNombre: { flex: 1, fontSize: 15, fontWeight: '600', color: COLORS.text },
  filaPuntos: { fontSize: 16, fontWeight: '900', color: COLORS.text },

  btnNueva: { backgroundColor: COLORS.accent, marginTop: SPACING.lg },
});