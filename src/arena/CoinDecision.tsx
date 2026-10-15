import { useEffect, useRef, useState } from 'react';
import type { ArenaState, Side } from '../shared/contracts.ts';
import { coinTimeline, lockMatchesArena, sideFromByte, type CoinLock } from './coin-timing.ts';

interface Props {
  state: ArenaState;
  disabled: boolean;
  claim: () => boolean;
  onHighlight: (side: Side | null) => void;
  onResolve: (lock: CoinLock) => void;
  onRelease: () => void;
}

export function CoinDecision(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const locked = useRef<CoinLock | null>(null);
  const timers = useRef(new Set<number>());
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'revealed'>('idle');
  const [finalSide, setFinalSide] = useState<Side | null>(null);

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
  }
  function schedule(callback: () => void, atMs: number) {
    const timer = window.setTimeout(() => { timers.current.delete(timer); callback(); }, atMs);
    timers.current.add(timer);
  }
  function finish(lock: CoinLock) {
    if (locked.current !== lock) return;
    clearTimers();
    locked.current = null;
    if (lockMatchesArena(lock, latest.current.state)) latest.current.onResolve(lock);
  }
  function reveal(lock: CoinLock, immediate = false) {
    if (locked.current !== lock || !lockMatchesArena(lock, latest.current.state)) return;
    clearTimers();
    latest.current.onHighlight(lock.finalSide);
    setFinalSide(lock.finalSide);
    setPhase('revealed');
    if (immediate) finish(lock);
    else schedule(() => finish(lock), 180);
  }

  useEffect(() => {
    setPhase('idle');
    setFinalSide(null);
    locked.current = null;
    clearTimers();
    return () => { locked.current = null; clearTimers(); };
  }, [props.state.arenaId, props.state.revision]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onVisibility = () => {
      const lock = locked.current;
      if (lock && document.visibilityState === 'hidden') reveal(lock, true);
    };
    const onMotionChange = () => { if (reducedMotion.matches && locked.current) reveal(locked.current); };
    document.addEventListener('visibilitychange', onVisibility);
    reducedMotion.addEventListener('change', onMotionChange);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onMotionChange);
    };
  }, []);

  function toss() {
    if (locked.current || !latest.current.claim()) return;
    let byte: Uint8Array;
    try {
      byte = crypto.getRandomValues(new Uint8Array(1));
    } catch {
      latest.current.onRelease();
      return;
    }
    const lock: CoinLock = { arenaId: props.state.arenaId, revision: props.state.revision, finalSide: sideFromByte(byte[0]) };
    locked.current = lock;
    setPhase('spinning');
    setFinalSide(null);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState === 'hidden') {
      reveal(lock, document.visibilityState === 'hidden');
      return;
    }
    const stops = coinTimeline(lock.finalSide);
    for (const [index, stop] of stops.entries()) schedule(() => {
      if (locked.current !== lock || !lockMatchesArena(lock, latest.current.state)) return;
      latest.current.onHighlight(stop.side);
      if (index === stops.length - 1) reveal(lock);
    }, stop.atMs);
  }

  return <div className="coin-control" data-coin-phase={phase} data-final-side={finalSide ?? ''}>
    <button className={`button button-primary coin-button ${phase === 'spinning' ? 'coin-spinning' : ''}`} disabled={props.disabled} onClick={toss} aria-label="抛硬币选一份"><span className="coin-icon" aria-hidden="true"><span>✦</span></span>{phase === 'spinning' ? '硬币正在选…' : phase === 'revealed' ? `就选${finalSide === 'left' ? '左边' : '右边'}！` : '抛硬币选一份'}</button>
    <p className="coin-caption" aria-live="polite">{phase === 'revealed' ? `硬币选中了${finalSide === 'left' ? '左侧餐品' : '右侧餐品'}` : '拿不定主意？抛硬币随机选一边。'}</p>
  </div>;
}
