export type Side = 'left' | 'right';
export type Mode = 'demo' | 'live';
export type ArenaStatus = 'active' | 'complete' | 'empty' | 'skipped';

export interface StoreOption {
  id: string;
  name: string;
  city: string;
  address: string;
}

export interface Candidate {
  sourceKind?: 'official-snapshot';
  id: string;
  officialCode: string | null;
  name: string;
  stageId: string;
  sourceCategory: string;
  imageUrl: string | null;
  referencePriceCents: number | null;
  attributes: string[];
  nutrition: Partial<Record<'kcal' | 'proteinG' | 'fatG' | 'carbsG' | 'sodiumMg', number>>;
  mode: Mode;
  stageLabel?: string;
  sourceCategories?: string[];
  variants?: Variant[];
  defaultVariantId?: string;
}

export interface Variant {
  id: string;
  officialCode: string;
  name: string;
  sizeLabel: string;
  referencePriceCents: number | null;
  nutrition: Candidate['nutrition'];
  imageUrl: string | null;
  /** Menu parent and round identify a verified selectable child SKU. */
  menuCode?: string;
  roundId?: number;
}

export interface CatalogSnapshot {
  sourceKind?: 'official-snapshot';
  capturedAt?: string;
  contextKey: string;
  mode: Mode;
  store: StoreOption | null;
  loadedAt: string;
  complete: boolean;
  items: Candidate[];
  rawSkuCount?: number;
}

export interface ArenaFrame {
  championId: string | null;
  remainingIds: string[];
  pair: [string, string] | null;
  status: ArenaStatus;
}

export interface ArenaState extends ArenaFrame {
  arenaId: string;
  stageId: string;
  orderedIds: string[];
  revision: number;
  history: ArenaFrame[];
}

export interface ArenaMatch {
  leftId: string;
  rightId: string;
  revision: number;
}

export interface BasketLine {
  candidateId: string;
  quantity: number;
  optionIds: string[];
}

export interface QuoteRequest {
  contextKey: string;
  basket: BasketLine[];
  cartRevision: number;
}

export interface QuoteResult {
  contextKey: string;
  basketKey: string;
  cartRevision: number;
  totalCents: number;
  currency: 'CNY';
  quotedAt: string;
  mode: Mode;
  evidence: 'official' | 'sample' | 'snapshot';
  fees: { label: string; amountCents: number }[];
}

export interface BasketSelection {
  candidateId: string;
  components: {name: string; quantity: number}[];
  requiresSelection: boolean;
}
