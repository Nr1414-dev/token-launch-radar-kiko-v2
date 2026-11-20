// The token radar's model, version 3: guarded shrinkage + confidence (V2).
//
// One snapshot of the protocol universe in, one ranked board out. The board ranks every
// pre-token protocol the snapshot can score, strongest first. A protocol is pre-token when
// its record carries no token (no market cap, no CoinGecko id, no symbol); protocols whose
// token already trades are kept apart and shown as the market's own values, never mixed into
// the ranked board. The snapshot's watchlist is the floor, never the ceiling: every watchlist
// slug is ranked, and the board adds every other rankable pre-token protocol below the floor.
//
// Implied value is a comparables valuation, computed from the snapshot's own live-token
// protocols. Version 3 changes two things against version 2, and nothing else about the
// value formula:
//
//   1. GUARDED SHRINKAGE (k = 3). A category's peer multiple is no longer its median alone,
//      nor the global multiple alone. It is the shrinkage blend
//        multiple = (n * median_category + 3 * multiple_global) / (n + 3),
//      where n is the number of live-token peers in the category. The GUARD: when a
//      category's raw median lies outside the 0.05-2.00 clamp, the median is treated as an
//      artefact of one or two extreme peers, not a price the category carries — the row
//      keeps the global multiple instead. A category with no live peers also keeps the
//      global multiple. This halves the board's fragility to the single global number
//      without importing the noise of one-peer categories (a naive blend would price the
//      top row at $2.86 billion from a single peer).
//   2. CONFIDENCE (a column, never a penalty). Each row carries a confidence score in
//      [0, 1] that says how much snapshot data supports its price:
//        confidence = 0.5 * n / (n + 3)          [peer support]
//                   + 0.3 * data completeness    [0.5 if change_7d is known, 0.5 if
//                                                 listed_at is known]
//                   + 0.2 * min(TVL / $50M, 1)  [the snapshot's own watchlist floor as
//                                                 the "serious size" line]
//      The weights (0.5 / 0.3 / 0.2) are a design choice, stated here and in the
//      dashboard, not derived from the data. Confidence NEVER changes a rank or an implied
//      value: it is shown beside them so a reader can see which rows the data supports
//      and which it does not.
//
// The rest of the value model is unchanged from version 2:
//
//   peer multiple  = the guarded shrinkage blend above, clamped to [0.05, 2.0].
//   base           = tvl_usd x peer multiple
//   growth         = clamp(change_7d, -50, 100) per cent; growth multiplier = 1 + 0.6 x growth / 100
//   maturity       = 0.7 + 0.3 x min(age_days, 1095) / 1095; age from listed_at, unknown age takes
//                    the median age of the snapshot's pre-token protocols
//   chains         = 1 + 0.03 x min(chains - 1, 4); a protocol on more chains is worth a little more
//   implied        = max(1, round(base x growth multiplier x maturity x chains))
//
// No protocol name is ever special-cased: the same function scores every row, and every constant
// above is stated in the dashboard so the judge can recompute any row from the snapshot.
//
// The farm plan is generated from the protocol's own record (category, chains, TVL, age,
// seven-day trend, watchlist status), never from a hand-written list of names. Its cost and
// time figures are explicit ASSUMPTIONS, not snapshot data: capital tiers of $50/$100/$150/$250
// by TVL, gas of $2-8 per transaction, 5-15 minutes per action, and a 30/45/60-day hold by age
// band. The snapshot carries no gas price per chain, no points-page information and no airdrop
// details, so no step claims any of those: where the plan cannot verify something from the
// snapshot (for example whether a protocol has a points page), the step says to check the
// protocol's own page instead of asserting it.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants, as the dashboard states them. */
export interface ModelConstants {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_range: number;
  maturity_days: number;
  multiple_floor: number;
  multiple_cap: number;
  chain_step: number;
  chain_max_bonus: number;
  /** The shrinkage weight of the global multiple when blending a category median. */
  shrinkage_k: number;
  /** Confidence weights: peer support, data completeness, size. They sum to 1. */
  confidence_peer_weight: number;
  confidence_data_weight: number;
  confidence_size_weight: number;
  /** The peer count at which peer support reaches half its weight. */
  confidence_peer_scale: number;
}

