/**
 * Конфигурация клиента. URL сервера можно переопределить env-переменными
 * Vite: VITE_SERVER_URL / VITE_SERVER_HOST / VITE_SERVER_PORT.
 */
function resolveServerUrl(): string {
  const explicit = import.meta.env.VITE_SERVER_URL as string | undefined;
  if (explicit) return explicit;
  const host = (import.meta.env.VITE_SERVER_HOST as string | undefined) ?? window.location.hostname;
  const port = (import.meta.env.VITE_SERVER_PORT as string | undefined) ?? '2567';
  return `ws://${host}:${port}`;
}

export const SERVER_URL = resolveServerUrl();
export const GAME_NAME = 'Shadow Duel';