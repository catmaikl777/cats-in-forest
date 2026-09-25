import { useCallback, useEffect, useRef, useState } from 'react';
import Phaser from 'phaser';
import { GAME_NAME, SERVER_URL } from './config';
import { NetClient, type NetStatus } from './net/NetClient';
import { FightClient } from './net/FightClient';
import { FightScene } from './game/FightScene';

const CANVAS_ID = 'fight-canvas';
const PLAYER_NAME = `shadow_${Math.floor(Math.random() * 9000 + 1000)}`;

type MatchPhase = 'idle' | 'queue' | 'fighting' | 'result';

interface MatchOutcome {
  winner: number;
  wins: [number, number];
  mySide: number;
}

/**
 * Корневой компонент лобби:
 * - heartbeat NetClient — индикатор «сервер/сеть» в шапке;
 * - FIND MATCH — создаёт FightClient (бинарный канал боя) и кладёт его в
 *   реестр Phaser; FightScene рендерит его мир и кормит входы джойстика;
 * - оверлеи «поиск противника» / «бой» / «результат» поверх канваса.
 */
export function App(): React.ReactElement {
  const [status, setStatus] = useState<NetStatus>('disconnected');
  const [error, setError] = useState<string | null>(null);
  const [match, setMatch] = useState<MatchPhase>('idle');
  const [outcome, setOutcome] = useState<MatchOutcome | null>(null);

  const gameRef = useRef<Phaser.Game | null>(null);
  const netRef = useRef<NetClient | null>(null);
  const fightRef = useRef<FightClient | null>(null);

  const registry = (): Phaser.Data.DataManager | undefined => gameRef.current?.registry;

  useEffect(() => {
    const net = new NetClient(SERVER_URL);
    netRef.current = net;
    net.onStatusChange = (s) => setStatus(s);

    const canvasEl = document.getElementById(CANVAS_ID);
    if (canvasEl && !gameRef.current) {
      const game = new Phaser.Game({
        type: Phaser.AUTO,
        parent: canvasEl,
        width: 960,
        height: 540,
        backgroundColor: '#0b0d12',
        scene: [FightScene],
        scale: {
          mode: Phaser.Scale.FIT,
          autoCenter: Phaser.Scale.CENTER_BOTH,
        },
      });
      game.registry.set('net', net);
      gameRef.current = game;
    }

    net.connect(PLAYER_NAME).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      net.onStatusChange = null;
      if (netRef.current) void netRef.current.disconnect();
      if (fightRef.current) void fightRef.current.leave();
      if (gameRef.current) {
        gameRef.current.destroy(true);
        gameRef.current = null;
      }
    };
  }, []);

  const startMatch = useCallback(async () => {
    setError(null);
    setOutcome(null);
    setMatch('queue');
    const fight = new FightClient(SERVER_URL);
    fight.setHandlers({
      onTick: () => setMatch((m) => (m === 'result' ? m : 'fighting')),
      onResult: (r) => {
        setOutcome({ winner: r.winner, wins: r.wins, mySide: fight.side });
        setMatch('result');
      },
      onError: (msg) => {
        setError(msg);
        registry()?.remove('fight');
        fightRef.current = null;
        setMatch('idle');
      },
      onLeave: () => {
        registry()?.remove('fight');
        fightRef.current = null;
        setOutcome(null);
        setMatch('idle');
      },
    });
    fightRef.current = fight;
    registry()?.set('fight', fight);
    try {
      await fight.findMatch(PLAYER_NAME);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      registry()?.remove('fight');
      fightRef.current = null;
      setMatch('idle');
    }
  }, []);

  const quitMatch = useCallback(async () => {
    registry()?.remove('fight');
    const f = fightRef.current;
    fightRef.current = null;
    setOutcome(null);
    setMatch('idle');
    await f?.leave();
  }, []);

  const reconnect = useCallback(() => {
    setError(null);
    netRef.current
      ?.connect(PLAYER_NAME)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)));
  }, []);

  const inMatch = match !== 'idle';
  const victory = outcome !== null && outcome.winner === outcome.mySide;

  return (
    <div className="app">
      <header className="topbar">
        <h1>{GAME_NAME}</h1>
        <div className="pill-row">
          <span className={`pill pill--${status}`}>{status === 'connected' ? 'online' : status}</span>
          {match === 'fighting' && <span className="pill pill--active">FIGHT</span>}
          {match === 'queue' && <span className="pill">…searching</span>}
        </div>
      </header>

      <div className="stage">
        <div id={CANVAS_ID} className="canvas-wrap" />

        {match === 'queue' && (
          <div className="overlay">
            <div className="overlay__box">
              <div className="overlay__title">ПОИСК ПРОТИВНИКА…</div>
              <div className="overlay__hint">два бойца — и начнётся отсчёт</div>
              <button type="button" className="btn btn--ghost" onClick={() => void quitMatch()}>
                cancel
              </button>
            </div>
          </div>
        )}

        {match === 'result' && outcome && (
          <div className="overlay">
            <div className="overlay__box">
              <div className={`overlay__title overlay__title--${victory ? 'win' : 'lose'}`}>
                {victory ? 'VICTORY' : 'DEFEAT'}
              </div>
              <div className="overlay__hint">
                {outcome.wins[0]} : {outcome.wins[1]} · side {outcome.mySide}
              </div>
              <button type="button" className="btn" onClick={() => void quitMatch()}>
                В ЛОББИ
              </button>
            </div>
          </div>
        )}

        {match === 'fighting' && (
          <button type="button" className="btn btn--quit" onClick={() => void quitMatch()}>
            ✕ quit
          </button>
        )}
      </div>

      <footer className="statusbar">
        <span>{SERVER_URL}</span>
        {!inMatch && (
          <button type="button" className="btn" disabled={status !== 'connected'} onClick={() => void startMatch()}>
            FIND MATCH
          </button>
        )}
        {status === 'error' && (
          <button type="button" className="btn btn--ghost" onClick={reconnect}>
            reconnect
          </button>
        )}
        {error && <em className="error">{error}</em>}
      </footer>
    </div>
  );
}