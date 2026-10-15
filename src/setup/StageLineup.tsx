import { isSelectable, type AvailabilityResult } from '../commerce/availability-contracts.ts';
import { useRef, useState } from 'react';
import { DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, PointerSensor, closestCenter, useSensor, useSensors, type CollisionDetection, type DragEndEvent, type DragStartEvent, type Modifier } from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { FoodArt } from '../arena/FoodArt.tsx';
import { stageName } from '../catalog/normalize.ts';
import { beginStageDrag, commitStageDrag, type StageDrag } from './stage-order.ts';
import type { StageSelection } from './session.ts';
import type { Candidate, CatalogSnapshot } from '../shared/contracts.ts';

interface Props { availability?:AvailabilityResult|null;snapshot: CatalogSnapshot; selection: StageSelection[]; onSelectionChange: (selection: StageSelection[]) => void }
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });
function Grip() {
  return <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">{[7, 12, 17].flatMap(y => [9, 15].map(x => <circle key={`${x}:${y}`} cx={x} cy={y} r="1.6" fill="currentColor"/>))}</svg>;
}

interface RowProps {
  availability?:AvailabilityResult|null;
  stage: StageSelection; items: Candidate[]; index: number; count: number; expanded: boolean; dragging: boolean;
  onMove: (id: string, offset: number) => void; onExpand: () => void; onCandidate: (id: string) => void;
}
function SortableStage({ availability, stage, items, index, count, expanded, dragging, onMove, onExpand, onCandidate }: RowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: stage.id, disabled: count < 2 });
  const name = stageName(items[0]);
  const visibleExpanded = expanded && !dragging;
  return <div ref={setNodeRef} role="listitem" data-stage-order={stage.id} className={`stage-picker sortable-stage ${isDragging ? 'stage-is-dragging' : ''} ${stage.candidateIds.length === 0 ? 'empty-stage' : ''}`} style={{ transform: transform ? `translate3d(${transform.x}px, ${transform.y}px, 0)` : undefined, transition }}>
    <div className="stage-row">
      <button ref={setActivatorNodeRef} type="button" {...attributes} {...listeners} className="stage-drag-handle" disabled={count < 2} aria-label={`拖动${name}分类调整顺序`} title="按住拖动；键盘按空格拿起，上下移动，空格放下，Esc取消"><Grip/></button>
      <div className="stage-row-copy"><h3><span className="lineup-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>{name}<span>{stage.candidateIds.length} / {items.length} 份候选</span></h3><p>{stage.candidateIds.length === 0 ? '至少选一份餐品才能开始挑选' : items.filter(item => stage.candidateIds.includes(item.id)).slice(0, 2).map(item => item.name).join('、') + (stage.candidateIds.length > 2 ? `等 ${stage.candidateIds.length} 份` : '')}</p></div>
      <div className="reorder-controls"><button type="button" className="icon-button" disabled={dragging || index === 0} onClick={() => onMove(stage.id, -1)} aria-label={`${name}分类上移`}>↑</button><button type="button" className="icon-button" disabled={dragging || index === count - 1} onClick={() => onMove(stage.id, 1)} aria-label={`${name}分类下移`}>↓</button></div>
      <button type="button" className="picker-toggle" disabled={dragging} aria-expanded={visibleExpanded} aria-controls={`picker-${stage.id}`} onClick={onExpand}>圈选餐品 <span aria-hidden="true">{visibleExpanded ? '−' : '+'}</span></button>
    </div>
    {visibleExpanded && <fieldset className="candidate-picker" id={`picker-${stage.id}`}><legend className="sr-only">{name}分类候选餐品</legend>{items.map(item => <label key={item.id} className={`candidate-option ${stage.candidateIds.includes(item.id) ? 'checked' : ''}`}><input type="checkbox" disabled={!stage.candidateIds.includes(item.id)&&!isSelectable(availability?.items.find(i=>i.candidateId===item.id))} checked={stage.candidateIds.includes(item.id)} onChange={() => onCandidate(item.id)}/><span className={!isSelectable(availability?.items.find(i=>i.candidateId===item.id))?'availability-image-unavailable':undefined}><FoodArt item={item}/></span><span>{item.name}{!isSelectable(availability?.items.find(i=>i.candidateId===item.id))&&<small>当前菜单未返回</small>}</span></label>)}</fieldset>}
  </div>;
}

