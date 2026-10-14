import { useEffect, useRef, useState } from 'react';
import { getMatch } from './engine.ts';
import { FoodArt } from './FoodArt.tsx';
import { CandidateDetails } from '../catalog/CandidateDetails.tsx';
import { stageName } from '../catalog/normalize.ts';
import { CoinDecision } from './CoinDecision.tsx';
import type { CoinLock } from './coin-timing.ts';
import type { ArenaState, Candidate, CatalogSnapshot, Side } from '../shared/contracts.ts';

interface Props {
  state: ArenaState;
  snapshot: CatalogSnapshot;
  arenas: ArenaState[];
  activeIndex: number;
  onChoose: (lock: CoinLock) => void;
  onUndo: () => void;
  onSkip: () => void;
  onPause: () => void;
  onNext: () => void;
  onStageSelect: (index: number) => void;
}

export function referencePrice(item: Candidate): string {
  if (item.variants && item.variants.length > 1) {
    if (item.variants.some(v => v.referencePriceCents === null)) return '各规格参考价';
    const prices = item.variants.map(v => v.referencePriceCents!);
    return `¥${(Math.min(...prices) / 100).toFixed(2)}–${(Math.max(...prices) / 100).toFixed(2)}`;
  }
  return item.referencePriceCents === null ? '参考价未知' : `¥${(item.referencePriceCents / 100).toFixed(2)}`;
}