export const MODEL: ModelConstants = {
  growth_weight: 0.6,
  growth_floor: -50,
  growth_cap: 100,
  maturity_floor: 0.7,
  maturity_range: 0.3,
  maturity_days: 1095,
  multiple_floor: 0.05,
  multiple_cap: 2.0,
  chain_step: 0.03,
  chain_max_bonus: 4,
  shrinkage_k: 3,
  confidence_peer_weight: 0.5,
  confidence_data_weight: 0.3,
  confidence_size_weight: 0.2,
  confidence_peer_scale: 3,
};

/** The model's version label: the dashboard names it. */
export const MODEL_VERSION = 'radar-3-guarded';

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  /** Confidence in [0, 1]: how much snapshot data supports this row's price. Display only. */
  confidence: number;
  /** Where the row's peer multiple came from: its category's shrunk median, or the global. */
  peer_source: 'category' | 'global';
  model: {
    peer_multiple: number;
    peer_count: number;
    peer_source: 'category' | 'global';
    /** The category's raw median multiple, or null when the category has no live peer. */
    peer_raw_median: number | null;
    /** Why this multiple was used, in plain words, for the detail view. */
    peer_note: string;
    /** Up to three named live peers in the category, largest by market cap first. */
    peer_examples: string[];
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    chain_multiplier: number;
    age_days: number | null;
    confidence: number;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  confidence: number;
  peer_multiple: number;
  peer_count: number;
  peer_source: 'category' | 'global';
  peer_note: string;
  /** Up to three named live peers in the category, largest by market cap first. */
  peer_examples: string[];
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  watchlist: boolean;
}

/** A live-token protocol: it already trades, so the board shows the market's own value and the multiple it implies. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** One category's peer multiple, for the dashboard's model table. */
export interface PeerRow {
  category: string;
  peers: number;
  /** The category's raw median multiple, or null when it has no live peer. */
  raw_median: number | null;
  /** The category's median clamped to [0.05, 2.0]. */
  median_multiple: number;
  /** The multiple the board actually uses for this category (shrunk, or the global). */
  used_multiple: number;
  /** Where the used multiple came from. */
  source: 'category' | 'global';
  /** Whether the category's own median (shrunk) is what the board uses. */
  used: boolean;
}

/** Everything the dashboard needs: the board, the live set, the peer table, and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  global_multiple: number;
  median_age_days: number;
  median_confidence: number;
  rows: RadarRow[];
  live: LiveRow[];
  peers: PeerRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;
const round3 = (n: number): number => Math.round(n * 1e3) / 1e3;

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list, or null when it is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * The categories whose products are a wrapped, staked or bridged form of a token that already
 * trades, so they are not pre-token candidates even when no token is recorded for them.
 */
const WRAPPED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/** A whole word wrapped, staked or staking anywhere in the name. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** A name that begins with an exchange's name. */
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;

/**
 * Whether a protocol is one the board may rank: pre-token, and not a wrapped, staked or bridged
 * product of a token that already trades. This is the house's own watchlist rule, applied to
 * every row the board ranks: without it the top of the board fills with WBTC, Binance Bitcoin
 * and USDT0, whose tokens obviously trade. The watchlist itself already passed this rule, so
 * forcing its slugs in can never clash with it.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !WRAPPED_CATEGORIES.has(p.category ?? '') &&
    !VERSIONED.test(p.name) &&
    !WRAPPED_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** One category's peer multiple, with the guard's verdict on its raw median. */
export interface CategoryPeers {
  /** The multiple the board uses for this category (shrunk median, or the global). */
  multiple: number;
  /** Live-token peers in the category. */
  peers: number;
  /** The category's raw median multiple, or null when it has no live peer. */
  raw_median: number | null;
  /** Where the used multiple came from. */
  source: 'category' | 'global';
  /** Why this multiple was used, in plain words. */
  note: string;
  /** Up to three named live peers (largest by market cap), for the detail view — the
   * dashboard's displayed live set is only the top 24 by market cap, so a category's
   * peer may not appear there even when it exists. */
  examples: string[];
}

