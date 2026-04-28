/**
 * components/Marcador.js — Triple Dice
 * Lista de jugadores con puntos acumulados, ordenada de mayor a menor.
 * Se muestra durante el juego y se actualiza en cada ResultadosRonda.
 *
 * Props:
 *   ranking  {object[]}  Array de ResultadoJugador del servidor
 *   miNombre {string}    Para resaltar al jugador local
 */

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING, FONTS } from '../styles/style_01';

const COLORES_COMBO = {
  Triple:   { bg: 'rgba(255,215,0,0.15)',   text: COLORS.accent },
  Escalera: { bg: 'rgba(96,165,250,0.15)',  text: '#60A5FA' },
  Doble:    { bg: 'rgba(52,211,153,0.15)',  text: COLORS.verde },
  Single:   { bg: 'rgba(136,146,164,0.15)', text: COLORS.textMuted },
};

export default function Marcador({ ranking = [], miNombre = '' }) {
  if (ranking.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyTxt}>Sin datos aún</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      {ranking.map((j, i) => {
        const pos = i + 1;
        const esYo = j.nombre === miNombre;
        const combo = j.combinacion || 'Single';
        const colCombo = COLORES_COMBO[combo] || COLORES_COMBO.Single;

        return (
          <View key={j.nombre} style={[styles.fila, esYo && styles.filaYo]}>
            {/* Posición */}
            <View style={[styles.posBadge, pos === 1 && styles.pos1, pos === 2 && styles.pos2, pos === 3 && styles.pos3]}>
              <Text style={styles.posNum}>{pos === 1 ? '🥇' : pos === 2 ? '🥈' : pos === 3 ? '🥉' : pos}</Text>
            </View>

            {/* Nombre */}
            <Text style={[styles.nombre, esYo && styles.nombreYo]} numberOfLines={1}>
              {j.nombre}{esYo ? ' (vos)' : ''}
            </Text>

            {/* Combinación */}
            {j.combinacion ? (
              <View style={[styles.comboBadge, { backgroundColor: colCombo.bg }]}>
                <Text style={[styles.comboTxt, { color: colCombo.text }]}>{combo}</Text>
              </View>
            ) : null}

            {/* Puntos ronda + bonus */}
            {j.puntos_ronda !== undefined && (
              <View style={styles.ptsWrap}>
                {j.acierto && j.bonus > 0 && (
                  <Text style={styles.bonus}>+{j.bonus}</Text>
                )}
                <Text style={styles.pts}>{j.puntos_total}</Text>
              </View>
            )}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: 6,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingVertical: 10,
    paddingHorizontal: 12,
    gap: 8,
  },
  filaYo: {
    borderColor: COLORS.accent,
    backgroundColor: 'rgba(255,215,0,0.06)',
  },
  posBadge: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pos1: { backgroundColor: 'rgba(255,215,0,0.2)' },
  pos2: { backgroundColor: 'rgba(203,213,225,0.2)' },
  pos3: { backgroundColor: 'rgba(180,120,60,0.2)' },
  posNum: {
    fontSize: 13,
    fontWeight: '800',
    color: COLORS.text,
  },
  nombre: {
    flex: 1,
    fontSize: 14,
    color: COLORS.text,
    fontWeight: '500',
  },
  nombreYo: {
    color: COLORS.accent,
    fontWeight: '700',
  },
  comboBadge: {
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
  },
  comboTxt: {
    fontSize: 10,
    fontWeight: '700',
  },
  ptsWrap: {
    alignItems: 'flex-end',
  },
  pts: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.accent,
  },
  bonus: {
    fontSize: 10,
    fontWeight: '700',
    color: COLORS.verde,
  },
  empty: {
    padding: SPACING.md,
    alignItems: 'center',
  },
  emptyTxt: {
    color: COLORS.textMuted,
    fontStyle: 'italic',
  },
});
