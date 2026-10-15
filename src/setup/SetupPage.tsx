import { useState } from 'react';
import { mcdMemes } from '../copy/MemeSources.tsx';
import { FoodArt } from '../arena/FoodArt.tsx';
import { stageName } from '../catalog/normalize.ts';
import type { CatalogSnapshot } from '../shared/contracts.ts';
import type { StageSelection } from './session.ts';

interface Props {
  snapshot: CatalogSnapshot;
  selection: StageSelection[];
  onSelectionChange: (selection: StageSelection[]) => void;
  onStart: () => void;
  onResume: () => void;
  hasSaved: boolean;
  message: string | null;
}

export function SetupPage({ snapshot, selection, onSelectionChange, onStart, onResume, hasSaved, message }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const stages = [...new Set(snapshot.items.map(item => item.stageId))].map(id => ({
    id, items: snapshot.items.filter(item => item.stageId === id),
  }));
  const totalDecisions = selection.reduce((sum, stage) => sum + Math.max(0, stage.candidateIds.length - 1), 0);
  const canStart = snapshot.complete && selection.length > 0 && selection.every(stage => stage.candidateIds.length > 0);

  function toggleStage(id: string) {
    onSelectionChange(selection.some(stage => stage.id === id)
      ? selection.filter(stage => stage.id !== id)
      : [...selection, { id, candidateIds: snapshot.items.filter(item => item.stageId === id).map(item => item.id) }]);
  }
  function moveStage(index: number, offset: number) {
    const next = [...selection];
    [next[index], next[index + offset]] = [next[index + offset], next[index]];
    onSelectionChange(next);
  }
  function toggleCandidate(stageId: string, id: string) {
    onSelectionChange(selection.map(stage => stage.id !== stageId ? stage : {
      ...stage, candidateIds: stage.candidateIds.includes(id) ? stage.candidateIds.filter(candidateId => candidateId !== id)
        : snapshot.items.filter(item => item.stageId === stageId && (item.id === id || stage.candidateIds.includes(item.id))).map(item => item.id),
    }));
  }

  return <div className="setup-page" data-page="setup">
    <section className="setup-hero">
      <div className="hero-copy"><p className="eyebrow"><span className="mini-line" /> {mcdMemes.fan.text}</p><h1>今天吃什么？<span>{mcdMemes.like.text}</span></h1><p className="hero-description">每轮随机抽两份，选你更想吃的。<br className="desktop-break"/>选中留在候选里，没选移出，继续随机抽。每类最后留一份。</p><div className="hero-tags"><span>随机二选一</span><span>可用硬币决定</span></div></div>
      <div className="hero-art" aria-hidden="true"><div className="hero-art-circle"/><div className="hero-orbit orbit-one"/><div className="hero-orbit orbit-two"/><span className="hero-spark spark-one">✦</span><span className="hero-spark spark-two">✦</span>{snapshot.items[0] && <FoodArt item={snapshot.items.find(item => item.stageId === 'burger') ?? snapshot.items[0]} className="hero-burger"/>}{snapshot.items.find(item => item.stageId === 'drink' || item.stageId === 'coffee') && <FoodArt item={snapshot.items.find(item => item.stageId === 'drink' || item.stageId === 'coffee')!} className="hero-drink"/>}<span className="hero-sticker">{mcdMemes.eternal.text}</span></div>
    </section>
    {(snapshot.mode === 'live' || snapshot.sourceKind === 'official-snapshot') && <p className={`catalog-status ${snapshot.complete ? '' : 'catalog-incomplete'}`} role="status">{snapshot.complete ? `${snapshot.items.length} 份真实餐品 · ${stages.length} 类可选` : '菜单尚未完整，请刷新后开始挑选'}</p>}
    {hasSaved && <div className="resume-banner"><div><strong>上次的选择还在</strong><p>接着选，不用从头再来。</p></div><button className="button button-outline" onClick={onResume}>接着选 <span aria-hidden="true">↗</span></button></div>}
    {message && <p role="status" className="notice">{message}</p>}
    <div className="setup-workspace"><section aria-labelledby="categories-title" className="category-section"><div className="section-heading"><div><p className="eyebrow">01 / 挑选分类</p><h2 id="categories-title">先选想吃的几类</h2></div><p>可多选；展开下方，还能挑餐品、排顺序</p></div>
      <div className="category-grid">{stages.map(stage => {
        const selected = selection.some(value => value.id === stage.id);
        return <button key={stage.id} className={`category-chip ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={() => toggleStage(stage.id)} data-stage-chip={stage.id}><FoodArt item={stage.items[0]}/><span className="category-name">{stageName(stage.items[0])}</span><span className="category-count">{stage.items.length} 份候选</span><span className="chip-check" aria-hidden="true">{selected ? '✓' : '+'}</span></button>;
      })}</div>
    </section>
    <section aria-labelledby="lineup-title" className="lineup-section"><details className="lineup-main lineup-disclosure"><summary><div><h2 id="lineup-title">调整餐品与顺序</h2><p>{selection.length ? selection.map(stage => stageName(stages.find(value => value.id === stage.id)!.items[0])).join(' / ') : '先选上方分类'}</p></div><span>可选</span></summary>
      <div className="stage-list">{selection.length === 0 && <div className="empty-selection">先选上方的餐品分类，再来挑具体餐品。</div>}{selection.map((stage, index) => {
        const items = stages.find(value => value.id === stage.id)!.items;
        const isExpanded = expanded === stage.id;
        return <div className={`stage-picker ${stage.candidateIds.length === 0 ? 'empty-stage' : ''}`} key={stage.id}><div className="stage-row"><span className="stage-number">{String(index + 1).padStart(2, '0')}</span><div className="stage-row-copy"><h3>{stageName(items[0])}<span>{stage.candidateIds.length} / {items.length} 份候选</span></h3><p>{stage.candidateIds.length === 0 ? '至少选一份餐品才能开始挑选' : items.filter(item => stage.candidateIds.includes(item.id)).slice(0, 2).map(item => item.name).join('、') + (stage.candidateIds.length > 2 ? `等 ${stage.candidateIds.length} 份` : '')}</p></div><div className="reorder-controls"><button className="icon-button" disabled={index === 0} onClick={() => moveStage(index, -1)} aria-label={`${stageName(items[0])}分类上移`}>↑</button><button className="icon-button" disabled={index === selection.length - 1} onClick={() => moveStage(index, 1)} aria-label={`${stageName(items[0])}分类下移`}>↓</button></div><button className="picker-toggle" aria-expanded={isExpanded} aria-controls={`picker-${stage.id}`} onClick={() => setExpanded(isExpanded ? null : stage.id)}>圈选餐品 <span aria-hidden="true">{isExpanded ? '−' : '+'}</span></button></div>
          {isExpanded && <fieldset className="candidate-picker" id={`picker-${stage.id}`}><legend className="sr-only">{stageName(items[0])}分类候选餐品</legend>{items.map(item => <label key={item.id} className={`candidate-option ${stage.candidateIds.includes(item.id) ? 'checked' : ''}`}><input type="checkbox" checked={stage.candidateIds.includes(item.id)} onChange={() => toggleCandidate(stage.id, item.id)} /><FoodArt item={item}/><span>{item.name}</span></label>)}</fieldset>}
        </div>;
      })}</div></details>
      <aside className="start-panel"><div className="start-panel-mark" aria-hidden="true">✦</div><p className="eyebrow">挑一挑，今天吃什么</p><h3>选好分类，就开始</h3><div className="setup-stats"><div><strong>{selection.length}</strong><span>类餐品</span></div><div><strong>{totalDecisions}</strong><span>次选择</span></div></div><button className="button button-primary start-button" disabled={!canStart} onClick={onStart}>{canStart ? '开始挑选' : selection.length ? '至少留一份' : '先选一类'} <span aria-hidden="true">→</span></button><p className="start-note">{canStart ? '每类留一份，组成这顿的餐单' : '每个所选分类至少保留一份餐品'}</p></aside>
    </section></div>
  </div>;
}