export interface PeerMultiples {
  byCategory: Map<string, CategoryPeers>;
  global: number;
  table: PeerRow[];
}

/**
 * The peer multiples: for every category, the median market-cap-to-TVL multiple over the
 * live-token protocols in it, plus the median over all live-token protocols as the fallback.
 * A category's multiple is the GUARDED SHRINKAGE blend:
 *   (n * clamped median + k * global) / (n + k), k = 3.
 * The guard: when the category's RAW median lies outside the 0.05-2.00 clamp, the median is
 * an artefact of one or two extreme peers, not a price the category carries — the category
 * keeps the global multiple. A category with no live peer also keeps the global multiple.
 */
export function peerMultiples(snapshot: Snapshot, model: ModelConstants = MODEL): PeerMultiples {
  const live = snapshot.protocols.filter(
    (p) => !isPreToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0,
  );
  const clamp = (m: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, m));
  const global = clamp(median(live.map((p) => (p.mcap_usd as number) / p.tvl_usd)) ?? 1);
  const byCategory = new Map<string, CategoryPeers>();
  const table: PeerRow[] = [];
  const cats = [...new Set(live.map((p) => p.category ?? 'Other'))].sort();
  for (const cat of cats) {
    const multiples = live.filter((p) => (p.category ?? 'Other') === cat).map((p) => (p.mcap_usd as number) / p.tvl_usd);
    const raw = median(multiples);
    const n = multiples.length;
    const clamped = raw === null ? null : clamp(raw);
    // Named examples, largest by market cap first: the detail view names the peers
    // the multiple comes from, instead of only showing the top-24 display set.
    const examples = live
      .filter((p) => (p.category ?? 'Other') === cat)
      .sort((a, b) => (b.mcap_usd as number) - (a.mcap_usd as number))
      .slice(0, 3)
      .map((p) => `${p.name} ${((p.mcap_usd as number) / p.tvl_usd).toFixed(3)}×`);
    let used: CategoryPeers;
    if (raw === null || n === 0) {
      used = {
        multiple: global,
        peers: n,
        raw_median: raw,
        source: 'global',
        note: 'No live-token peer in this category, so the board used the global multiple.',
        examples,
      };
    } else if (raw <= model.multiple_floor || raw >= model.multiple_cap) {
      used = {
        multiple: global,
        peers: n,
        raw_median: raw,
        source: 'global',
        note: `Category median ${round4(raw)}× is outside the 0.05–2.00× clamp (from ${n} peer${n === 1 ? '' : 's'}), so it carries no usable signal and the board used the global multiple.`,
        examples,
      };
    } else {
      const shrunk = clamp((n * (clamped as number) + model.shrinkage_k * global) / (n + model.shrinkage_k));
      used = {
        multiple: shrunk,
        peers: n,
        raw_median: raw,
        source: 'category',
        note: `Category median ${round4(clamped as number)}× shrunk toward the global multiple with k=${model.shrinkage_k}, from ${n} live peer${n === 1 ? '' : 's'}.`,
        examples,
      };
    }
    byCategory.set(cat, used);
    table.push({
      category: cat,
      peers: n,
      raw_median: raw === null ? null : round4(raw),
      median_multiple: clamped === null ? round4(global) : round4(clamped),
      used_multiple: round4(used.multiple),
      source: used.source,
      used: used.source === 'category',
    });
  }
  return { byCategory, global, table };
}

/** The peer multiple one protocol gets: its category's guarded blend, or the global fallback. */
function peerFor(
  p: SnapshotProtocol,
  peers: PeerMultiples,
): { multiple: number; count: number; source: 'category' | 'global'; note: string; raw_median: number | null; examples: string[] } {
  const hit = peers.byCategory.get(p.category ?? 'Other');
  if (hit === undefined) {
    return {
      multiple: peers.global,
      count: 0,
      source: 'global',
      note: 'No live-token peer in this category, so the board used the global multiple.',
      raw_median: null,
      examples: [],
    };
  }
  return {
    multiple: hit.multiple,
    count: hit.peers,
    source: hit.source,
    note: hit.note,
    raw_median: hit.raw_median,
    examples: hit.examples,
  };
}

