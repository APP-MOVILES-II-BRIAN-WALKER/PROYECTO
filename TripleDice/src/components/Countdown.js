/**
 * components/Countdown.js — Triple Dice
 * Timer circular de 30 segundos.
 * El servidor envía TiempoRestante cada 5s (o últimos 5s).
 * El cliente tiene su propio countdown local sincronizado con RondaIniciada.
 */

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Svg, { Circle } from 'react-native-svg';
import { COLORS } from '../styles/style_01';

const RADIO   = 36;
const CIRCUNF = 2 * Math.PI * RADIO; // longitud del círculo

export default function Countdown({ segundosIniciales = 30, segundosActuales = null }) {
  const [seg, setSeg] = useState(segundosIniciales);
  const intervalRef   = useRef(null);

  // Sincronizar cuando llega TiempoRestante del servidor
  useEffect(() => {
    if (segundosActuales !== null) {
      setSeg(segundosActuales);
    }
  }, [segundosActuales]);

  // Countdown local (se decrementa cada segundo)
  useEffect(() => {
    setSeg(segundosIniciales);
    if (intervalRef.current) clearInterval(intervalRef.current);

    intervalRef.current = setInterval(() => {
      setSeg(prev => {
        if (prev <= 1) { clearInterval(intervalRef.current); return 0; }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(intervalRef.current);
  }, [segundosIniciales]);

  // Color cambia según urgencia
  const color = seg > 10 ? COLORS.verde : seg > 5 ? COLORS.accent : COLORS.rojo;

  // Offset del arco SVG: 0 = lleno, CIRCUNF = vacío
  const offset = CIRCUNF * (1 - seg / segundosIniciales);

  return (
    <View style={styles.wrap}>
      <Svg width={84} height={84} viewBox="0 0 84 84">
        {/* Fondo del anillo */}
        <Circle
          cx={42} cy={42} r={RADIO}
          stroke="rgba(255,255,255,0.1)"
          strokeWidth={6}
          fill="none"
        />
        {/* Arco de progreso */}
        <Circle
          cx={42} cy={42} r={RADIO}
          stroke={color}
          strokeWidth={6}
          fill="none"
          strokeDasharray={`${CIRCUNF} ${CIRCUNF}`}
          strokeDashoffset={offset}
          strokeLinecap="round"
          rotation="-90"
          origin="42, 42"
        />
      </Svg>
      <View style={styles.numWrap}>
        <Text style={[styles.num, { color }]}>{seg}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: 84,
    height: 84,
    alignItems: 'center',
    justifyContent: 'center',
  },
  numWrap: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
  },
  num: {
    fontSize: 20,
    fontWeight: '900',
  },
});
