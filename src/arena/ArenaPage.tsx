import { useEffect, useRef, useState } from 'react';
import { mcdMemes } from '../copy/MemeSources.tsx';
import { isSelectable, type AvailabilityResult } from '../commerce/availability-contracts.ts';
import { AvailabilityNotice } from '../commerce/AvailabilityNotice.tsx';
import { resolveAvailableChoice } from '../commerce/state.ts';
import { completedChoices, getMatch } from './engine.ts';
import { FoodArt } from './FoodArt.tsx';
import { CouponDetails } from '../commerce/CouponDetails.tsx';
import type { CouponCollection } from '../commerce/contracts.ts';
import { CandidateDetails } from '../catalog/CandidateDetails.tsx';
import { stageName } from '../catalog/normalize.ts';
import { CoinDecision } from './CoinDecision.tsx';
import { selectionFeedbackMs, roundTransitionMs, type CoinLock } from './coin-timing.ts';
import type { ArenaState, Candidate, CatalogSnapshot, Side } from '../shared/contracts.ts';

interface Props {
  availability?: AvailabilityResult | null;
  onRedraw?: () => void;
  coupons?: CouponCollection | null;
  state: ArenaState;
  snapshot: CatalogSnapshot;
  arenas: ArenaState[];
  activeIndex: number;
  onChoose: (lock: CoinLock) => boolean | void;
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
  const [flight, setFlight] = useState<{ arenaId: string; revision: number; side: Side; left: Candidate; right: Candidate } | null>(null);
  const guard = useRef(false);
  const identity = `${state.arenaId}:${state.revision}`;
  const previousIdentity = useRef(identity);
  const latest = useRef(props);
  latest.current = props;
  const timers = useRef(new Set<number>());
  const stageItem = snapshot.items.find(item => item.stageId === state.stageId);
  const stageTitle = stageItem ? stageName(stageItem) : state.stageId;
  const items = new Map(snapshot.items.map(item => [item.id, item]));
  const match = getMatch(state);
  const decisions = completedChoices(state);
  const maxDecisions = Math.max(0, state.orderedIds.length - 1);
  const remaining = state.remainingIds.length;
  const champion = state.championId ? items.get(state.championId) : null;

