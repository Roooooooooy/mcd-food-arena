import { useEffect, useRef, useState } from 'react';
import { loadFrozenDemo, publicDemoOnly, defaultSelection } from './catalog/source.ts';
import { StorePicker } from './setup/StorePicker.tsx';
import { loadCatalog, searchStores } from './api.ts';
import { completedChoices, choose, createArena, skip, undo } from './arena/engine.ts';
import { ArenaPage } from './arena/ArenaPage.tsx';
import { CartPage } from './cart/CartPage.tsx';
import { reconcileBasket } from './cart/model.ts';
import { lockMatchesArena, type CoinLock } from './arena/coin-timing.ts';
import { SetupPage } from './setup/SetupPage.tsx';
import { startSession, serializeSession, resumeSession, type StageSelection } from './setup/session.ts';
import type { ArenaState, BasketLine, CatalogSnapshot, Mode, StoreOption } from './shared/contracts.ts';

const initialStore: StoreOption = { id: '3330251', name: '麦当劳杭州下城区-凤起路农贸市场餐厅', city: '杭州', address: '杭州建国北路286号' };
function storageKey(snapshot: CatalogSnapshot): string { return `mcd-food-arena:${snapshot.mode}:${snapshot.store?.id ?? 'sample'}:session:v2`; }
function readSaved(snapshot: CatalogSnapshot): string | null {
  try { const value = localStorage.getItem(storageKey(snapshot)); return value && JSON.parse(value).contextKey === snapshot.contextKey ? value : null; } catch { return null; }
}

