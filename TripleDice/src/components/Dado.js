/**
 * components/Dado.js — Triple Dice
 * Dado animado individual. Muestra un número del 1 al 6 (o "?" si está oculto).
 * Acepta tipo: "blanco" | "rojo" | "azul" | "oculto"
 * Se anima con Animated.timing al revelar su valor.
 */

import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, Animated, StyleSheet } from 'react-native';
import S, { COLORS, RADIUS } from '../styles/style_01';

export default function Dado({ valor, tipo = 'blanco', seleccionado = false, onPress, size = 52, revelando = false }) {

  const escalaAnim = useRef(new Animated.Value(1)).current;
  const rotAnim    = useRef(new Animated.Value(0)).current;

  // Animación de revelación cuando el dado oculto muestra su valor
  useEffect(() => {
    if (revelando && valor !== null && valor !== undefined) {
      Animated.sequence([
        Animated.timing(rotAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(rotAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        Animated.spring(escalaAnim, { toValue: 1.15, useNativeDriver: true }),
        Animated.spring(escalaAnim, { toValue: 1, useNativeDriver: true }),
      ]).start();
    }
  }, [revelando, valor]);

  // Pequeña animación al seleccionar
  useEffect(() => {
    if (seleccionado) {
      Animated.sequence([
        Animated.spring(escalaAnim, { toValue: 1.1, useNativeDriver: true }),
        Animated.spring(escalaAnim, { toValue: 1,   useNativeDriver: true }),
      ]).start();
    }
  }, [seleccionado]);

  const spin = rotAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '180deg'],
  });

  // Estilo del dado según tipo
  const dadoStyle = [
    S.dado,
    tipo === 'blanco' && S.dadoBlanco,
    tipo === 'rojo'   && S.dadoRojo,
    tipo === 'azul'   && S.dadoAzul,
    tipo === 'oculto' && S.dadoOculto,
    seleccionado      && S.dadoSeleccionado,
    { width: size, height: size, borderRadius: size * 0.25 },
  ];

  const textoStyle = [
    tipo === 'blanco' ? S.dadoNumero : S.dadoNumeroColor,
    tipo === 'oculto' && S.dadoNumeroOculto,
    { fontSize: size * 0.38 },
  ];

  const contenido = (
    <Animated.View
      style={[
        dadoStyle,
        { transform: [{ scale: escalaAnim }, { rotateY: spin }] },
      ]}
    >
      <Text style={textoStyle}>
        {valor !== null && valor !== undefined ? valor : '?'}
      </Text>

      {/* Destello de selección */}
      {seleccionado && (
        <View style={[styles.selBrillo, { borderRadius: size * 0.25 }]} />
      )}
    </Animated.View>
  );

  if (onPress) {
    return (
      <TouchableOpacity onPress={onPress} activeOpacity={0.75}>
        {contenido}
      </TouchableOpacity>
    );
  }
  return contenido;
}

const styles = StyleSheet.create({
  selBrillo: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,215,0,0.18)',
    borderWidth: 2,
    borderColor: COLORS.accent,
  },
});
