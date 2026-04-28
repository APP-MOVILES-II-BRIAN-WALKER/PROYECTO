/**
 * styles/style_01.js — Triple Dice
 * Estilos globales basados en la guía del profesor (Class_09b).
 * Extendidos con la paleta del prompt:
 *
 *   Fondo:          #1A1A2E  (mesa de juego oscura)
 *   Dados blancos:  #FFFFFF con texto #1A1A2E
 *   Dado rojo:      #E63946
 *   Dado azul:      #457B9D
 *   Acentos dorados:#FFD700  (ranking, títulos)
 *   Texto:          #EAEAEA
 *   Superficie:     #16213E  (cards)
 *   Borde:          #0F3460
 */

import { StyleSheet, Platform } from 'react-native';

// ─── Paleta ───────────────────────────────────────────────────────────────────
export const COLORS = {
  bg:           '#1A1A2E',
  surface:      '#16213E',
  surfaceAlt:   '#0F3460',
  border:       '#0F3460',
  text:         '#EAEAEA',
  textMuted:    '#8892A4',
  accent:       '#FFD700',   // dorado
  accentSoft:   'rgba(255,215,0,0.15)',
  dadoBlanco:   '#FFFFFF',
  dadoRojo:     '#E63946',
  dadoAzul:     '#457B9D',
  dadoOculto:   '#2A2A4A',
  verde:        '#34D399',
  rojo:         '#F87171',
  tripleColor:  '#FFD700',
  escaleraColor:'#60A5FA',
  parejaColor:  '#34D399',
  singleColor:  '#8892A4',
};

// ─── Tipografía ───────────────────────────────────────────────────────────────
export const FONTS = {
  title:    { fontSize: 28, fontWeight: '900', color: COLORS.text, letterSpacing: 2 },
  subtitle: { fontSize: 13, fontWeight: '600', color: COLORS.textMuted, letterSpacing: 3 },
  body:     { fontSize: 15, color: COLORS.text },
  small:    { fontSize: 12, color: COLORS.textMuted },
  label:    { fontSize: 11, fontWeight: '800', color: COLORS.accent, letterSpacing: 3, textTransform: 'uppercase' },
  numero:   { fontSize: 22, fontWeight: '900', color: COLORS.text },
};

// ─── Espaciado ────────────────────────────────────────────────────────────────
export const SPACING = {
  xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48,
};

// ─── Radios ───────────────────────────────────────────────────────────────────
export const RADIUS = {
  sm: 8, md: 12, lg: 16, xl: 22, full: 999,
};

// ─── StyleSheet global ────────────────────────────────────────────────────────
export default StyleSheet.create({

  // Contenedores base
  screen: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  scroll: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Cards / superficies
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginBottom: SPACING.md,
  },
  cardLabel: {
    ...FONTS.label,
    marginBottom: SPACING.sm,
  },

  // Header de pantalla
  header: {
    alignItems: 'center',
    paddingTop: SPACING.xl,
    paddingBottom: SPACING.lg,
    paddingHorizontal: SPACING.md,
  },
  headerTitle: {
    ...FONTS.title,
  },
  headerSubtitle: {
    ...FONTS.subtitle,
    marginTop: 4,
  },

  // Inputs
  input: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: 12,
    color: COLORS.text,
    fontSize: 16,
    marginBottom: SPACING.sm,
  },

  // Botones principales
  btn: {
    borderRadius: RADIUS.md,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 50,
  },
  btnPrimary: {
    backgroundColor: COLORS.accent,
  },
  btnSecondary: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnDanger: {
    backgroundColor: COLORS.dadoRojo,
  },
  btnDisabled: {
    opacity: 0.35,
  },
  btnText: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: COLORS.bg,
  },
  btnTextLight: {
    fontSize: 14,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: COLORS.text,
  },

  // Dado — componente base
  dado: {
    aspectRatio: 1,
    borderRadius: RADIUS.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  dadoBlanco: {
    backgroundColor: COLORS.dadoBlanco,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  dadoRojo: {
    backgroundColor: COLORS.dadoRojo,
    borderColor: 'rgba(230,57,70,0.5)',
  },
  dadoAzul: {
    backgroundColor: COLORS.dadoAzul,
    borderColor: 'rgba(69,123,157,0.5)',
  },
  dadoOculto: {
    backgroundColor: COLORS.dadoOculto,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  dadoSeleccionado: {
    borderColor: COLORS.accent,
    borderWidth: 2,
  },
  dadoNumero: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.bg,
  },
  dadoNumeroOculto: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.textMuted,
  },
  dadoNumeroColor: {
    fontSize: 18,
    fontWeight: '900',
    color: COLORS.text,
  },

  // Fila genérica
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },

  // Badges de combinación
  comboBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: RADIUS.full,
    borderWidth: 1,
  },
  comboText: {
    fontSize: 11,
    fontWeight: '700',
  },

  // Indicador de estado conectado
  dotVerde: {
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.verde,
  },
  dotRojo: {
    width: 8, height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.rojo,
  },

  // Mensajes de error
  errorBox: {
    backgroundColor: 'rgba(248,113,113,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
    borderRadius: RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  errorText: {
    color: COLORS.rojo,
    fontSize: 13,
    textAlign: 'center',
  },

  // Separador
  separator: {
    height: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.sm,
  },
});