export default function App() {
  const [mode, setMode] = useState<Mode>('demo');
  const [snapshot, setSnapshot] = useState<CatalogSnapshot | null>(null);
  const [frozenDemo, setFrozenDemo] = useState<CatalogSnapshot | null>(null);
  const [store, setStore] = useState<StoreOption>(initialStore);
  const [stores, setStores] = useState<StoreOption[]>([initialStore]);
  const [loading, setLoading] = useState(true);
  const requestVersion = useRef(0);
  const [page, setPage] = useState<'setup' | 'arena' | 'result'>('setup');
  const [selection, setSelection] = useState<StageSelection[]>([]);
  const [arenas, setArenas] = useState<ArenaState[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [saved, setSaved] = useState<string | null>(null);
  const [cart, setCart] = useState<{winners:string[];basket:BasketLine[]}>({winners:[],basket:[]});
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void loadFrozenDemo().then(catalog => {
      if (!active) return;
      setFrozenDemo(catalog); setSnapshot(catalog); setSelection(defaultSelection(catalog)); setSaved(readSaved(catalog)); setLoading(false);
    }, error => { if (active) { setLoading(false); setMessage(error instanceof Error ? error.message : '门店快照无法加载，请刷新页面重试。'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!snapshot || arenas.length === 0) return;
    const serialized = serializeSession(snapshot, arenas, activeIndex);
    setSaved(serialized);
    try { localStorage.setItem(storageKey(snapshot), serialized); } catch { setMessage('浏览器未允许暂存，请保持此页面打开。'); }
  }, [snapshot, arenas, activeIndex]);

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);

  function clearSession() {
    setCart({winners:[],basket:[]}); setArenas([]); setActiveIndex(0); setSaved(null); setSelection([]); setPage('setup'); setMessage(null);
  }
  function changeMode(next: Mode) {
    if (next === mode || publicDemoOnly && next === 'live' || next === 'demo' && !frozenDemo) return;
    requestVersion.current++; setLoading(false); clearSession(); setMode(next);
    const catalog = next === 'demo' ? frozenDemo : null;
    setSnapshot(catalog);
    if (catalog) { setSelection(defaultSelection(catalog)); setSaved(readSaved(catalog)); }
  }
  function changeStore(next: StoreOption) {
    if (next.id === store.id) return;
    requestVersion.current++; setLoading(false); clearSession(); setStore(next); setSnapshot(null);
  }
  async function findStores(input: { city: string; keyword: string }) {
    if (publicDemoOnly || mode !== 'live') return;
    const version = ++requestVersion.current; setLoading(true); setMessage(null);
    try {
      const found = await searchStores(input);
      if (version !== requestVersion.current) return;
      setStores([store, ...found.filter(value => value.id !== store.id)]);
      if (found.length === 0) setMessage('没有找到周边门店，请更换地址关键词。');
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : '门店搜索失败，请重试。'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  async function refreshCatalog() {
    if (publicDemoOnly || mode !== 'live') return;
    const version = ++requestVersion.current; clearSession(); setSnapshot(null); setLoading(true);
    try {
      const catalog = await loadCatalog({ storeId: store.id, diningMode: 'pickup' });
      if (version !== requestVersion.current) return;
      setSnapshot(catalog); setSelection(defaultSelection(catalog)); setSaved(readSaved(catalog));
      if (!catalog.complete) setMessage('菜单未确认完整，开始挑选已暂停。请刷新重试。');
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : '真实菜单加载失败，请重试。'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }

  function start() {
    if (!snapshot) return;
    try {
      setCart({winners:[],basket:[]});
      setArenas(startSession(snapshot, selection));
      setActiveIndex(0);
      setMessage(null);
      setPage('arena');
    } catch (error) { setMessage(error instanceof Error ? error.message : '无法开始挑选，请检查候选。'); }
  }
  function resume() {
    if (!snapshot) return;
    try {
      const restored = resumeSession(snapshot, saved, readSaved(snapshot));
      if (restored === null) return;
      setArenas(restored.arenas);
      setActiveIndex(restored.activeStageIndex);
      setSelection(restored.arenas.map(arena => ({ id: arena.stageId, candidateIds: arena.orderedIds })));
      setMessage(null);
      setPage('arena');
    } catch (error) {
      setSaved(null);
      try { localStorage.removeItem(storageKey(snapshot)); } catch { /* Storage may be unavailable. */ }
      setMessage(error instanceof Error ? error.message : '暂存记录已失效，请重新开始。');
    }
  }
  function resolveChoice(lock: CoinLock) {
    setArenas(current => current.map((arena, index) => index === activeIndex && lockMatchesArena(lock, arena)
      ? choose(arena, lock.finalSide, lock.revision) : arena));
  }
  function updateActive(update: (arena: ArenaState) => ArenaState) {
    setArenas(current => current.map((arena, index) => index === activeIndex ? update(arena) : arena));
  }
  function next() {
    if (activeIndex < arenas.length - 1) setActiveIndex(activeIndex + 1);
    else {
      const incomplete = arenas.findIndex(arena => arena.status === 'active');
      if (incomplete >= 0) setActiveIndex(incomplete);
      else {
        if (snapshot) {
          const winners = arenas.filter(a => a.status === 'complete' && a.championId).map(a => a.championId!);
          setCart(current => ({winners, basket:reconcileBasket(current.basket,current.winners,winners,snapshot)}));
        }
        setPage('result');
      }
    }
  }
  function pause() {
    if (!snapshot) return;
    setSelection(arenas.map(arena => ({ id: arena.stageId, candidateIds: arena.orderedIds })));
    const serialized = serializeSession(snapshot, arenas, activeIndex);
    setSaved(serialized);
    try {
      localStorage.setItem(storageKey(snapshot), serialized);
      setMessage('挑选记录已暂存。想回来时，点“继续上次挑选记录”就好。');
    } catch {
      setMessage('当前挑选记录已暂停，但浏览器未允许写入暂存。请保持页面打开，再点“继续上次挑选记录”。');
    }
    setPage('setup');
  }

  const totalDecisions = arenas.reduce((sum, arena) => sum + completedChoices(arena), 0);

  return <div className="app-shell"><header className="site-header"><a className="brand" href="#" onClick={event => { event.preventDefault(); if (page !== 'setup') pause(); }} aria-label="麦麦二选一首页"><span className="brand-mark" aria-hidden="true">✦</span><span>麦麦二选一</span><small>PICK ONE</small></a><div className="demo-status"><span className="status-dot"/>{mode === 'demo' ? <>门店快照试玩 <span className="demo-token">免 Token</span></> : <>真实菜单 <span className="demo-token">到店自提</span></>}</div></header>
    <main className="main-container">{page === 'setup' && <StorePicker mode={mode} store={store} stores={stores} busy={loading} publicOnly={publicDemoOnly} snapshot={frozenDemo} onModeChange={changeMode} onStoreChange={changeStore} onSearch={findStores} onLoad={refreshCatalog} loaded={snapshot?.mode === 'live'}/>}
      {page === 'setup' && !snapshot && <section className="catalog-empty" aria-busy={loading}><p className="eyebrow">{mode === 'demo' ? '门店快照 / 免 Token' : '真实菜单 / 按需加载'}</p><h1>{mode === 'demo' ? loading ? '正在读取门店快照…' : '门店快照暂时无法加载。' : loading ? '正在读取官方菜单…' : '选好门店，开始挑选真实餐品。'}</h1><p>{mode === 'demo' ? '公开菜单和餐品图片保存在本站，加载后即可开始挑选。' : loading ? '门店菜单、真实规格和营养正在装载，请稍候。' : '点击“加载真实菜单”，装载全部餐品后再开始挑选。'}</p>{message && <p role="status" className="notice">{message}</p>}</section>}
      {page === 'setup' && snapshot && <SetupPage snapshot={snapshot} selection={selection} onSelectionChange={setSelection} onStart={start} onResume={resume} hasSaved={saved !== null} message={message}/>}
      {page === 'arena' && snapshot && arenas[activeIndex] && <ArenaPage state={arenas[activeIndex]} snapshot={snapshot} arenas={arenas} activeIndex={activeIndex} onChoose={resolveChoice} onUndo={() => updateActive(undo)} onSkip={() => updateActive(skip)} onPause={pause} onNext={next} onStageSelect={setActiveIndex}/>}
      {page === 'result' && snapshot && <CartPage key={snapshot.contextKey} snapshot={snapshot} basket={cart.basket} onBasketChange={basket => setCart(current => ({...current,basket}))} arenas={arenas} totalDecisions={totalDecisions} onReview={index => { const arena = arenas[index]; if (!arena) return; setArenas(current => current.map((value, i) => i === index ? createArena(value.orderedIds, value.arenaId, value.stageId) : value)); setActiveIndex(index); setPage('arena'); }} onRestart={start} onSetup={() => { setMessage(null); setPage('setup'); }}/> }
    </main><footer className="site-footer"><p><span className="footer-star" aria-hidden="true">✦</span> 先选心动，再想开饭。</p><p>{mode === 'demo' ? `官方门店菜单快照 · 采集于 ${frozenDemo ? new Date(frozenDemo.capturedAt ?? frozenDemo.loadedAt).toLocaleString('zh-CN') : '加载中'}。价格、规格、营养仅参考当时数据，条件价不保证适用，非实时官方报价。` : '官方菜单与已匹配营养；参考价可能含条件，最终以官方核价为准。'}</p></footer></div>;
}