export function StageLineup({ availability, snapshot, selection, onSelectionChange }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const drag = useRef<StageDrag | null>(null);
  const list = useRef<HTMLDivElement>(null);
  const latest = useRef({ snapshot, selection, onSelectionChange });
  latest.current = { snapshot, selection, onSelectionChange };
  const endAnnouncement = useRef('');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));
  const itemsFor = (id: string) => snapshot.items.filter(item => item.stageId === id);
  const nameFor = (id: string) => { const item = snapshot.items.find(item => item.stageId === id); return item ? stageName(item) : '分类'; };
  // A pointer released outside this list cancels; keyboard coordinates use item centers.
  const collisionDetection: CollisionDetection = args => {
    if (args.pointerCoordinates) {
      const bounds = list.current?.getBoundingClientRect();
      const { x, y } = args.pointerCoordinates;
      if (!bounds || x < bounds.left || x > bounds.right || y < bounds.top || y > bounds.bottom) return [];
    }
    return closestCenter(args);
  };
  function startDrag(event: DragStartEvent) {
    const current = latest.current;
    drag.current = beginStageDrag(current.snapshot.contextKey, current.selection, String(event.active.id));
    setActiveId(drag.current?.activeId ?? null);
  }
  function cancelDrag() { drag.current = null; setActiveId(null); }
  function endDrag(event: DragEndEvent) {
    const current = latest.current;
    const next = commitStageDrag(current.selection, drag.current, current.snapshot.contextKey, event.over ? String(event.over.id) : null);
    endAnnouncement.current = next === current.selection ? '顺序未改变。' : `${nameFor(String(event.active.id))}已放到第${next.findIndex(stage => stage.id === event.active.id) + 1}位。`;
    cancelDrag();
    if (next !== current.selection) current.onSelectionChange(next);
  }
  function moveStage(id: string, offset: number) {
    const index = selection.findIndex(stage => stage.id === id);
    const target = selection[index + offset];
    const next = commitStageDrag(selection, beginStageDrag(snapshot.contextKey, selection, id), snapshot.contextKey, target?.id ?? null);
    if (next !== selection) onSelectionChange(next);
  }
  function toggleCandidate(stageId: string, id: string) {
    if(!selection.find(s=>s.id===stageId)?.candidateIds.includes(id)&&!isSelectable(availability?.items.find(i=>i.candidateId===id)))return;
    onSelectionChange(selection.map(stage => stage.id !== stageId ? stage : { ...stage, candidateIds: stage.candidateIds.includes(id) ? stage.candidateIds.filter(candidateId => candidateId !== id) : itemsFor(stageId).filter(item => item.id === id || stage.candidateIds.includes(item.id)).map(item => item.id) }));
  }
  const activeStage = selection.find(stage => stage.id === activeId);
  return <>
    <p className="lineup-drag-hint">{activeId ? '松手调整顺序；按 Esc 取消。' : selection.length > 1 ? '拖动左侧手柄调整顺序，也可以点上下箭头。' : '选两类以上，就能拖动调整顺序。'}</p>
    <DndContext sensors={sensors} modifiers={[verticalOnly]} collisionDetection={collisionDetection} measuring={{ droppable: { strategy: MeasuringStrategy.Always } }} onDragStart={startDrag} onDragEnd={endDrag} onDragCancel={cancelDrag} accessibility={{ screenReaderInstructions: { draggable: '聚焦分类手柄，按空格拿起，用上下方向键调整位置，再按空格或Enter放下；按Escape取消。' }, announcements: {
      onDragStart: ({ active }) => `已拿起${nameFor(String(active.id))}，用上下方向键调整位置。`,
      onDragOver: ({ active, over }) => over ? `${nameFor(String(active.id))}移到第${selection.findIndex(stage => stage.id === over.id) + 1}位，放下后生效。` : '已移出列表，放下会取消。',
      onDragEnd: () => endAnnouncement.current,
      onDragCancel: () => '已取消，保留原顺序。',
    } }}>
      <SortableContext items={selection.map(stage => stage.id)} strategy={verticalListSortingStrategy}>
        <div ref={list} className="stage-list" role="list" aria-label="已选餐品分类顺序">{selection.length === 0 && <div className="empty-selection">先选上方的餐品分类，再来挑具体餐品。</div>}{selection.map((stage, index) => <SortableStage availability={availability} key={stage.id} stage={stage} items={itemsFor(stage.id)} index={index} count={selection.length} expanded={expanded === stage.id} dragging={activeId !== null} onMove={moveStage} onExpand={() => setExpanded(expanded === stage.id ? null : stage.id)} onCandidate={id => toggleCandidate(stage.id, id)}/>)}</div>
      </SortableContext>
      <DragOverlay dropAnimation={null} zIndex={60}>{activeStage && <div className="drag-stage-overlay" aria-hidden="true"><Grip/><div><strong>{nameFor(activeStage.id)}</strong><span>{activeStage.candidateIds.length} 份候选 · 松手放下</span></div></div>}</DragOverlay>
    </DndContext>
  </>;
}