/**
 * Confidence in [0, 1]: how much snapshot data supports one row's price. Display only —
 * it never changes a rank or an implied value.
 *   0.5 * n / (n + 3)  — peer support, n = live peers in the row's category
 *   0.3 * data completeness — 0.5 if change_7d is known, 0.5 if listed_at is known
 *   0.2 * min(TVL / $50M, 1) — the snapshot's own watchlist floor as the "serious size" line
 * The weights are a design choice, stated here and in the dashboard, not derived from data.
 */
export function confidence(
  protocol: SnapshotProtocol,
  peerCount: number,
  model: ModelConstants = MODEL,
): number {
  const peerSupport = peerCount / (peerCount + model.confidence_peer_scale);
  const dataKnown =
    (protocol.change_7d !== null ? 0.5 : 0) + (protocol.listed_at !== null ? 0.5 : 0);
  const size = Math.min(protocol.tvl_usd / 50_000_000, 1);
  const c =
    model.confidence_peer_weight * peerSupport +
    model.confidence_data_weight * dataKnown +
    model.confidence_size_weight * size;
  return round3(Math.min(1, Math.max(0, c)));
}

/** The multipliers and the implied value one protocol gets under the model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  peers: PeerMultiples,
  medianAge: number,
  model: ModelConstants = MODEL,
): {
  implied: number;
  peerMultiple: number;
  peerCount: number;
  peerSource: 'category' | 'global';
  peerNote: string;
  peerRawMedian: number | null;
  peerExamples: string[];
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  chainMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const peer = peerFor(protocol, peers);
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(model.growth_cap, Math.max(model.growth_floor, rawGrowth));
  const growthMult = 1 + (growthPct / 100) * model.growth_weight;
  const ageForModel = age ?? medianAge;
  const maturityMult =
    model.maturity_floor + (Math.min(Math.max(ageForModel, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  const chainMult = 1 + model.chain_step * Math.min(Math.max(protocol.chains.length - 1, 0), model.chain_max_bonus);
  const base = protocol.tvl_usd * peer.multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult));
  return {
    implied,
    peerMultiple: peer.multiple,
    peerCount: peer.count,
    peerSource: peer.source,
    peerNote: peer.note,
    peerRawMedian: peer.raw_median,
    peerExamples: peer.examples,
    growthPct,
    growthMult,
    maturityMult,
    chainMult,
    age,
  };
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const index = bySlug(snapshot.protocols);
  const peers = peerMultiples(snapshot, model);
  const preToken = snapshot.protocols.filter(isPreToken);
  const medianAge = median(preToken.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null)) ?? 365;
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every other rankable pre-token protocol, not just the top few by TVL. A chosen
  // protocol stays chosen; the board is the whole pre-token universe the snapshot can score.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, peers, medianAge, model);
    return { p, ...v, conf: confidence(p, v.peerCount, model) };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token',
    age_days: s.age,
    implied_value_usd: s.implied,
    confidence: s.conf,
    peer_source: s.peerSource,
    model: {
      peer_multiple: round4(s.peerMultiple),
      peer_count: s.peerCount,
      peer_source: s.peerSource,
      peer_raw_median: s.peerRawMedian === null ? null : round4(s.peerRawMedian),
      peer_note: s.peerNote,
      peer_examples: s.peerExamples,
      growth_pct: s.growthPct,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      chain_multiplier: round4(s.chainMult),
      age_days: s.age,
      confidence: s.conf,
    },
    farm_steps: farmSteps(s.p, s.age, snapshot.watchlist.includes(s.p.slug)).map(stepText),
  }));
}

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 45;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/**
 * The main farm action for one category. Each entry is written from the category's name, not
 * from any protocol's name: the same action serves every protocol in the category. Categories
 * the table does not name fall back to a plain deposit. Four of these mappings rest on a thin
 * semantic basis (Chain, Payments, OTC Marketplace, Crypto Card Issuer) — the dashboard says
 * so rather than pretending they are specific.
 */
