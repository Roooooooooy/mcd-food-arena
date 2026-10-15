import { mcdMemes } from './memes.ts';
export { mcdMemes } from './memes.ts';

export function MemeSources() {
  return <details className="meme-sources">
    <summary>这页用了哪些梗？</summary>
    <ul>{Object.values(mcdMemes).map(meme => <li key={meme.text}><strong>{meme.text}</strong><span>{meme.kind}</span><a href={meme.url} target="_blank" rel="noreferrer">{meme.source} ↗</a></li>)}</ul>
    <p>“麦乐鸡侠”只作麦乐鸡标签，本页不提供加赠活动。</p>
  </details>;
}
