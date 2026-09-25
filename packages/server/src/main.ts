import { createGameServer, DEFAULT_PORT } from './index';

/**
 * Точка входа dev/продакшн: реальный запуск.
 * Отделён от `index.ts`, чтобы сервер можно было импортировать в тесты без
 * побочного запуска порта.
 */
const { gameServer } = createGameServer();
gameServer
  .listen(DEFAULT_PORT)
  .then(() => console.log(`[sf2] сервер слушает :${DEFAULT_PORT}`))
  .catch((err: unknown) => {
    console.error('[sf2] не удалось запустить сервер', err);
    process.exit(1);
  });