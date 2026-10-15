import type { StageSelection } from './session.ts';

export interface StageDrag { contextKey: string; selectionKey: string; activeId: string }
function selectionKey(selection: StageSelection[]): string {
  return JSON.stringify(selection.map(stage => [stage.id, stage.candidateIds]));
}
export function beginStageDrag(contextKey: string, selection: StageSelection[], activeId: string): StageDrag | null {
  if (selection.length < 2 || new Set(selection.map(stage => stage.id)).size !== selection.length || !selection.some(stage => stage.id === activeId)) return null;
  return { contextKey, selectionKey: selectionKey(selection), activeId };
}
export function commitStageDrag(selection: StageSelection[], drag: StageDrag | null, contextKey: string, overId: string | null): StageSelection[] {
  if (!drag || !overId || drag.contextKey !== contextKey || drag.selectionKey !== selectionKey(selection)) return selection;
  const from = selection.findIndex(stage => stage.id === drag.activeId);
  const to = selection.findIndex(stage => stage.id === overId);
  if (from < 0 || to < 0 || from === to) return selection;
  const next = [...selection];
  next.splice(to, 0, next.splice(from, 1)[0]);
  return next;
}
