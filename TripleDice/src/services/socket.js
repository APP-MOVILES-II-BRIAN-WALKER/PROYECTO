/**
 * services/socket.js — Triple Dice (Multi-Sala)
 * Wrapper del WebSocket. Encapsula toda la comunicación con el servidor Rust.
 *
 * FIX:
 * - Soporta múltiples listeners.
 * - Evita que LobbyScreen borre el listener de JuegoScreen.
 * - onMensaje(callback) devuelve unsubscribe.
 * - desconectar() limpia listeners correctamente.
 */

let ws = null;
const listeners = new Set();

let desconexionManual = false;

// =============================================================================
// EMISIÓN INTERNA A LISTENERS
// =============================================================================

function emitirMensaje(msg) {
  listeners.forEach((callback) => {
    try {
      callback(msg);
    } catch (e) {
      console.warn('[Socket] Error en listener:', e);
    }
  });
}

// =============================================================================
// CONEXIÓN
// =============================================================================

/**
 * Abre la conexión WebSocket a ws://<ip>:<puerto>.
 * Resuelve cuando el handshake completa; rechaza si no hay respuesta en 5s.
 */
export function iniciarConexion(ip, puerto = 5000) {
  return new Promise((resolve, reject) => {
    const ipLimpia = String(ip || '').trim();

    if (!ipLimpia) {
      reject(new Error('IP inválida.'));
      return;
    }

    desconexionManual = false;

    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.close();
    }

    const url = `ws://${ipLimpia}:${puerto}`;
    console.log(`[Socket] Conectando a ${url}`);

    ws = new WebSocket(url);

    let terminado = false;

    const finalizarOk = () => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timeout);
      resolve();
    };

    const finalizarError = (error) => {
      if (terminado) return;
      terminado = true;
      clearTimeout(timeout);
      reject(error);
    };

    const timeout = setTimeout(() => {
      try {
        if (ws) ws.close();
      } catch {}

      finalizarError(
        new Error(
          `No se pudo conectar a ${url}.\nVerificá la IP y que el servidor esté corriendo.`
        )
      );
    }, 5000);

    ws.onopen = () => {
      console.log('[Socket] ✓ Conexión establecida');
      finalizarOk();
    };

    ws.onerror = () => {
      finalizarError(
        new Error('Servidor inaccesible. Revisá la IP o el puerto.')
      );
    };

    ws.onclose = () => {
      console.log('[Socket] Conexión cerrada');

      ws = null;

      if (!desconexionManual) {
        emitirMensaje({ tipo: '_Desconectado' });
      }
    };

    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        console.log(`[Socket] ← ${msg.tipo}`, msg);
        emitirMensaje(msg);
      } catch (error) {
        console.warn('[Socket] JSON inválido:', e.data);
      }
    };
  });
}

// =============================================================================
// CALLBACKS DE MENSAJES
// =============================================================================

/**
 * Registra un listener.
 * Devuelve una función para desregistrarlo.
 */
export function onMensaje(callback) {
  if (typeof callback !== 'function') {
    console.warn('[Socket] onMensaje recibió un callback inválido.');
    return () => {};
  }

  listeners.add(callback);

  return () => {
    listeners.delete(callback);
  };
}

/**
 * Elimina un listener específico.
 * Si no recibe callback, limpia todos.
 */
export function offMensaje(callback) {
  if (callback) {
    listeners.delete(callback);
  } else {
    listeners.clear();
  }
}

// =============================================================================
// ENVÍO GENÉRICO
// =============================================================================

/**
 * Envía cualquier objeto JSON al servidor.
 */
export function enviarMensaje(obj) {
  if (!obj || !obj.tipo) {
    console.warn('[Socket] Mensaje inválido:', obj);
    return false;
  }

  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[Socket] No conectado — mensaje descartado:', obj.tipo, obj);
    return false;
  }

  try {
    console.log(`[Socket] → ${obj.tipo}`, obj);
    ws.send(JSON.stringify(obj));
    return true;
  } catch (error) {
    console.warn('[Socket] Error enviando mensaje:', error);
    return false;
  }
}

// =============================================================================
// ACCIONES
// =============================================================================

export function registrarNombre(nombre) {
  return enviarMensaje({
    tipo: 'Unirse',
    nombre,
  });
}

export function listarSalas() {
  return enviarMensaje({
    tipo: 'ListarSalas',
  });
}

export function crearSala(nombreSala) {
  return enviarMensaje({
    tipo: 'CrearSala',
    nombre_sala: nombreSala,
  });
}

export function unirseSala(salaId) {
  return enviarMensaje({
    tipo: 'UnirseSala',
    sala_id: salaId,
  });
}

export function unirseSalaComoVisor(salaId) {
  return enviarMensaje({
    tipo: 'UnirseSala',
    sala_id: salaId,
    como_visor: true,
  });
}

export function salirDeSala(salaId) {
  return enviarMensaje({
    tipo: 'SalirDeSala',
    sala_id: salaId,
  });
}

export function toggleListo(salaId) {
  return enviarMensaje({
    tipo: 'ToggleListo',
    sala_id: salaId,
  });
}

export function iniciarJuego(salaId) {
  return enviarMensaje({
    tipo: 'IniciarJuego',
    sala_id: salaId,
  });
}

export function enviarJugada(salaId, dados, prediccion) {
  return enviarMensaje({
    tipo: 'SubmitJugada',
    sala_id: salaId,
    dados_elegidos: dados,
    prediccion,
  });
}

// =============================================================================
// UTILIDADES
// =============================================================================

/**
 * Cierra la conexión y limpia el estado.
 */
export function desconectar() {
  desconexionManual = true;

  if (ws) {
    try {
      ws.close();
    } catch {}
  }

  ws = null;
  listeners.clear();
}

/**
 * Retorna true si el WebSocket está abierto.
 */
export function estaConectado() {
  return ws !== null && ws.readyState === WebSocket.OPEN;
}

/**
 * Útil para debug.
 */
export function cantidadListeners() {
  return listeners.size;
}