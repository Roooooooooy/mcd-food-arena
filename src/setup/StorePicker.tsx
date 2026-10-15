import { useState } from 'react';
import type { Mode, StoreOption, CatalogSnapshot } from '../shared/contracts.ts';

interface Props {
  mode: Mode; store: StoreOption; stores: StoreOption[]; busy: boolean; publicOnly: boolean;
  snapshot: CatalogSnapshot | null; onModeChange: (mode: Mode) => void;
  onStoreChange: (store: StoreOption) => void; onSearch: (input: { city: string; keyword: string }) => void;
  onLoad: () => void; loaded: boolean;
}

export function StorePicker({ mode, store, stores, busy, publicOnly, snapshot, onModeChange, onStoreChange, onSearch, onLoad, loaded }: Props) {
  const [city, setCity] = useState('杭州');
  const [keyword, setKeyword] = useState('建国北路286号');
  const sourceInfo = <details className={`source-disclosure ${publicOnly ? '' : 'local-source-disclosure'}`}>
    <summary><span className="source-summary-main"><strong>{snapshot?.store?.name.split('-').at(-1) ?? '正在加载菜单'}</strong><span>门店快照 · 价格仅供参考</span></span><span className="source-summary-date">{snapshot ? new Date(snapshot.capturedAt ?? snapshot.loadedAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' }) + ' 采集' : '加载中'}</span></summary>
    <div className="snapshot-description"><p>{snapshot?.store?.name}{snapshot?.store && ` · ${snapshot.store.address}`}</p>{snapshot && <p>采集时间：{new Date(snapshot.capturedAt ?? snapshot.loadedAt).toLocaleString('zh-CN')}</p>}<p>餐品图片与菜单保存在本站。价格、规格和营养来自采集时的菜单。条件价不保证适用，不是实时官方报价。</p></div>
  </details>;
  if (publicOnly) return <section className="source-picker source-compact" aria-label="菜单来源">{sourceInfo}</section>;
  return <section className="source-picker" aria-label="菜单来源">
    <div className="source-picker-top"><div className="source-tabs" aria-label="菜单模式"><button aria-pressed={mode === 'demo'} disabled={busy} className={mode === 'demo' ? 'active' : ''} onClick={() => onModeChange('demo')}>门店快照试玩</button><button aria-pressed={mode === 'live'} disabled={busy} className={mode === 'live' ? 'active' : ''} onClick={() => onModeChange('live')}>真实菜单</button></div><span className="source-description">{mode === 'demo' ? `${snapshot?.items.length ?? '…'} 个真实菜单候选 · 采集时数据` : loaded ? '到店自提 · 官方菜单已加载' : '到店自提 · 点按钮加载官方菜单'}</span></div>
    {mode === 'demo' && sourceInfo}
    {mode === 'live' && <>
      <form className="store-search" onSubmit={event => { event.preventDefault(); onSearch({ city: city.trim(), keyword: keyword.trim() }); }}><label>城市<input value={city} onChange={event => setCity(event.target.value)} required maxLength={128}/></label><label className="store-keyword">门店 / 地址<input value={keyword} onChange={event => setKeyword(event.target.value)} required maxLength={256}/></label><button className="button button-outline" disabled={busy || !city.trim() || !keyword.trim()}>搜索门店</button></form>
      <div className="store-load-row"><label className="store-select">选择门店<select value={store.id} onChange={event => { const selected = stores.find(value => value.id === event.target.value); if (selected) onStoreChange(selected); }}>{stores.map(value => <option value={value.id} key={value.id}>{value.name} · {value.address}</option>)}</select><span>{store.address}</span></label><button className="button button-primary" disabled={busy} onClick={onLoad}>{busy ? '正在加载…' : loaded ? '刷新真实菜单' : '加载真实菜单'} <span aria-hidden="true">↗</span></button></div>
    </>}
  </section>;
}
