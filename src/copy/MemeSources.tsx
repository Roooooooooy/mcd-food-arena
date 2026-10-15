import { mcdMemes } from './memes.ts';
export { mcdMemes } from './memes.ts';

export function MemeSources() {
  return <details className="meme-sources">
    <summary>这页用了哪些梗？</summary>
    <ul>{Object.values(mcdMemes).map(meme => <li key={meme.text}><strong>{meme.text}</strong><span>{meme.kind}</span><a href={meme.url} target="_blank" rel="noreferrer">{meme.source} ↗</a></li>)}</ul>
    <p>这些用语都有出处，没有自行造梗。只借用“麦乐鸡侠”作麦乐鸡标签，不代表本页有加赠活动。</p>
  </details>;
}