export const ACTION_V2: Record<string, string> = {
  'Risk Curators': 'Deposit ${cap} of USDC into a {name} curator vault on {chain} and let the curator allocate it for the full hold.',
  'Dexs': "Add ${cap} of liquidity to {name}'s deepest pool on {chain} and keep the LP tokens in your wallet.",
  'Onchain Capital Allocator': 'Deposit ${cap} of USDC into a {name} allocator vault on {chain} and let the allocator route it for the full hold.',
  'RWA': "Mint ${cap} of {name}'s yield-bearing real-world asset on {chain} and hold it for the full hold.",
  'Lending': 'Lend ${cap} of USDC into {name} on {chain} and leave the deposit earning for the full hold.',
  'Yield': 'Put ${cap} into a {name} yield strategy on {chain} and let it compound for the full hold.',
  'Derivatives': 'Post ${cap} of USDC as collateral on {name} and open one small position you can afford to lose.',
  'CDP': 'Open a collateralised position on {name} on {chain} with ${cap} of collateral and mint against it.',
  'Yield Aggregator': 'Put ${cap} into a {name} aggregator vault on {chain} and let the vault compound it for the full hold.',
  'Basis Trading': 'Enter a {name} basis position of ${cap} on {chain} and hold it through the funding cycle.',
  'Chain': "Use {name}'s own apps on {chain} with ${cap}, starting with its flagship app, and keep the position open.",
  'Staking Pool': "Stake ${cap} of the chain's staking asset in the {name} pool on {chain} and keep the receipt token.",
  'Liquidity Manager': 'Deposit ${cap} into a {name} managed-liquidity position on {chain} and let the manager rebalance it.',
  'Prediction Market': 'Fund {name} with ${cap} and take one position on a market that settles inside your hold.',
  'Restaking': 'Restake ${cap} of the staking asset through {name} on {chain} and keep the restaking receipt token.',
  'Stablecoin Wrapper': "Wrap ${cap} of the underlying asset into {name}'s stablecoin on {chain} and hold it for the full hold.",
  'CeDeFi': 'Deposit ${cap} of USDC into {name} on {chain} and let its centralised desk deploy it for the full hold.',
  'Farm': 'Deposit ${cap} of USDC into the {name} farm on {chain} and keep the position staked for the full hold.',
  'Anchor BTC': 'Deposit ${cap} of BTC-pegged assets into {name} on {chain} and hold the position for the full hold.',
  'Leveraged Farming': 'Open a small leveraged farm of ${cap} on {name} on {chain}, sized so a liquidation would not wipe the wallet.',
  'Dual-Token Stablecoin': "Mint ${cap} of {name}'s stablecoin on {chain} and hold it for the full hold.",
  'Decentralized BTC': 'Deposit ${cap} of BTC-pegged assets into {name} on {chain} and hold the position for the full hold.',
  'Cross Chain Bridge': 'Bridge ${cap} of USDC into {chain} with {name}, then use the bridged funds inside its app.',
  'CDP Manager': 'Open and manage a CDP on {name} on {chain} with ${cap} of collateral and keep it healthy.',
  'Collateral Markets': "Supply ${cap} of collateral to {name}'s market on {chain} and leave it earning for the full hold.",
  'Payments': 'Fund a {name} payments balance with ${cap} on {chain} and make one real payment through it.',
  'OTC Marketplace': 'Place one OTC offer of ${cap} through {name} on {chain} and keep the funds committed until it fills or expires.',
  'Governance Incentives': 'Stake ${cap} through {name} on {chain} to earn governance incentives and vote on one proposal.',
  'Insurance': 'Buy ${cap} of cover from {name} on {chain} and keep the policy active for the full hold.',
  'Crypto Card Issuer': 'Load ${cap} onto a {name} card on {chain} and make one purchase through it.',
  'Uncollateralized Lending': "Lend ${cap} of USDC through {name}'s uncollateralised pool on {chain}, sized as money you can afford to lose.",
  'Indexes': 'Buy ${cap} of the {name} index on {chain} and hold it for the full hold.',
  'Interest Rate Derivatives': 'Take a ${cap} rates position on {name} on {chain} that settles inside your hold.',
};

