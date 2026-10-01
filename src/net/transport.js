import { RealtimeClient } from '@supabase/realtime-js';

/**
 * Canales de mensajes para el online. Dos implementaciones con la misma interfaz:
 *  - Supabase Realtime (broadcast): jugadores en distintas computadoras.
 *  - BroadcastChannel: pestañas del mismo navegador (desarrollo, o si faltan las variables de Supabase).
 *
 * open(name) → Promise<{ send(msg), onMessage(fn), close() }>. Los mensajes son objetos JSON
 * y no le llegan a quien los manda.
 */

const URL = import.meta.env.VITE_SUPABASE_URL;
const KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
// ?net=local fuerza las pestañas locales aunque haya Supabase (útil para probar sin internet)
const FORCE_LOCAL = new URLSearchParams(location.search).get('net') === 'local';

export const transportKind = URL && KEY && !FORCE_LOCAL ? 'supabase' : 'local';

let client = null;

export function openChannel(name) {
  return transportKind === 'supabase' ? openSupabase(name) : openLocal(name);
}

function openSupabase(name) {
  client ??= new RealtimeClient(`${URL.replace(/^http/, 'ws')}/realtime/v1`, {
    params: { apikey: KEY, eventsPerSecond: 40 },
  });
  const channel = client.channel(name, { config: { broadcast: { self: false, ack: false } } });
  const handlers = [];
  channel.on('broadcast', { event: 'm' }, ({ payload }) => handlers.forEach((fn) => fn(payload)));
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => !done && reject(new Error('Tiempo de conexión agotado')), 10000);
    channel.subscribe((status, err) => {
      if (done) return;
      if (status === 'SUBSCRIBED') {
        done = true;
        clearTimeout(timer);
        resolve({
          send: (msg) => channel.send({ type: 'broadcast', event: 'm', payload: msg }),
          onMessage: (fn) => handlers.push(fn),
          close: () => client.removeChannel(channel),
        });
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        done = true;
        clearTimeout(timer);
        reject(err ?? new Error(`No se pudo conectar (${status})`));
      }
    });
  });
}

function openLocal(name) {
  const bc = new BroadcastChannel(`vm:${name}`);
  const handlers = [];
  bc.onmessage = (e) => handlers.forEach((fn) => fn(e.data));
  return Promise.resolve({
    send: (msg) => bc.postMessage(msg),
    onMessage: (fn) => handlers.push(fn),
    close: () => bc.close(),
  });
}
