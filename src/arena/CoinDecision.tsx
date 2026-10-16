import { useEffect, useRef, useState } from 'react';
import type { ArenaState, Side } from '../shared/contracts.ts';
import { coinTimeline, coinFlightPath, lockMatchesArena, sideFromByte, coinRevealMs, type CoinLock } from './coin-timing.ts';

interface Props {
  state: ArenaState;
  disabled: boolean;
  claim: () => boolean;
  onHighlight: (side: Side | null) => void;
  onResolve: (lock: CoinLock) => boolean | void;
  onRelease: () => void;
}

export function CoinDecision(props: Props) {
  const latest = useRef(props);
  latest.current = props;
  const locked = useRef<CoinLock | null>(null);
  const timers = useRef(new Set<number>());
  const animations = useRef(new Set<Animation>());
  const flightElement = useRef<HTMLDivElement>(null);
  const shadowElement = useRef<HTMLSpanElement>(null);
  const [phase, setPhase] = useState<'idle' | 'spinning' | 'revealed'>('idle');
  const [finalSide, setFinalSide] = useState<Side | null>(null);
  const [stopSide, setStopSide] = useState<Side | null>(null);
  const [sealedSide, setSealedSide] = useState<Side>('left');
  const [stopIndex, setStopIndex] = useState(-1);
  const [gap, setGap] = useState(80);

  function clearTimers() {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
  }
  function schedule(callback: () => void, atMs: number) {
    const timer = window.setTimeout(() => { timers.current.delete(timer); callback(); }, atMs);
    timers.current.add(timer);
  }
  function finish(lock: CoinLock) {
    if (locked.current !== lock) return;
    clearTimers();
    locked.current = null;
    if (!lockMatchesArena(lock, latest.current.state)||latest.current.onResolve(lock)===false) { setPhase('idle');setFinalSide(null);setStopSide(null);setStopIndex(-1);latest.current.onHighlight(null);latest.current.onRelease(); }
  }
  function reveal(lock: CoinLock, immediate = false) {
    if (locked.current !== lock || !lockMatchesArena(lock, latest.current.state)) return;
    clearTimers();
    latest.current.onHighlight(lock.finalSide);
    setFinalSide(lock.finalSide);
    setPhase('revealed');
    if (immediate) finish(lock);
    else schedule(() => finish(lock), coinRevealMs);
  }

  useEffect(() => {
    setPhase('idle');
    setFinalSide(null);
    setStopSide(null);
    setStopIndex(-1);
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
    setSealedSide(lock.finalSide);
    setStopSide(null);
    setStopIndex(-1);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.visibilityState === 'hidden') {
      reveal(lock, document.visibilityState === 'hidden');
      return;
    }
    const stops = coinTimeline(lock.finalSide);
    const path = coinFlightPath(lock.finalSide);
    const duration = path.at(-1)!.atMs;
    // The visual trajectory and semantic stops use the same clock. Each side is
    // reached at its stop time, including the final crossing before reveal.
    const frames = path.map(point => ({
      transform: `translateX(calc(${point.side === 'left' ? -1 : point.side === 'right' ? 1 : 0} * var(--coin-travel))) translateY(${-point.height}px)`,
      offset: point.atMs / duration,
      easing: 'cubic-bezier(.3,.6,.35,1)',
    }));
    if (flightElement.current?.animate) animations.current.add(flightElement.current.animate(frames, { duration, fill: 'both' }));
    if (shadowElement.current?.animate) animations.current.add(shadowElement.current.animate(path.map(point => ({ transform: `translateY(${point.height}px) scaleX(${1 - point.height / 80})`, offset: point.atMs / duration, easing: 'cubic-bezier(.3,.6,.35,1)' })), { duration, fill: 'both' }));
    for (const [index, stop] of stops.entries()) schedule(() => {
      if (locked.current !== lock || !lockMatchesArena(lock, latest.current.state)) return;
      setStopSide(stop.side);
      setStopIndex(index);
      setGap(index === 0 ? stop.atMs : stop.atMs - stops[index - 1].atMs);
      latest.current.onHighlight(stop.side);
      if (index === stops.length - 1) reveal(lock);
    }, stop.atMs);
  }

  const motionStyle = {
    '--coin-direction': stopSide === 'left' ? -1 : stopSide === 'right' ? 1 : 0,
    '--coin-height': `${phase === 'revealed' ? 0 : Math.max(0, 24 - Math.max(0, stopIndex) * 2)}px`,
    '--coin-gap': `${gap}ms`,
    '--coin-turns': sealedSide === 'left' ? '1800deg' : '1980deg',
    '--coin-duration': `${coinTimeline(sealedSide).at(-1)!.atMs}ms`,
  } as React.CSSProperties;
  return <div className="coin-control motion-coin-control" data-coin-phase={phase} data-final-side={finalSide ?? ''} style={motionStyle}>
    <div className="coin-scene" aria-hidden="true"><span className="coin-side coin-side-left">左</span><span className="coin-side coin-side-right">右</span><div className="coin-rail"/><div className="coin-flight" ref={flightElement}><span className="coin-shadow" ref={shadowElement}/><span className="coin-body"><span className="coin-face coin-front">L</span><span className="coin-face coin-back">R</span></span><span className="coin-landing-ring"/></div></div>
    <button className="button coin-button" disabled={props.disabled} onClick={toss} aria-label="抛硬币选一份"><span className="coin-icon" aria-hidden="true"><span>✦</span></span>{phase === 'spinning' ? '正在抛硬币…' : phase === 'revealed' ? `就选${finalSide === 'left' ? '左边' : '右边'}！` : '抛硬币选一份'}</button>
    <p className="coin-caption" aria-live="polite">{phase === 'spinning' ? '硬币正在左右选…' : phase === 'revealed' ? `硬币选中了${finalSide === 'left' ? '左侧餐品' : '右侧餐品'}` : '拿不定主意？抛硬币随机选一边。'}</p>
  </div>;
}
