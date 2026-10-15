import { useId, useState } from 'react';
import type { Candidate } from '../shared/contracts.ts';

// Original vector illustrations, drawn for this synthetic catalog.
export function FoodArt({ item, className = '', priority = false }: { item: Pick<Candidate, 'id' | 'stageId'> & Partial<Pick<Candidate, 'imageUrl'>>; className?: string; priority?: boolean }) {
  const uid = useId().replace(/:/g, '');
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  if (item.imageUrl && failedUrl !== item.imageUrl) return <img className={`food-art official-food-art ${className}`} src={item.imageUrl} alt="" aria-hidden="true" loading={priority ? 'eager' : 'lazy'} onError={() => setFailedUrl(item.imageUrl ?? null)}/>;
  const variation = [...item.id].reduce((sum, letter) => sum + letter.charCodeAt(0), 0) % 4;
  const slug = item.id.split(':').at(-1) ?? '';
  const bun = `url(#${uid}-bun)`;
  const crisp = `url(#${uid}-crisp)`;
  const paper = ['#e7613c', '#f2b445', '#a7473a', '#df8460'][variation];
  const burger = (breakfast = false) => <g>
    <path d="M52 153Q140 170 228 153L220 177Q140 200 60 177Z" fill="#d68836" />
    <path d="M55 157Q140 175 225 157L222 164Q140 183 58 164Z" fill="#f7c76a" />
    <path d="M52 143Q63 130 85 138T127 136T168 138T225 137L228 152Q215 163 195 151T155 156T112 151T71 154L52 151Z" fill="#548844" />
    <path d="M57 126Q140 113 222 126L223 142Q140 158 55 143Z" fill={slug.includes('chicken') ? '#b96429' : '#72432b'} />
    <path d="M60 123L100 113L219 123L193 149L147 132L104 148Z" fill="#ffc547" />
    <path d="M68 114Q140 102 213 114L209 123Q140 137 68 123Z" fill={breakfast ? '#f9ead0' : '#dc583f'} />
    {slug.includes('double') && <path d="M60 101Q140 89 220 101L217 117Q140 132 61 117Z" fill="#72432b" />}
    <path d="M49 113C50 51 230 45 232 113Q140 137 49 113Z" fill={bun} />
    <path d="M57 100C74 52 204 54 224 100" fill="none" stroke="#ffda83" strokeWidth="5" strokeLinecap="round" />
    {[[88, 79], [116, 64], [152, 77], [181, 65], [196, 93], [129, 100], [74, 101], [165, 101]].map(([x, y], i) => <ellipse key={i} cx={x} cy={y} rx="4" ry="2" fill="#fff0bb" transform={`rotate(${i % 2 ? 24 : -24} ${x} ${y})`} />)}
  </g>;
  const fries = <g>
    {[[-8, 70, -10], [17, 50, 6], [40, 66, -4], [65, 43, 9], [87, 59, -5], [107, 76, 8]].map(([x, y, angle], i) => <g key={i} transform={`rotate(${angle} ${86 + x} 140)`}><rect x={77 + x} y={y} width="16" height="109" rx="3" fill={i % 2 ? '#edac38' : '#ffd76a'} /><path d={`M${81 + x} ${y + 5}v95`} stroke="#fff0ac" strokeWidth="3" /></g>)}
    <path d="M62 128Q140 158 218 128L205 195Q140 215 76 195Z" fill={paper} />
    <path d="M62 128Q140 158 218 128L211 147Q140 173 69 147Z" fill="#f47b51" />
    <path d="M124 176L140 165L156 176L140 189Z" fill="#ffde84" />
  </g>;
  const cup = (coffee = false) => <g>
    {coffee && <><path d="M209 111C252 96 251 156 205 160" fill="none" stroke="#d39b6c" strokeWidth="13" /><path d="M210 111C242 105 240 145 210 149" fill="none" stroke="#fff4d9" strokeWidth="7" /></>}
    <path d={coffee ? 'M69 90H213L199 174Q140 195 83 174Z' : 'M80 54H201L187 187Q140 207 94 187Z'} fill={coffee ? '#f1d0a0' : '#edcda1'} />
    <path d={coffee ? 'M81 110H206L197 172Q140 190 86 172Z' : 'M87 78H194L183 184Q141 197 97 183Z'} fill={coffee ? ['#865333', '#d09c68', '#c4996d', '#b67642'][variation] : slug.includes('cola') ? '#71452f' : slug.includes('orange') ? '#f4ad36' : slug.includes('lychee') ? '#dfbda6' : '#bd8544'} />
    <path d="M97 99L107 174" stroke="#fff9df" strokeWidth="7" strokeLinecap="round" opacity=".4" />
    {coffee ? <><ellipse cx="141" cy="90" rx="72" ry="17" fill="#fff1d5" /><ellipse cx="141" cy="90" rx="62" ry="12" fill={slug.includes('americano') ? '#673d2b' : '#bd8c59'} />{!slug.includes('americano') && <path d="M140 88C114 68 108 93 141 99C172 87 164 76 140 88Z" fill="#f9e4bd" />}<path d="M119 57Q109 45 121 31M147 53Q159 42 148 27M171 59Q181 47 175 36" stroke="#c9ae8e" strokeWidth="3" fill="none" strokeLinecap="round" /></> : <><rect x="150" y="26" width="9" height="124" rx="3" fill="#faf2db" transform="rotate(12 154 100)" /><ellipse cx="140" cy="56" rx="61" ry="13" fill="#f1ddb9" /><ellipse cx="140" cy="56" rx="51" ry="8" fill="#ceaa7b" />{[105, 127, 152].map((x, i) => <rect key={x} x={x} y={80 + i * 19} width="24" height="20" rx="4" fill="#fff6e3" opacity=".45" transform={`rotate(${i * 18 - 12} ${x} 100)`}/>)}{slug.includes('lemon') && <g transform="translate(180 88) rotate(16)"><circle r="25" fill="#f4c245"/><circle r="20" fill="#fff3af"/><path d="M0-17V17M-17 0H17M-12-12L12 12M-12 12L12-12" stroke="#ecc046" strokeWidth="2"/></g>}</>}
  </g>;
  const dessert = <g>
    <path d="M83 135H200L187 194Q140 209 97 194Z" fill={paper} /><path d="M87 139H196L191 155H92Z" fill="#f8d5a8" />
    <path d="M87 133C74 117 83 99 108 100C91 83 111 65 131 71C123 55 141 39 149 35C142 56 176 58 171 76C197 73 202 100 183 108C214 113 209 137 190 141Z" fill="#fff0ce" />
    <path d="M112 85Q142 94 171 76M101 112Q144 126 184 105" stroke={slug.includes('cocoa') ? '#8b5237' : slug.includes('berry') ? '#d65f59' : '#e4c294'} strokeWidth="10" fill="none" strokeLinecap="round" />
    {slug.includes('mango') && <><rect x="105" y="97" width="20" height="16" rx="4" fill="#f5b33d"/><rect x="158" y="113" width="22" height="18" rx="4" fill="#f5b33d"/></>}
    {slug.includes('cookie') && <g fill="#805336"><circle cx="110" cy="106" r="7"/><circle cx="177" cy="117" r="6"/><circle cx="142" cy="63" r="5"/></g>}
    <path d="M122 172Q140 182 158 172" stroke="#ffdf96" strokeWidth="5" fill="none" strokeLinecap="round" />
  </g>;
  let art;
  if (item.stageId === 'burger') art = burger();
  else if (item.stageId === 'drink') art = cup();
  else if (item.stageId === 'coffee') art = cup(true);
  else if (item.stageId === 'dessert') art = dessert;
  else if (item.stageId === 'pie') art = <g transform={`rotate(${variation % 2 ? 10 : -9} 140 120)`}><path d="M63 74L203 62L226 165L84 179Z" fill="#d79039"/><path d="M64 74L203 62L212 145L78 157Z" fill={bun}/><path d="M80 87L193 77M83 141L201 130" stroke="#c88532" strokeWidth="3" strokeDasharray="3 5"/>{[102, 132, 162].map(x => <path key={x} d={`M${x} 88l12 38`} stroke="#aa692d" strokeWidth="7" strokeLinecap="round"/>)}<path d="M91 166L215 153" stroke="#f5c466" strokeWidth="3"/><path d="M212 134L225 165L195 169L188 144Z" fill={slug.includes('taro') ? '#ad799b' : slug.includes('red-bean') ? '#7e4137' : '#e5ba56'}/></g>;
  else if (item.stageId === 'chicken') art = <g><ellipse cx="140" cy="171" rx="106" ry="29" fill="#f4e3c6" /><ellipse cx="140" cy="164" rx="96" ry="25" fill="#fff7e8" />{[[-25, -3, -25], [41, 15, 24]].map(([x, y, angle], i) => <g key={i} transform={`translate(${x} ${y}) rotate(${angle} 140 130)`}><path d="M151 135L199 147" stroke="#f6dfb8" strokeWidth="13" strokeLinecap="round"/><circle cx="204" cy="144" r="9" fill="#fff0d2"/><circle cx="202" cy="154" r="8" fill="#fff0d2"/><path d="M80 105C76 76 125 61 151 85C183 100 181 145 147 155C110 169 73 143 80 105Z" fill={crisp}/>{[[101, 103], [128, 91], [143, 125], [107, 139], [158, 108]].map(([cx, cy]) => <path key={cx} d={`M${cx} ${cy}l5-3 4 6-7 3Z`} fill="#f3c362"/>)}</g>)}<path d="M68 174Q86 150 103 161M185 174Q201 150 216 162" stroke="#598748" fill="none" strokeWidth="6" strokeLinecap="round"/></g>;
  else if (item.stageId === 'side') {
    if (slug.includes('fries')) art = fries;
    else if (slug.includes('corn')) art = <g transform="rotate(-20 140 120)"><path d="M72 147Q137 192 203 145" fill="#67904c"/><rect x="70" y="83" width="140" height="69" rx="33" fill="#f3bf45"/>{[0, 1, 2, 3].flatMap(row => Array.from({ length: 9 }, (_, col) => <rect key={`${row}-${col}`} x={83 + col * 13} y={89 + row * 15} width="10" height="12" rx="4" fill={(row + col) % 2 ? '#ffdb74' : '#edac36'}/>))}<path d="M69 160Q90 182 141 172" fill="none" stroke="#497847" strokeWidth="9" strokeLinecap="round"/></g>;
    else if (slug.includes('salad')) art = <g><path d="M63 114H217L202 180Q140 206 78 180Z" fill="#e8c899"/>{[[85, 96], [128, 77], [173, 97], [139, 114], [197, 111]].map(([x, y], i) => <ellipse key={x} cx={x} cy={y} rx="30" ry="20" fill={i % 2 ? '#7ca354' : '#4f824b'} transform={`rotate(${x} ${x} ${y})`}/>)}<circle cx="104" cy="114" r="17" fill="#e36644"/><circle cx="174" cy="88" r="16" fill="#e36644"/><path d="M90 142Q140 162 191 142" stroke="#f7e3be" fill="none" strokeWidth="8"/></g>;
    else if (slug.includes('rings')) art = <g>{[[96, 129, -15], [168, 137, 15], [136, 95, 0]].map(([x, y, a]) => <ellipse key={x} cx={x} cy={y} rx="39" ry="28" fill="none" stroke={crisp} strokeWidth="18" transform={`rotate(${a} ${x} ${y})`}/>)}</g>;
    else art = <g>{[[61, 128, -18], [107, 148, 12], [144, 106, 27], [180, 152, -15]].map(([x, y, a], i) => <g key={x} transform={`rotate(${a} ${x} ${y})`}><path d={`M${x} ${y}q7-62 48-60l-7 64Z`} fill={i % 2 ? '#e4a13b' : '#f5c460'}/><path d={`M${x + 6} ${y - 4}q9-45 36-49`} stroke="#fbda88" fill="none" strokeWidth="4"/></g>)}</g>;
  } else if (slug.includes('pancakes')) art = <g>{[152, 138, 124].map((y, i) => <g key={y}><rect x="57" y={y} width="168" height="19" rx="9" fill="#c98b44"/><ellipse cx="141" cy={y} rx="84" ry="19" fill={i === 2 ? '#f4ca7d' : '#e9b965'}/></g>)}<path d="M101 113Q135 124 173 110L183 143Q168 157 163 145L159 131L142 138Q130 147 126 132Z" fill="#ad6836"/><rect x="130" y="97" width="35" height="18" rx="4" fill="#ffe797" transform="rotate(-12 147 106)"/></g>;
  else if (slug.includes('oatmeal')) art = <g><path d="M58 106H224Q209 190 141 190Q72 190 58 106Z" fill="#d17958"/><ellipse cx="141" cy="106" rx="83" ry="25" fill="#f0d6a7"/><ellipse cx="141" cy="103" rx="72" ry="19" fill="#ddbd85"/>{[99, 123, 151, 175].map((x, i) => <ellipse key={x} cx={x} cy={98 + i % 2 * 11} rx="10" ry="4" fill="#f8e3b7"/>)}<path d="M128 68Q117 50 132 37M157 63Q169 48 158 32" fill="none" stroke="#c4ac90" strokeWidth="3" strokeLinecap="round"/></g>;
  else if (slug.includes('roll')) art = <g transform="rotate(-15 140 130)"><path d="M66 98Q74 70 105 74L199 117L185 173L82 148Q64 142 66 98Z" fill="#f3d59d"/><path d="M90 147L168 160L179 129L109 95" fill="none" stroke="#d0a56d" strokeWidth="3"/><ellipse cx="196" cy="143" rx="21" ry="32" fill="#d7b47b"/><ellipse cx="197" cy="143" rx="16" ry="26" fill="#65914d"/><path d="M187 127L207 131L198 160L186 153Z" fill="#e99575"/><circle cx="200" cy="141" r="10" fill="#ffdc74"/></g>;
  else art = burger(true);
  return <svg className={`food-art ${className}`} viewBox="0 0 280 220" aria-hidden="true" focusable="false">
    <defs><linearGradient id={`${uid}-bun`} x1="0" y1="0" x2="0.1" y2="1"><stop stopColor="#ffdb86"/><stop offset="1" stopColor="#df9d43"/></linearGradient><linearGradient id={`${uid}-crisp`} x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e9af4d"/><stop offset="1" stopColor="#b86b2c"/></linearGradient></defs>
    <ellipse cx="140" cy="193" rx="92" ry="12" fill="#793f28" opacity=".10" />{art}
  </svg>;
}
