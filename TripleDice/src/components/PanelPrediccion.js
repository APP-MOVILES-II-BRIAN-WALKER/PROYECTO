/**
 * components/PanelPrediccion.js — Triple Dice
 * Panel de predicción con EXACTAMENTE las 4 opciones que soporta el servidor Rust:
 *   Cero | Uno | Tres | Seis
 *
 * Lógica de bonus (espejada del servidor):
 *   Cero correcto  → +20 pts (BONUS_CERO)
 *   Uno correcto   → duplica (+1 extra)
 *   Tres correcto  → duplica (+3 extra)
 *   Seis correcto  → duplica (+6 extra)
 */

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, RADIUS, SPACING, FONTS } from '../styles/style_01';

const OPCIONES = [
  {
    valor: 'Cero',
    label: '0',
    emoji: '🎯',
    desc:  '+20 si quedás último',
    color: '#F87171',   // rojo — riesgo alto
  },
  {
    valor: 'Uno',
    label: '1',
    emoji: '🥉',
    desc:  'Duplica si quedás 3°',
    color: '#CD7F32',   // bronce
  },
  {
    valor: 'Tres',
    label: '3',
    emoji: '🥈',
    desc:  'Duplica si quedás 2°',
    color: '#CBD5E1',   // plata
  },
  {
    valor: 'Seis',
    label: '6',
    emoji: '🥇',
    desc:  'Duplica si quedás 1°',
    color: '#FFD700',   // oro
  },
];

export default function PanelPrediccion({ seleccionada, onChange, disabled = false }) {
  return (
    <View>
      <Text style={styles.titulo}>PREDICCIÓN</Text>
      <Text style={styles.hint}>¿Cuántos puntos vas a obtener esta ronda?</Text>

      <View style={styles.grid}>
        {OPCIONES.map(op => {
          const activo = seleccionada === op.valor;
          return (
            <TouchableOpacity
              key={op.valor}
              style={[
                styles.btn,
                activo && { backgroundColor: op.color + '25', borderColor: op.color },
                disabled && styles.btnDis,
              ]}
              onPress={() => !disabled && onChange(op.valor)}
              activeOpacity={0.75}
            >
              <Text style={styles.emoji}>{op.emoji}</Text>
              <Text style={[styles.puntos, activo && { color: op.color }]}>{op.label} pt{op.label !== '1' ? 's' : ''}</Text>
              <Text style={[styles.desc, activo && { color: op.color }]}>{op.desc}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  titulo: {
    ...FONTS.label,
    marginBottom: 4,
  },
  hint: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginBottom: SPACING.md,
  },
  grid: {
    flexDirection: 'row',
    gap: 8,
  },
  btn: {
    flex: 1,
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    gap: 4,
  },
  btnDis: {
    opacity: 0.35,
  },
  emoji: {
    fontSize: 20,
  },
  puntos: {
    fontSize: 16,
    fontWeight: '900',
    color: COLORS.textMuted,
  },
  desc: {
    fontSize: 9,
    color: COLORS.textMuted,
    textAlign: 'center',
    lineHeight: 13,
  },
});