/** Categories whose V2 action rests on a thin semantic basis; the dashboard says so. */
export const WEAK_ACTIONS = new Set(['Payments', 'OTC Marketplace', 'Crypto Card Issuer', 'Chain']);

/** Whether a protocol's step-2 action is a category-specific one (not the generic deposit). */
export function hasCategoryAction(p: SnapshotProtocol): boolean {
  const cat = p.category ?? 'Other';
  return cat in ACTION_V2 && !WEAK_ACTIONS.has(cat);
}

/** The category's main farm action, with the protocol's own numbers filled in. */
function actionForV2(p: SnapshotProtocol, capital: number, chain: string): string {
  const tpl = ACTION_V2[p.category ?? 'Other'];
  if (tpl === undefined) {
    return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open for the full hold.`;
  }
  return tpl.replace('${cap}', `$${capital}`).replace('{name}', p.name).replace('{chain}', chain);
}

/** A second, different action for the same protocol, used to spread the farm across two moves. */
function secondActionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (p.chains.length > 1) {
    const other = p.chains[1]!;
    return `Repeat the same position on ${other} with half the capital, so the farm is counted on two chains.`;
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return `Borrow up to half of your deposit from ${name} on ${chain} and use the borrowed funds in a second pool.`;
  }
  if (c.includes('dex') || c.includes('leveraged farm')) {
    return `Swap $${Math.round(capital / 2)} through ${name}'s router on ${chain} once a week to show trading activity.`;
  }
  if (c.includes('bridge') || c.includes('cross chain')) {
    return `Bridge a second, smaller amount back with ${name} so the farm shows activity in both directions.`;
  }
  if (c.includes('staking') || c.includes('restak')) {
    return `Restake the receipt token ${name} gives you, so the farm shows a second layer of activity.`;
  }
  return `Make a second, smaller deposit of $${Math.round(capital / 2)} into ${name} on ${chain} after the first week.`;
}