export function ArenaPage(props: Props) {
  const { state, snapshot, arenas, activeIndex } = props;
  const [busy, setBusy] = useState(false);
  const [highlight, setHighlight] = useState<Side | null>(null);
  const [lastSide, setLastSide] = useState<Side | null>(null);
  const guard = useRef(false);
  const identity = `${state.arenaId}:${state.revision}`;
  const previousIdentity = useRef(identity);
  const previousArenaId = useRef(state.arenaId);
  const latest = useRef(props);
  latest.current = props;
  const timers = useRef(new Set<number>());
  const stageItem = snapshot.items.find(item => item.stageId === state.stageId);
  const stageTitle = stageItem ? stageName(stageItem) : state.stageId;
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  const match = getMatch(state);
  const decisions = Math.max(0, Math.min(state.orderedIds.length - 1, state.challengerIndex - 1));
  const maxDecisions = Math.max(0, state.orderedIds.length - 1);
  const appeared = Math.min(state.orderedIds.length, state.challengerIndex + (state.status === 'complete' ? 0 : 1));
  const champion = state.championId ? items.get(state.championId) : null;

  function claim() {
    if (guard.current || !getMatch(latest.current.state)) return false;
    guard.current = true;
    setBusy(true);
    return true;
  }
  function release() { guard.current = false; setBusy(false); }
  function runAction(action: () => void) {
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    action();
  }
  function manualChoose(side: Side) {
    if (!claim()) return;
    setLastSide(side);
    const current = latest.current.state;
    latest.current.onChoose({ arenaId: current.arenaId, revision: current.revision, finalSide: side });
  }
  function resolveCoin(lock: CoinLock) {
    setLastSide(lock.finalSide);
    latest.current.onChoose(lock);
  }

  useEffect(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    setHighlight(null);
    if (previousArenaId.current !== state.arenaId) {
      previousArenaId.current = state.arenaId;
      setLastSide(null);
    }
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      guard.current = true;
      setBusy(true);
      const timer = window.setTimeout(() => { timers.current.delete(timer); release(); }, window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 360);
      timers.current.add(timer);
    }
    return () => { for (const timer of timers.current) window.clearTimeout(timer); timers.current.clear(); };
  }, [identity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (getMatch(latest.current.state) && !guard.current) {
          event.preventDefault();
          manualChoose(event.key === 'ArrowLeft' ? 'left' : 'right');
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function renderCard(side: Side, item: Candidate) {
    const isLeft = side === 'left';
    return <article key={`${side}:${item.id}`} className={`food-card ${isLeft ? 'champion-card' : 'challenger-card'} ${highlight === side ? 'coin-selected' : ''} ${isLeft && lastSide === 'right' ? 'champion-moves-left' : ''}`} data-food-card={side} data-candidate-id={item.id} data-highlighted={highlight === side}>
      <div className="card-role"><span className="role-dot"/><span>{isLeft ? '擂主' : '挑战者'}</span><span className="card-corner" aria-hidden="true">{isLeft ? '★' : '↗'}</span></div>
      <div className="meal-art-wrap"><div className="meal-halo"/><FoodArt item={item}/></div>
      <div className="meal-copy"><p className="meal-attributes">{item.attributes.join(' · ') || '口味信息未知'}</p><h2>{item.name}</h2><p className="meal-price"><strong>{referencePrice(item)}</strong><span>{snapshot.sourceKind === 'official-snapshot' ? '快照参考' : snapshot.mode === 'demo' ? '样例参考' : '菜单参考'}</span></p><CandidateDetails item={item}/></div>
      <button className="button choose-button" disabled={busy} onClick={() => manualChoose(side)} aria-label={`选择${isLeft ? '擂主' : '挑战者'}：${item.name}`}><span>就吃这份</span><span aria-hidden="true">{isLeft ? '←' : '→'}</span></button>
    </article>;
  }

  return <div className="arena-page" data-page="arena" aria-busy={busy}>
    <nav className="arena-stage-nav" aria-label="赛区进度">{arenas.map((arena, index) => <button key={arena.arenaId} className={`stage-nav-item ${index === activeIndex ? 'current' : ''}`} disabled={busy} onClick={() => { if (index !== activeIndex) runAction(() => props.onStageSelect(index)); }} aria-current={index === activeIndex ? 'step' : undefined}><span>{arena.status === 'complete' ? '✓' : arena.status === 'skipped' ? '−' : String(index + 1).padStart(2, '0')}</span>{(() => { const item = snapshot.items.find(item => item.stageId === arena.stageId); return item ? stageName(item) : arena.stageId; })()}<small>{arena.status === 'skipped' ? '已跳过' : arena.status === 'complete' ? '已完成' : ''}</small></button>)}</nav>
    <div className="arena-heading"><p className="eyebrow">第 {activeIndex + 1} / {arenas.length} 赛区 · {stageTitle}擂台</p><h1>{match ? '哪一份，让你更心动？' : state.status === 'skipped' ? '这一赛区，先留个空位。' : '这次，食欲有了答案。'}</h1><p>{match ? '选出胜者，继续迎接下一份挑战。' : state.status === 'skipped' ? '跳过也没关系，继续去找你的心动餐品。' : `${state.orderedIds.length === 1 ? '你只选了一份，它直接成为' : '全员上场后，你选出的'}${stageTitle}冠军。`}</p></div>
    <div className="arena-progress" aria-label="比赛进度"><div><span>已完成选择</span><strong data-decisions={decisions}>{decisions}<small> / {maxDecisions}</small></strong></div><div className="progress-track" role="progressbar" aria-label="选择进度" aria-valuemin={0} aria-valuemax={maxDecisions || 1} aria-valuenow={decisions} style={{ '--progress': `${maxDecisions ? decisions / maxDecisions * 100 : 100}%` } as React.CSSProperties}><span/></div><div><span>候选已出场</span><strong data-appeared={appeared}>{appeared}<small> / {state.orderedIds.length}</small></strong></div></div>
    {match ? <><div className="pk-board" data-round={state.revision}>{renderCard('left', items.get(match.leftId)!)}<div className="vs-badge" aria-hidden="true"><span>VS</span><small>PK</small></div>{renderCard('right', items.get(match.rightId)!)}</div><CoinDecision state={state} disabled={busy} claim={claim} onHighlight={setHighlight} onResolve={resolveCoin} onRelease={release}/><p className="keyboard-hint">也可以按 <kbd>←</kbd> <kbd>→</kbd> 选择左右餐品</p></> : <div className={`stage-finished ${state.status === 'skipped' ? 'stage-skipped' : ''}`} data-stage-result={state.status}>{champion ? <><span className="winner-ribbon">本区冠军</span><FoodArt item={champion}/><h2>{champion.name}</h2><p>{referencePrice(champion)} <span>· {snapshot.sourceKind === 'official-snapshot' ? '快照参考价' : snapshot.mode === 'demo' ? '样例参考价' : '菜单参考价'}</span></p><CandidateDetails item={champion}/></> : <><div className="skip-symbol" aria-hidden="true">↗</div><h2>{stageTitle}赛区已跳过</h2><p>这一轮不产生冠军</p></>}<button className="button button-primary" disabled={busy} onClick={() => runAction(props.onNext)}>{arenas.some((arena, index) => index > activeIndex && arena.status === 'active') ? '去下一赛区' : activeIndex < arenas.length - 1 ? '查看下一赛区' : '看看我的冠军'} <span aria-hidden="true">→</span></button></div>}
    <div className="arena-tools"><button disabled={busy || state.history.length === 0} onClick={() => runAction(() => { setLastSide(null); props.onUndo(); })}><span aria-hidden="true">↶</span> 上一步</button>{state.status !== 'skipped' && <button disabled={busy} onClick={() => runAction(props.onSkip)}>跳过本赛区 <span aria-hidden="true">↗</span></button>}<button disabled={busy} onClick={() => runAction(props.onPause)}>暂存并暂停 <span aria-hidden="true">Ⅱ</span></button></div>
  </div>;
}
