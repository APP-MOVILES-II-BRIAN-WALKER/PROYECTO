/**
 * App.tsx — Triple Dice
 * Punto de entrada de la app. Define la navegación y el stack de pantallas.
 * ITI-721 · Philip Walker & Paula Sanchez
 *
 * NOTA: La IP del servidor se ingresa en el LobbyScreen (no hardcodeada aquí).
 *       El WebSocket se crea dinámicamente en services/socket.js al conectar.
 */

import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import LobbyScreen      from './src/screens/LobbyScreen';
import JuegoScreen      from './src/screens/JuegoScreen';
import ResultadosScreen from './src/screens/ResultadosScreen';

const Stack = createStackNavigator();

const App = () => (
  <NavigationContainer>
    <Stack.Navigator
      initialRouteName="Lobby"
      screenOptions={{ headerShown: false }} // Cada pantalla maneja su propio header
    >
      <Stack.Screen name="Lobby"      component={LobbyScreen} />
      <Stack.Screen name="Juego"      component={JuegoScreen} />
      <Stack.Screen name="Resultados" component={ResultadosScreen} />
    </Stack.Navigator>
  </NavigationContainer>
);

export default App;
