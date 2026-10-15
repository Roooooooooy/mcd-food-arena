import { availabilityLabel, isSelectable, type AvailabilityResult } from './commerce/availability-contracts.ts';
import { useEffect, useRef, useState } from 'react';
import { mcdMemes } from './copy/MemeSources.tsx';
import { loadFrozenDemo, defaultSelection } from './catalog/source.ts';
import { StorePicker } from './setup/StorePicker.tsx';
import { AccountPanel } from './commerce/AccountPanel.tsx';
import { CheckoutPanel } from './commerce/CheckoutPanel.tsx';
import { createCommerceApi, publicCommerce, CommerceError } from './commerce/api.ts';
import type { CouponCollection, SessionInfo, CommerceQuote } from './commerce/contracts.ts';
import { createConnectionScope, createAvailabilityTracker, createRequestActivity, resolveAvailableChoice, emptyCheckout, invalidateCheckout, acceptQuote, beginOrder, finishOrder, failOrder, type CheckoutState } from './commerce/state.ts';
import { createCouponBasket, editCouponBasket, applyCoupon, undoCoupon, canUndoCoupon, restoreCoveredBasket, type CouponProposal } from './coupons/recommend.ts';
import { completedChoices, choose, createArena, availabilityDraw, redrawUnavailablePair, skip, undo } from './arena/engine.ts';
import { ArenaPage } from './arena/ArenaPage.tsx';
import { CartPage } from './cart/CartPage.tsx';
import { basketKey, reconcileBasket } from './cart/model.ts';
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
  const [commerceClient]=useState(()=>createCommerceApi(publicCommerce));
  const [account,setAccount]=useState<SessionInfo>({connected:false,expiresAt:null});
  const [accountBusy,setAccountBusy]=useState(false);
  const [accountError,setAccountError]=useState<string|null>(null);
  const [coupons,setCoupons]=useState<CouponCollection|null>(null);
  const [checkout,setCheckout]=useState<CheckoutState>(emptyCheckout);
  const checkoutRef=useRef(checkout);
  const [quoteGeneration,setQuoteGeneration]=useState(0);
  const quoteGenerationRef=useRef(0);
  const [connectionScope]=useState(createConnectionScope);
  const [connectionIdentity,setConnectionIdentity]=useState(0);
  const [availability,setAvailability]=useState<AvailabilityResult|null>(null);
  const [basketAvailability,setBasketAvailability]=useState<AvailabilityResult|null>(null);
  const availabilityRef=useRef(availability);availabilityRef.current=availability;
  const basketAvailabilityRef=useRef(basketAvailability);basketAvailabilityRef.current=basketAvailability;
  const [availabilityTracker]=useState(()=>createAvailabilityTracker(connectionScope));
  const [basketAvailabilityTracker]=useState(()=>createAvailabilityTracker(connectionScope));
  const [availabilityBusy,setAvailabilityBusy]=useState(false);
  const [availabilityActivity]=useState(()=>createRequestActivity(setAvailabilityBusy));
  const [availabilityError,setAvailabilityError]=useState<string|null>(null);
  const [takeWayCode,setTakeWayCode]=useState('');
  const [queryBusy,setQueryBusy]=useState(false);
  const couponBasket=useRef(createCouponBasket([]));
  const [cartRevision,setCartRevision]=useState(0);
  function publishCheckout(next:CheckoutState){checkoutRef.current=next;setCheckout(next);}
  function invalidateQuote(){quoteGenerationRef.current++;setQuoteGeneration(quoteGenerationRef.current);publishCheckout(invalidateCheckout(checkoutRef.current));setTakeWayCode('');}
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
      const previous=readSaved(catalog);
      setFrozenDemo(catalog); setSnapshot(catalog); setSelection(defaultSelection(catalog)); setSaved(previous); setLoading(false);
      try { if(previous===null&&localStorage.getItem(storageKey(catalog)))setMessage('菜单或分类已更新，上次记录无法继续，请重新挑选。'); } catch { /* Storage may be unavailable. */ }
    }, error => { if (active) { setLoading(false); setMessage(error instanceof Error ? error.message : '门店快照无法加载，请刷新页面重试。'); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!snapshot || arenas.length === 0) return;
    const serialized = serializeSession(snapshot, arenas, activeIndex);
    setSaved(serialized);
    if(snapshot.mode==='live')return;
    try { localStorage.setItem(storageKey(snapshot), serialized); } catch { setMessage('浏览器没能保存记录，请保持页面打开。'); }
  }, [snapshot, arenas, activeIndex]);

  const availabilityEntry = snapshot?.mode==='live' ? JSON.stringify([snapshot.contextKey,page,activeIndex,page==='arena'?arenas[activeIndex]?.arenaId:null,page==='arena'?arenas[activeIndex]?.revision:null,page==='result'?basketKey(cart.basket):null,page==='result'?cartRevision:null]) : '';
  const availabilityEntryRef=useRef(availabilityEntry);availabilityEntryRef.current=availabilityEntry;
  useEffect(()=>{if(page!=='setup'&&snapshot?.mode==='live'&&account.connected)void refreshAvailability();return()=>{availabilityActivity.cancel();availabilityTracker.invalidate();basketAvailabilityTracker.invalidate();};},[availabilityEntry,account.connected]);

  function selectable(id:string){return isSelectable(availabilityRef.current?.items.find(i=>i.candidateId===id));}
  async function refreshAvailability(redraw=false){
    if(!publicCommerce||!account.connected||snapshot?.mode!=='live'||!snapshot.complete)return;
    const entry=availabilityEntryRef.current,contextKey=snapshot.contextKey;
    const arena=arenas[activeIndex];
    const ids=page==='arena'&&arena?(redraw?arena.remainingIds:arena.pair??(arena.championId?[arena.championId]:[])):page==='setup'?selection.flatMap(s=>s.candidateIds):[];
    const basket=structuredClone(cart.basket);
    const exact=page==='result';const tracker=exact?basketAvailabilityTracker:availabilityTracker;
    if(exact)invalidateQuote();
    const ticket=tracker.begin(contextKey);
    const activityTicket=availabilityActivity.begin();setAvailabilityError(null);
    try {
      const result=exact&&basket.length?await commerceClient.basketAvailability({contextKey,basket,cartRevision}):await commerceClient.availability({contextKey,candidateIds:ids});
      const candidateResult=exact&&basket.length?await commerceClient.availability({contextKey,candidateIds:basket.map(line=>line.candidateId)}):null;
      if(entry!==availabilityEntryRef.current||!tracker.accept(ticket,result))return;
      if(candidateResult){const old=availabilityRef.current;const items=[...(old?.contextKey===contextKey?old.items:[])].filter(i=>!candidateResult.items.some(n=>n.candidateId===i.candidateId)).concat(candidateResult.items);const next={...candidateResult,items};availabilityRef.current=next;setAvailability(next);}
      if(exact){
        basketAvailabilityRef.current=result;setBasketAvailability(result);
      }else{
        const old=availabilityRef.current;
        const items=[...(old?.contextKey===contextKey?old.items:[])].filter(i=>!result.items.some(n=>n.candidateId===i.candidateId)).concat(result.items);
        const next={...result,items};availabilityRef.current=next;setAvailability(next);
        if(redraw&&arena){setArenas(current=>current.map((value,index)=>index===activeIndex&&value.arenaId===arena.arenaId&&value.revision===arena.revision?redrawUnavailablePair(value,selectable):value));if(!result.items.some(isSelectable))setAvailabilityError('当前剩余餐品都未返回。可以跳过这一类，或回到分类调整餐品。');}
      }
    }catch(error){
      if(entry!==availabilityEntryRef.current||!tracker.current(ticket)||error instanceof CommerceError&&error.code==='STALE_RESULT')return;
      const result={contextKey,checkedAt:new Date().toISOString(),items:(exact?basket.map(l=>l.candidateId):ids).map(candidateId=>({candidateId,state:'unknown' as const,label:availabilityLabel('unknown'),checkedAt:null}))};
      if(exact){basketAvailabilityRef.current=result;setBasketAvailability(result);invalidateQuote();}else{availabilityRef.current=result;setAvailability(result);}
      setAvailabilityError(error instanceof Error?error.message:'当前状态读取失败，请手动刷新。');
    }finally{availabilityActivity.finish(activityTicket);}
  }

  useEffect(() => { window.scrollTo({ top: 0, behavior: 'instant' }); }, [page]);

  function clearSession() {
    availabilityActivity.cancel();availabilityTracker.invalidate();basketAvailabilityTracker.invalidate();availabilityRef.current=null;basketAvailabilityRef.current=null;setAvailability(null);setBasketAvailability(null);setAvailabilityBusy(false);setAvailabilityError(null);
    connectionScope.replaceContext(null);couponBasket.current=createCouponBasket([]);setCartRevision(0);invalidateQuote();setCoupons(null);
    setQueryBusy(false);setCart({winners:[],basket:[]}); setArenas([]); setActiveIndex(0); setSaved(null); setSelection([]); setPage('setup'); setMessage(null);
  }
  function changeMode(next: Mode) {
    if (checkoutRef.current.status==='creating'||next === mode || (!publicCommerce||!account.connected) && next === 'live' || next === 'demo' && !frozenDemo) return;
    commerceClient.invalidate();requestVersion.current++; setLoading(false); clearSession(); setMode(next);
    const catalog = next === 'demo' ? frozenDemo : null;
    setSnapshot(catalog);
    if (catalog) { setSelection(defaultSelection(catalog)); setSaved(readSaved(catalog)); }
  }
  function changeStore(next: StoreOption) {
    if (next.id === store.id) return;
    if(checkoutRef.current.status==='creating')return;
    commerceClient.invalidate();requestVersion.current++; setLoading(false); clearSession(); setStore(next); setSnapshot(null);
  }
  async function findStores(input: { city: string; keyword: string }) {
    if (!publicCommerce || !account.connected || mode !== 'live' || checkoutRef.current.status==='creating') return;
    const version = ++requestVersion.current; setLoading(true); setMessage(null);
    try {
      const found = await commerceClient.stores(input);
      if (version !== requestVersion.current) return;
      setStores([store, ...found.filter(value => value.id !== store.id)]);
      if (found.length === 0) setMessage('没找到符合条件的门店，请换个地址关键词。');
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : '门店搜索失败，请重试。'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }
  async function refreshCatalog() {
    if (!publicCommerce || !account.connected || mode !== 'live' || checkoutRef.current.status==='creating') return;
    commerceClient.invalidate();const version = ++requestVersion.current; clearSession(); setSnapshot(null); setLoading(true);
    try {
      const catalog = await commerceClient.catalog({ storeId: store.id, diningMode: 'pickup' });
      if (version !== requestVersion.current) return;
      connectionScope.replaceContext(catalog.contextKey);setSnapshot(catalog); setSelection(defaultSelection(catalog)); setSaved(null);
      if(catalog.complete){const collection=await commerceClient.coupons(catalog.contextKey);if(version!==requestVersion.current)return;setCoupons(collection);}
      if (!catalog.complete) setMessage('菜单还没确认完整，暂时不能开始挑选。请刷新重试。');
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : '真实菜单加载失败，请重试。'); }
    finally { if (version === requestVersion.current) setLoading(false); }
  }

  function start() {
    if (!snapshot) return;
    try {
      const eligible=selection.map(stage=>({...stage,candidateIds:stage.candidateIds.filter(selectable)}));
      const started=startSession(snapshot, eligible);
      couponBasket.current=createCouponBasket([]);setCartRevision(0);setCart({winners:[],basket:[]});invalidateQuote();
      setArenas(started);
      setActiveIndex(0);
      setMessage(null);
      setPage('arena');
    } catch (error) { setMessage(error instanceof Error ? error.message : '暂时无法开始，请检查所选餐品。'); }
  }
  function resume() {
    if (!snapshot) return;
    try {
      const restored = resumeSession(snapshot, saved, snapshot.mode==='demo'?readSaved(snapshot):null);
      if (restored === null) return;
      setArenas(restored.arenas);
      setActiveIndex(restored.activeStageIndex);
      setSelection(restored.arenas.map(arena => ({ id: arena.stageId, candidateIds: arena.orderedIds })));
      setMessage(null);
      setPage('arena');
    } catch (error) {
      setSaved(null);
      try { if(snapshot.mode==='demo')localStorage.removeItem(storageKey(snapshot)); } catch { /* Storage may be unavailable. */ }
      setMessage(error instanceof Error ? error.message : '暂存记录已失效，请重新开始。');
    }
  }
  function resolveChoice(lock: CoinLock):boolean {
    const arena=arenas[activeIndex];if(!arena)return false;
    return resolveAvailableChoice(arena,lock,selectable,()=>setArenas(current=>current.map((value,index)=>index===activeIndex&&lockMatchesArena(lock,value)&&selectable(value.pair![lock.finalSide==='left'?0:1])?choose(value,lock.finalSide,lock.revision,availabilityDraw(selectable)):value)),()=>{});
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
          const basket=reconcileBasket(couponBasket.current.basket,cart.winners,winners,snapshot);couponBasket.current=editCouponBasket(couponBasket.current,basket);setCartRevision(couponBasket.current.revision);invalidateQuote();setCart({winners,basket});
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
    if(snapshot.mode==='live'){setMessage('已暂停，这次账号连接中的进度会保留在当前页面。');setPage('setup');return;}
    try {
      localStorage.setItem(storageKey(snapshot), serialized);
      setMessage('记录已保存，回来点“接着选”就能继续。');
    } catch {
      setMessage('已暂停，但浏览器没能保存记录。请保持页面打开，再点“接着选”。');
    }
    setPage('setup');
  }

  function publishBasket(){setCart(current=>({...current,basket:couponBasket.current.basket}));setCartRevision(couponBasket.current.revision);invalidateQuote();}
  function changeBasket(basket:BasketLine[]){const removedCoupon=couponBasket.current.basket.some(l=>l.couponKey)&&!basket.some(l=>l.couponKey);try{couponBasket.current=editCouponBasket(couponBasket.current,basket);}catch{setMessage('这份餐品仍被券覆盖，请先移出券恢复餐品，再修改规格或定制。');return;}if(removedCoupon)couponBasket.current=restoreCoveredBasket(couponBasket.current);publishBasket();}
  function useCoupon(p:CouponProposal){if(!snapshot||p.contextKey!==snapshot.contextKey||!coupons?.coupons.some(c=>c.key===p.couponKey))return;try{couponBasket.current=applyCoupon(couponBasket.current,p);publishBasket();setMessage('已按显示的方案替换餐品，请重新核价。');}catch{setMessage('餐单已变化，请查看新的替换方案。');}}
  function undoAppliedCoupon(){try{couponBasket.current=undoCoupon(couponBasket.current);publishBasket();}catch{setMessage('餐单已修改，不能直接撤销原替换。');}}
  function restoreForReview(){const previous=couponBasket.current;const restored=restoreCoveredBasket(previous);couponBasket.current=restored===previous?editCouponBasket(previous,previous.basket):restored;publishBasket();}
  async function refreshCoupons(){if(!snapshot||!account.connected||checkoutRef.current.status==='creating')return;commerceClient.invalidate();const version=++requestVersion.current;restoreForReview();setCoupons(null);setLoading(true);setMessage(null);setAccountError(null);try{const collection=await commerceClient.coupons(snapshot.contextKey);if(version!==requestVersion.current)return;setCoupons(collection);}catch(error){if(version===requestVersion.current)setMessage(error instanceof Error?error.message:'券包刷新失败。');}finally{if(version===requestVersion.current)setLoading(false);}}
  async function connectAccount(token:string){
    const own=connectionScope.beginConnection();commerceClient.invalidate();requestVersion.current++;setAccountBusy(true);setAccountError(null);setStores([store]);clearSession();publishCheckout(emptyCheckout());setConnectionIdentity(own);
    try{const info=await commerceClient.connect(token);if(own!==connectionScope.connection)return;setAccount(info);setMode('live');setSnapshot(null);setSaved(null);setLoading(true);const version=++requestVersion.current;
      const catalog=await commerceClient.catalog({storeId:store.id,diningMode:'pickup'});if(own!==connectionScope.connection||version!==requestVersion.current)return;
      connectionScope.replaceContext(catalog.contextKey);setSnapshot(catalog);setSelection(defaultSelection(catalog));setMessage('已切换到本人菜单，请重新选择分类。本人进度只保留在当前账号连接中。');
      if(catalog.complete){const collection=await commerceClient.coupons(catalog.contextKey);if(own===connectionScope.connection&&version===requestVersion.current)setCoupons(collection);}
    }catch(error){if(own!==connectionScope.connection)return;setAccountError(error instanceof Error?error.message:'账号连接失败。');}
    finally{if(own===connectionScope.connection){setAccountBusy(false);setLoading(false);}}
  }
  async function disconnectAccount(){const own=connectionScope.beginConnection();requestVersion.current++;setAccountBusy(true);setAccountError(null);setConnectionIdentity(own);clearSession();publishCheckout(emptyCheckout());setAccount({connected:false,expiresAt:null});setMode('demo');setStores([initialStore]);setStore(initialStore);setSnapshot(frozenDemo);setLoading(false);if(frozenDemo){setSelection(defaultSelection(frozenDemo));setSaved(readSaved(frozenDemo));}
    try{await commerceClient.disconnect();}catch(error){if(own===connectionScope.connection)setAccountError(error instanceof Error?error.message:'断开请求失败。请关闭本机服务或重新连接。');}finally{if(own===connectionScope.connection)setAccountBusy(false);}
  }
  function receiveOfficialQuote(quote:CommerceQuote,request:import('./shared/contracts.ts').QuoteRequest,eligibilityGeneration:number){if(eligibilityGeneration!==quoteGenerationRef.current)return;if(basketAvailabilityRef.current?.items.some(i=>!isSelectable(i))||availabilityBusy)return;if(!connectionScope.hasContext(request.contextKey)||!snapshot||snapshot.contextKey!==request.contextKey||request.cartRevision!==couponBasket.current.revision||basketKey(couponBasket.current.basket)!==basketKey(request.basket))return;try{publishCheckout(acceptQuote(checkoutRef.current,quote,request));setTakeWayCode('');}catch{/* A late quote cannot authorize checkout. */}}
  async function createPersonalOrder(){if(availabilityBusy||basketAvailabilityRef.current?.items.some(i=>!isSelectable(i)))return;const own=connectionScope.connection;let state:CheckoutState;try{state=beginOrder(checkoutRef.current,takeWayCode);}catch{return;}const quote=state.quote!;publishCheckout(state);try{const order=await commerceClient.createOrder({quoteKey:quote.quoteKey,takeWayCode,expectedTotalCents:quote.totalCents,attemptKey:crypto.randomUUID()});if(own!==connectionScope.connection)return;publishCheckout(finishOrder(checkoutRef.current,order));}catch(error){if(own!==connectionScope.connection)return;publishCheckout(failOrder(checkoutRef.current,error instanceof CommerceError?error.code:'ORDER_RESULT_UNKNOWN'));}}
  async function queryPersonalOrder(){const order=checkoutRef.current.order;if(!order||queryBusy)return;const own=connectionScope.connection;setQueryBusy(true);try{const refreshed=await commerceClient.queryOrder(order.key);if(own!==connectionScope.connection)return;publishCheckout(finishOrder(checkoutRef.current,refreshed));}catch(error){if(own===connectionScope.connection)publishCheckout({...checkoutRef.current,error:error instanceof CommerceError?error.code:'ORDER_QUERY_UNAVAILABLE'});}finally{if(own===connectionScope.connection)setQueryBusy(false);}}

  const totalDecisions = arenas.reduce((sum, arena) => sum + completedChoices(arena), 0);

  return <div className="app-shell ui-enhanced"><header className={`site-header${publicCommerce?' site-header-commerce':''}`}><a className="brand" href="#" onClick={event => { event.preventDefault(); if (page !== 'setup') pause(); }} aria-label="麦麦二选一首页"><span className="brand-mark" aria-hidden="true">✦</span><span>麦麦二选一</span><small>PICK ONE</small></a><div className="header-status"><div className="demo-status"><span className="status-dot"/>{mode === 'demo' ? <>菜单快照</> : <>真实菜单</>}</div><AccountPanel enabled={publicCommerce} session={account} busy={accountBusy||loading||checkout.status==='creating'} error={accountError} onConnect={connectAccount} onDisconnect={()=>void disconnectAccount()}/></div></header>
    <main className="main-container">{page === 'setup' && <StorePicker mode={mode} store={store} stores={stores} busy={loading||accountBusy||checkout.status==='creating'} publicOnly={!publicCommerce||!account.connected} snapshot={frozenDemo} onModeChange={changeMode} onStoreChange={changeStore} onSearch={findStores} onLoad={refreshCatalog} loaded={snapshot?.mode === 'live'}/>}
      {page === 'setup' && !snapshot && <section className="catalog-empty" aria-busy={loading}><p className="eyebrow">{mode === 'demo' ? '门店菜单快照' : '读取真实菜单'}</p><h1>{mode === 'demo' ? loading ? '正在加载门店快照…' : '门店快照暂时无法加载。' : loading ? '正在读取官方菜单…' : '先选门店，再加载菜单'}</h1><p>{mode === 'demo' ? '菜单和餐品图片已保存在本站，加载完成后就能开始挑选。' : loading ? '正在加载门店菜单、规格和营养，请稍等。' : '点“加载真实菜单”，餐品加载齐后再开始挑选。'}</p>{message && <p role="status" className="notice">{message}</p>}</section>}
      {snapshot?.mode==='live'&&account.connected&&<section className="availability-controls" aria-label="当前门店餐品状态"><p role="status">{availabilityBusy?'正在检查当前菜单和选项…':availabilityError??'状态来自当前菜单和选项，实际购买以官方核价与下单为准。'}{(page==='result'?basketAvailability:availability)?.checkedAt&&<small> 最近检查：{new Date((page==='result'?basketAvailability:availability)!.checkedAt).toLocaleString('zh-CN')}</small>}</p><button className="button button-outline" disabled={availabilityBusy} onClick={()=>void refreshAvailability()}>刷新可用状态</button></section>}
      {page === 'setup' && snapshot && <SetupPage availability={availability} snapshot={snapshot} selection={selection} onSelectionChange={setSelection} onStart={start} onResume={resume} hasSaved={saved !== null} message={message}/>}
      {page === 'arena' && snapshot && arenas[activeIndex] && <ArenaPage key={`${connectionIdentity}:${connectionScope.contextRevision}:${snapshot.contextKey}`} availability={availability} onRedraw={()=>void refreshAvailability(true)} coupons={coupons} state={arenas[activeIndex]} snapshot={snapshot} arenas={arenas} activeIndex={activeIndex} onChoose={resolveChoice} onUndo={() => updateActive(undo)} onSkip={() => updateActive(skip)} onPause={pause} onNext={next} onStageSelect={setActiveIndex}/>}
      {page === 'result' && snapshot && <CartPage quoteGeneration={quoteGeneration} availability={basketAvailability} key={`${connectionIdentity}:${connectionScope.contextRevision}:${snapshot.contextKey}`} snapshot={snapshot} coveredQuantities={Object.fromEntries((couponBasket.current.applied?.removed??[]).map(l=>[l.candidateId,l.quantity]))} coupons={coupons} commerceClient={account.connected?commerceClient:undefined} cartRevision={cartRevision} onOfficialQuote={receiveOfficialQuote} onApplyCoupon={useCoupon} onRefreshCoupons={()=>void refreshCoupons()} onUndoCoupon={undoAppliedCoupon} canUndoCoupon={canUndoCoupon(couponBasket.current)} commerceBusy={loading||availabilityBusy||checkout.status==='creating'} order={checkout.order} orderUnknown={checkout.status==='unknown'} basket={cart.basket} onBasketChange={changeBasket} arenas={arenas} totalDecisions={totalDecisions} onReview={index => { restoreForReview();const arena = arenas[index]; if (!arena) return; setArenas(current => current.map((value, i) => i === index ? createArena(value.orderedIds, value.arenaId, value.stageId) : value)); setActiveIndex(index); setPage('arena'); }} onRestart={start} onSetup={() => { restoreForReview();setMessage(null); setPage('setup'); }}/> }
      {account.connected&&snapshot?.mode==='live'&&!coupons&&<section className="coupon-load-status" aria-label="读取本人券包"><p>{loading?'正在读取本人券包…':'券包尚未取得，可以重新读取。'}</p><button className="button button-outline" disabled={loading||checkout.status==='creating'} onClick={()=>void refreshCoupons()}>读取本人券包</button></section>}
      {account.connected&&(page==='result'||checkout.order||checkout.status==='unknown'||checkout.status==='creating')&&<CheckoutPanel state={checkout} takeWayCode={takeWayCode} onTakeWayChange={setTakeWayCode} onCreate={()=>void createPersonalOrder()} onQuery={()=>void queryPersonalOrder()} queryBusy={queryBusy}/>}
      {page!=='setup'&&message&&<p className="notice" role="status">{message}</p>}
    </main><footer className="site-footer"><p><span className="footer-star" aria-hidden="true">✦</span> {mcdMemes.eternal.text}</p><p>{mode === 'demo' ? `官方门店菜单快照 · 采集时间：${frozenDemo ? new Date(frozenDemo.capturedAt ?? frozenDemo.loadedAt).toLocaleString('zh-CN') : '加载中'}。价格、规格和营养来自采集时的菜单，仅供参考。条件价不保证适用，不是实时官方报价。` : '菜单和已匹配的营养来自官方。参考价可能有适用条件，金额以本次官方核价为准。'}</p></footer></div>;
}