  const statusFor=(id:string)=>latest.current.availability?.items.find(i=>i.candidateId===id);
  const selectable=(id:string)=>isSelectable(statusFor(id));
  const coinAllowed=!!match&&selectable(match.leftId)&&selectable(match.rightId);

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
    const pair=getMatch(latest.current.state);if(!pair||!selectable(side==='left'?pair.leftId:pair.rightId)||!claim())return;
    const current = latest.current.state;
    commit({ arenaId: current.arenaId, revision: current.revision, finalSide: side });
  }
  function commit(lock:CoinLock):boolean {
    let accepted=false;
    const valid=resolveAvailableChoice(latest.current.state,lock,selectable,()=>{
      accepted=latest.current.onChoose(lock)!==false;
      if(accepted)rememberFlight(latest.current.state,lock.finalSide);else release();
    },release);
    return valid&&accepted;
  }
  function resolveCoin(lock:CoinLock){return commit(lock);}
  function rememberFlight(current: ArenaState, side: Side) {
    const pair = getMatch(current);
    if (!pair) return;
    setFlight({ arenaId: current.arenaId, revision: current.revision + 1, side, left: items.get(pair.leftId)!, right: items.get(pair.rightId)! });
  }

  useEffect(() => {
    for (const timer of timers.current) window.clearTimeout(timer);
    timers.current.clear();
    setHighlight(null);
    if (previousIdentity.current !== identity) {
      previousIdentity.current = identity;
      guard.current = true;
      setBusy(true);
      const selected = flight?.arenaId === state.arenaId && flight.revision === state.revision;
      const waitMs = selected ? selectionFeedbackMs : window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : roundTransitionMs;
      const timer = window.setTimeout(() => { timers.current.delete(timer); setFlight(null); release(); }, waitMs);
      timers.current.add(timer);
    }
    return () => { for (const timer of timers.current) window.clearTimeout(timer); timers.current.clear(); };
  }, [identity]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof Element && target.closest('input, textarea, select, summary, button, a, [role="dialog"], [data-keyboard-isolation], [contenteditable="true"]')) return;
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

  function renderCard(side: Side, item: Candidate, ghost = false) {
    const availability=props.availability?.items.find(i=>i.candidateId===item.id);
    const unavailable=!isSelectable(availability);
    const isLeft = side === 'left';
    const isFries = item.stageId === 'side' && item.name.includes('薯条');
    const isPie = item.stageId === 'dessert' && /(?:菠萝|香芋)派/.test(item.name);
    const tag = isFries ? mcdMemes.friesFan.text : isPie ? mcdMemes.pieLike.text : item.name === '麦乐鸡' ? mcdMemes.nugget.text : null;
    return <div className="choice-column" data-choice-side={side} key={`${side}:${item.id}`}>
      <article className={`food-card whole-card-choice ${ghost ? flight?.side === side ? 'choice-ghost flight-picked' : 'choice-ghost flight-dismissed' : 'choice-dealt'} ${!ghost && highlight === side ? 'coin-selected' : ''}`} data-food-card={ghost ? undefined : side} data-candidate-id={ghost ? undefined : item.id} data-highlighted={!ghost && highlight === side}>
        {!ghost && <button type="button" className="card-choice-target" data-choice-button={side} disabled={busy||unavailable} onClick={() => manualChoose(side)} aria-label={`${mcdMemes.like.text}：${isLeft ? '左边' : '右边'}的${item.name}`}/>}
        <div className="card-content">
          <div className="card-role"><span className="role-dot"/><span>{isLeft ? '左侧商品' : '右侧商品'}</span>{tag && <span className="meme-food-tag">{tag}</span>}</div>
          <div className={`meal-art-wrap${unavailable?' availability-image-unavailable':''}`}><div className="meal-halo"/><FoodArt item={item} priority/></div>
          <div className="meal-copy"><p className="meal-attributes">{item.attributes.join(' · ') || '口味信息未知'}</p><h2>{item.name}</h2>{(!item.variants||item.variants.length===1&&item.variants[0].sizeLabel==='固定口味') && <p className="meal-price"><strong>{referencePrice(item)}</strong><span>{snapshot.sourceKind === 'official-snapshot' ? '快照参考' : snapshot.mode === 'demo' ? '样例参考' : '菜单参考'}</span></p>}<CandidateDetails item={item} availability={availability} showNutrition={false}/><AvailabilityNotice item={availability}/></div>
          <div className="card-choice-hint" aria-hidden="true"><span>{mcdMemes.like.text}</span><span className="card-choice-arrow">{isLeft ? '←' : '→'}</span></div>
        </div>
        {ghost && flight?.side === side && <span className="selection-stamp">{isFries ? mcdMemes.friesLike.text : isPie ? mcdMemes.pieWish.text : mcdMemes.like.text}<small>保留候选</small></span>}
      </article>
      {!ghost && <div className="card-info"><CandidateDetails item={item} showPrices={false} showNutrition={item.stageId!=='other'}/><CouponDetails item={item} collection={props.coupons}/></div>}
    </div>;
  }

  return <div className="arena-page" data-page="arena" aria-busy={busy}>
    <nav className="arena-stage-nav" aria-label="挑选进度">{arenas.map((arena, index) => <button key={arena.arenaId} className={`stage-nav-item ${index === activeIndex ? 'current' : ''}`} disabled={busy} onClick={() => { if (index !== activeIndex) runAction(() => props.onStageSelect(index)); }} aria-current={index === activeIndex ? 'step' : undefined}><span>{arena.status === 'complete' ? '✓' : arena.status === 'skipped' ? '−' : String(index + 1).padStart(2, '0')}</span>{(() => { const item = snapshot.items.find(item => item.stageId === arena.stageId); return item ? stageName(item) : arena.stageId; })()}<small>{arena.status === 'skipped' ? '已跳过' : arena.status === 'complete' ? '已完成' : ''}</small></button>)}</nav>
    <div className="arena-heading"><p className="eyebrow">第 {activeIndex + 1} / {arenas.length} 类 · {stageTitle}挑选</p><h1>{match ? '这两份，选你喜欢的' : state.status === 'skipped' ? '这一类，先留个空位。' : '这一类，选好了'}</h1><p>{match ? '点整张卡面选一份。营养详情在卡片下方。' : state.status === 'skipped' ? '这类先跳过，不往餐单里加餐品。' : `${state.orderedIds.length === 1 ? '你只留了一份，就直接选这份' : '最后留下的这份'}${stageTitle}。`}</p></div>
    <div className="arena-progress" aria-label="挑选进度"><div><span>已选次数</span><strong data-decisions={decisions}>{decisions}<small> / {maxDecisions}</small></strong></div><div className="progress-track" role="progressbar" aria-label="选择进度" aria-valuemin={0} aria-valuemax={maxDecisions || 1} aria-valuenow={decisions} style={{ '--progress': `${maxDecisions ? decisions / maxDecisions * 100 : 100}%` } as React.CSSProperties}><span/></div><div><span>剩余候选</span><strong data-remaining={remaining}>{remaining}<small> / {state.orderedIds.length}</small></strong></div></div>
    {match ? <>
      <CoinDecision state={state} disabled={busy||!coinAllowed} claim={()=>coinAllowed&&claim()} onHighlight={setHighlight} onResolve={resolveCoin} onRelease={release}/>
      <div className="pk-board whole-card-board" data-round={state.revision}>
        {renderCard('left', items.get(match.leftId)!)}
        <div className="vs-badge" aria-hidden="true"><span>OR</span><small>二选一</small></div>
        {renderCard('right', items.get(match.rightId)!)}
        {flight && flight.arenaId === state.arenaId && flight.revision === state.revision && <div className="choice-flight-layer" aria-hidden="true" inert key={identity} style={{ '--choice-feedback-duration': `${selectionFeedbackMs}ms` } as React.CSSProperties}>{renderCard('left', flight.left, true)}{renderCard('right', flight.right, true)}</div>}
      </div>
      {!coinAllowed&&<p className="notice">当前有餐品未返回，硬币暂时不可用。可选另一份、跳过或调整分类。</p>}
      {match&&!selectable(match.leftId)&&!selectable(match.rightId)&&props.onRedraw&&<button className="button button-outline" disabled={busy} onClick={props.onRedraw}>换一组可选餐品</button>}
      <p className="keyboard-hint">也可以按 <kbd>←</kbd> <kbd>→</kbd> 选择左右餐品</p>
    </> : <div className={`stage-finished ${state.status === 'skipped' ? 'stage-skipped' : ''}`} data-stage-result={state.status}>
      {champion ? <>
        <div className="stage-confetti" aria-hidden="true">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ '--confetti-index': i } as React.CSSProperties}/>)}</div>
        <span className="winner-ribbon">已选商品</span><FoodArt item={champion}/><h2>{champion.name}</h2>
        <p className="stage-meme">{champion.stageId === 'side' && champion.name.includes('薯条') ? mcdMemes.friesLike.text : champion.stageId === 'dessert' && /(?:菠萝|香芋)派/.test(champion.name) ? mcdMemes.pieWish.text : mcdMemes.like.text}</p>
        <p>{referencePrice(champion)} <span>· {snapshot.sourceKind === 'official-snapshot' ? '快照参考价' : snapshot.mode === 'demo' ? '样例参考价' : '菜单参考价'}</span></p>
        <CandidateDetails item={champion} showNutrition={champion.stageId!=='other'}/>
      </> : <><div className="skip-symbol" aria-hidden="true">↗</div><h2>{stageTitle}已跳过</h2><p>这一类不添加餐品</p></>}
      <button className="button button-primary" disabled={busy} onClick={() => runAction(props.onNext)}>{arenas.some((arena, index) => index > activeIndex && arena.status === 'active') ? '挑选下一类' : activeIndex < arenas.length - 1 ? '查看下一类' : '查看我的餐单'} <span aria-hidden="true">→</span></button>
    </div>}
    <div className="arena-tools"><button disabled={busy || state.history.length === 0} onClick={() => runAction(props.onUndo)}><span aria-hidden="true">↶</span> 上一步</button>{state.status !== 'skipped' && <button disabled={busy} onClick={() => runAction(props.onSkip)}>跳过这类 <span aria-hidden="true">↗</span></button>}<button disabled={busy} onClick={() => runAction(props.onPause)}>保存并暂停 <span aria-hidden="true">Ⅱ</span></button></div>
  </div>;
}