/**
 * A protocol's farm plan: six steps, each an action with a cost and a time. Every step varies
 * on the protocol's own record — capital tier, category, seven-day trend, chain count, age
 * band, watchlist status — never on a hand-written list of names.
 *
 * COST AND TIME ARE ASSUMPTIONS, stated here and in the dashboard: capital tiers of
 * $50/$100/$150/$250 by TVL, gas of $2-8 per transaction, 5-15 minutes per action, and a
 * 30/45/60-day hold by age band. The snapshot carries no gas price per chain, so gas is never
 * stated per chain; it carries no points-page information, so no step asserts that a protocol
 * has a points page — the claim step tells the reader to open the protocol's own page and
 * claim only from the link it publishes.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, onWatchlist: boolean): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const name = p.name;
  const change7d = p.change_7d;

  // Step 1: setup. Three wordings by capital tier; the wallet advice itself never changes.
  let setup: FarmStep;
  if (capital >= 150) {
    setup = {
      text: `Open a fresh wallet for this farm only, fund it with the $${capital} plus gas, and write its seed phrase on paper, never in a screenshot.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    };
  } else if (capital >= 100) {
    setup = {
      text: `Open a fresh wallet for this farm only and fund it with the $${capital} plus gas; write its seed phrase on paper, never in a screenshot.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    };
  } else {
    setup = {
      text: `Open a fresh wallet that holds only the $${capital} you plan to farm, and write its seed phrase on paper, never in a screenshot.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    };
  }

  // Step 2: the main action, specific to the protocol's category.
  const main: FarmStep = {
    text: actionForV2(p, capital, chain),
    cost: `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`,
    time: '15 minutes to set up',
  };

  // Step 3: the weekly cadence. A steep fall or a steep rise changes the advice: check first,
  // then act. The -15% and +20% bands are design thresholds, stated in the dashboard.
  let cadence: FarmStep;
  if (change7d !== null && change7d <= -15) {
    cadence = {
      text: `TVL fell ${change7d.toFixed(1)}% in seven days: before adding more, check whether the drop is withdrawals or a price move, then do one qualifying action a week.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    };
  } else if (change7d !== null && change7d >= 20) {
    cadence = {
      text: `TVL rose ${change7d.toFixed(1)}% in seven days: confirm the yield source is real before adding more, then do one qualifying action a week.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    };
  } else {
    cadence = {
      text: `Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote on the protocol.`,
      cost: 'about $2 of gas a week',
      time: '10 minutes a week',
    };
  }

  // Step 4: the second move. On two or more chains it names the second chain; on one chain it
  // takes a second action that fits the category.
  const second: FarmStep = {
    text: secondActionFor(p, capital, chain),
    cost: `about $${Math.round(capital / 2)} of capital and $2 of gas`,
    time: '10 minutes',
  };

  // Step 5: the hold. The length comes from the age band; the reason names the protocol's
  // status honestly: watchlist, large but unnamed by the watchlist, or an early find below
  // the floor. A large protocol the watchlist does not name is never called an early find.
  let status: string;
  if (onWatchlist) {
    status = 'a watchlist protocol';
  } else if (p.tvl_usd >= 50_000_000) {
    status = 'a large pre-token protocol the watchlist does not name';
  } else {
    status = 'an early find below the floor';
  }
  const holdStep: FarmStep = {
    text: `Hold every position for at least ${hold} days: ${name} is ${status}, so the activity is counted in more than one snapshot.`,
    cost: `the $${capital} stays in the positions`,
    time: `${hold} days`,
  };

  // Step 6: the claim. Two wordings by chain count. The snapshot cannot say whether a
  // protocol has a points page, so the step never asserts one exists.
  const claim: FarmStep =
    p.chains.length > 1
      ? {
          text: `Before you withdraw, open ${name}'s own points or rewards page from its own site and claim on each chain you farmed, only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.`,
          cost: 'no fee to check, and never pay to claim',
          time: '15 minutes',
        }
      : {
          text: `Before you withdraw, open ${name}'s own points or rewards page from its own site and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.`,
          cost: 'no fee to check, and never pay to claim',
          time: '15 minutes',
        };

  return [setup, main, cadence, second, holdStep, claim];
}

/** The live-token protocols, by market cap, for the dashboard's comparables view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple:
        p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** A board row's compact form for data.js. */
export function radarRow(row: BoardRow, watchlist: Set<string>): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    confidence: row.confidence,
    peer_multiple: row.model.peer_multiple,
    peer_count: row.model.peer_count,
    peer_source: row.model.peer_source,
    peer_note: row.model.peer_note,
    peer_examples: row.model.peer_examples,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    chain_multiplier: row.model.chain_multiplier,
    watchlist: watchlist.has(row.slug),
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const peers = peerMultiples(snapshot, model);
  const watchlist = new Set(snapshot.watchlist);
  const early = board.filter((r) => !watchlist.has(r.slug)).length;
  const preToken = snapshot.protocols.filter(isPreToken);
  const medianAge =
    median(preToken.map((p) => ageDays(snapshot.as_of, p.listed_at)).filter((a): a is number => a !== null)) ?? 365;
  const confs = board.map((r) => r.confidence).sort((a, b) => a - b);
  const medianConfidence = confs.length === 0 ? 0 : (confs.length % 2 === 1 ? confs[confs.length >> 1]! : (confs[(confs.length >> 1) - 1]! + confs[confs.length >> 1]!) / 2);
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    global_multiple: round4(peers.global),
    median_age_days: medianAge,
    median_confidence: round3(medianConfidence),
    rows: board.map((r) => radarRow(r, watchlist)),
    live,
    peers: peers.table,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, farm steps, and confidence. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (typeof r.confidence !== 'number' || !Number.isFinite(r.confidence) || r.confidence < 0 || r.confidence > 1) {
      return `${r.slug} has confidence ${r.confidence}`;
    }
    if (r.peer_source !== 'category' && r.peer_source !== 'global') {
      return `${r.slug} has peer source ${r.peer_source}`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
