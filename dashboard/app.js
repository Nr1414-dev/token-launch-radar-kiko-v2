// Token Radar v3: renders the ranked board, a filterable table, a per-protocol detail view with
// the model's own inputs, its confidence and its farm plan, the live-token comparables the model
// is priced from, and the peer-multiple table the model runs on. No network: every byte it shows
// is in data.js, loaded beside this page.
//
// Version 3 changes, against version 2:
//   - each row's peer multiple is its category median SHRUNK toward the global multiple (k=3),
//     guarded so a raw category median outside 0.05-2.00x carries no signal and the row keeps
//     the global multiple instead;
//   - each row carries a CONFIDENCE score (0-1) shown beside its price; confidence never
//     changes a rank or an implied value;
//   - the detail view names the multiple's source, the peer count and the confidence, with the
//     reason in plain words;
//   - the farm plan varies by capital tier, category, seven-day trend, chain count, age band
//     and watchlist status (same rules as lib/model.ts, so the page and the board never disagree).
// Cost and time figures in the farm plans are stated ASSUMPTIONS (capital tiers by TVL, gas
// $2-8 per transaction, 5-15 minutes per action), not snapshot data: the snapshot carries no
// gas price per chain and no points-page information, so no step claims either.
(function () {
  'use strict';
  var DATA = window.RADAR;
  var PAGE_SIZE = 25;
  var state = { q: '', cat: 'all', chain: 'all', watch: false, minTvl: 0, tab: 'pre', sort: 'implied', dir: -1, detail: null, page: 0 };

  // ---------- formatting ----------
  function fmtUsd(n) {
    if (n === null || n === undefined) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined) return 'n/a';
    return (n >= 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function fmtMult(n) { return n.toFixed(3) + '×'; }
  function fmtConf(n) {
    if (n === null || n === undefined) return '—';
    return n.toFixed(2);
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  // ---------- farm plan v3 (same rules as lib/model.ts, so page and board agree) ----------
  // Cost/time basis: capital tiers $50/$100/$150/$250 by TVL; gas $2-8 per transaction;
  // 5-15 minutes per action; hold 30/45/60 days by age band. These are ASSUMPTIONS, not
  // snapshot data. Chain-specific gas is not in the snapshot and is never claimed.
  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(p) {
    if (p.tvl_usd >= 5000000000) return 250;
    if (p.tvl_usd >= 1000000000) return 150;
    if (p.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 45;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  var ACTION_V2 = {
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
    'Interest Rate Derivatives': 'Take a ${cap} rates position on {name} on {chain} that settles inside your hold.'
  };
  function actionFor(p, capital, chain) {
    var tpl = ACTION_V2[p.category || 'Other'];
    if (tpl === undefined) return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open for the full hold.';
    return tpl.split('${cap}').join('$' + capital).split('{name}').join(p.name).split('{chain}').join(chain);
  }
  function secondActionFor(p, capital) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (p.chains.length > 1) return 'Repeat the same position on ' + p.chains[1] + ' with half the capital, so the farm is counted on two chains.';
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('collateral') >= 0) return 'Borrow up to half of your deposit from ' + name + ' on ' + chainOf(p) + ' and use the borrowed funds in a second pool.';
    if (c.indexOf('dex') >= 0 || c.indexOf('leveraged farm') >= 0) return 'Swap $' + Math.round(capital / 2) + ' through ' + name + '\'s router on ' + chainOf(p) + ' once a week to show trading activity.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0) return 'Bridge a second, smaller amount back with ' + name + ' so the farm shows activity in both directions.';
    if (c.indexOf('staking') >= 0 || c.indexOf('restak') >= 0) return 'Restake the receipt token ' + name + ' gives you, so the farm shows a second layer of activity.';
    return 'Make a second, smaller deposit of $' + Math.round(capital / 2) + ' into ' + name + ' on ' + chainOf(p) + ' after the first week.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\'s own page.';
    return s;
  }
  function farmSteps(p) {
    var chain = chainOf(p);
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    var change7d = p.change_7d;
    var setup;
    if (capital >= 150) setup = { text: 'Open a fresh wallet for this farm only, fund it with the $' + capital + ' plus gas, and write its seed phrase on paper, never in a screenshot.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' };
    else if (capital >= 100) setup = { text: 'Open a fresh wallet for this farm only and fund it with the $' + capital + ' plus gas; write its seed phrase on paper, never in a screenshot.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' };
    else setup = { text: 'Open a fresh wallet that holds only the $' + capital + ' you plan to farm, and write its seed phrase on paper, never in a screenshot.', cost: 'under $3 of gas for the first transaction', time: '5 minutes' };
    var main = { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital and about $' + (capital >= 150 ? 8 : 4) + ' of gas', time: '15 minutes to set up' };
    var cadence;
    if (change7d !== null && change7d !== undefined && change7d <= -15) cadence = { text: 'TVL fell ' + change7d.toFixed(1) + '% in seven days: before adding more, check whether the drop is withdrawals or a price move, then do one qualifying action a week.', cost: 'about $2 of gas a week', time: '10 minutes a week' };
    else if (change7d !== null && change7d !== undefined && change7d >= 20) cadence = { text: 'TVL rose ' + change7d.toFixed(1) + '% in seven days: confirm the yield source is real before adding more, then do one qualifying action a week.', cost: 'about $2 of gas a week', time: '10 minutes a week' };
    else cadence = { text: 'Do one qualifying action every week, such as a deposit, a borrow, a swap or a vote on the protocol.', cost: 'about $2 of gas a week', time: '10 minutes a week' };
    var second = { text: secondActionFor(p, capital), cost: 'about $' + Math.round(capital / 2) + ' of capital and $2 of gas', time: '10 minutes' };
    var status;
    if (p.watchlist) status = 'a watchlist protocol';
    else if (p.tvl_usd >= 50000000) status = 'a large pre-token protocol the watchlist does not name';
    else status = 'an early find below the floor';
    var holdStep = { text: 'Hold every position for at least ' + hold + ' days: ' + p.name + ' is ' + status + ', so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the positions', time: hold + ' days' };
    var claim;
    if (p.chains.length > 1) claim = { text: 'Before you withdraw, open ' + p.name + '\'s own points or rewards page from its own site and claim on each chain you farmed, only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' };
    else claim = { text: 'Before you withdraw, open ' + p.name + '\'s own points or rewards page from its own site and claim only from the link it publishes, then write the wallet, the dates and every transaction in a farm log.', cost: 'no fee to check, and never pay to claim', time: '15 minutes' };
    return [setup, main, cadence, second, holdStep, claim].map(stepText);
  }
  // Exposed so a test can prove the page's plans match board.json step for step.
  window.__farm = { farmSteps: farmSteps, stepText: stepText };

  // ---------- tiny DOM helpers ----------
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        var v = attrs[k];
        if (v === null || v === undefined || v === false) return;
        if (k === 'text') node.textContent = v;
        else if (k === 'html') node.innerHTML = v;
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), v);
        else if (k === 'class') node.className = v;
        else node.setAttribute(k, v);
      });
    }
    if (children) {
      if (!Array.isArray(children)) children = [children];
      children.forEach(function (c) {
        if (c === null || c === undefined || c === false) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  // ---------- hash state ----------
  // A hash change replaces the whole state: a filter the new hash does not name is off, not
  // carried over from the hash before it (a stale detail stayed open on back/forward until this).
  function readHash() {
    state = { q: '', cat: 'all', chain: 'all', watch: false, minTvl: 0, tab: 'pre', sort: 'implied', dir: -1, detail: null, page: 0 };
    var h = location.hash.replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = kv[0], v = decodeURIComponent(kv[1] || '');
      if (k === 'q') state.q = v;
      else if (k === 'cat') state.cat = v;
      else if (k === 'chain') state.chain = v;
      else if (k === 'watch') state.watch = v === '1';
      else if (k === 'min') state.minTvl = parseInt(v, 10) || 0;
      else if (k === 'tab') state.tab = v === 'live' ? 'live' : 'pre';
      else if (k === 'sort') state.sort = v;
      else if (k === 'dir') state.dir = v === '1' ? 1 : -1;
      else if (k === 'detail') state.detail = v || null;
      else if (k === 'page') state.page = Math.max(0, parseInt(v, 10) || 0);
    });
  }
  function writeHash() {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat !== 'all') parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain !== 'all') parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.watch) parts.push('watch=1');
    if (state.minTvl) parts.push('min=' + state.minTvl);
    if (state.tab === 'live') parts.push('tab=live');
    if (state.sort !== 'implied') parts.push('sort=' + state.sort);
    if (state.dir === 1) parts.push('dir=1');
    if (state.detail) parts.push('detail=' + encodeURIComponent(state.detail));
    if (state.page) parts.push('page=' + state.page);
    history.replaceState(null, '', parts.length ? '#' + parts.join('&') : location.pathname + location.search);
  }

  // ---------- rows ----------
  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat !== 'all' && (r.category || 'Other') !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (r.tvl_usd < state.minTvl) return false;
      if (q) {
        var hay = (r.name + ' ' + (r.category || '') + ' ' + r.chains.join(' ') + ' ' + r.slug).toLowerCase();
        if (hay.indexOf(q) < 0) return false;
      }
      return true;
    });
  }
  function sortedRows(list) {
    var key = state.sort, dir = state.dir;
    return list.slice().sort(function (a, b) {
      var d = 0;
      if (key === 'name') d = a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      else if (key === 'cat') d = (a.category || 'Other') < (b.category || 'Other') ? -1 : (a.category || 'Other') > (b.category || 'Other') ? 1 : 0;
      else if (key === 'tvl') d = a.tvl_usd - b.tvl_usd;
      else if (key === 'change') d = (a.change_7d || 0) - (b.change_7d || 0);
      else if (key === 'age') d = (a.age_days || 0) - (b.age_days || 0);
      else if (key === 'peer') d = a.peer_multiple - b.peer_multiple;
      else if (key === 'conf') d = a.confidence - b.confidence;
      else d = a.implied_value_usd - b.implied_value_usd;
      if (d === 0) d = a.slug < b.slug ? -1 : 1;
      return d * dir;
    });
  }
  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  // ---------- sections ----------
  function header() {
    return el('header', null, [
      el('div', { class: 'topbar' }, [
        el('div', { class: 'brand' }, [
          el('span', { class: 'mark', 'aria-hidden': 'true' }),
          el('h1', null, ['Token ', el('em', { text: 'Radar' })])
        ]),
        el('span', { class: 'tagline', text: 'Pre-token protocols, ranked by what their token would be worth' }),
        el('div', { class: 'top-meta' }, [
          el('span', null, ['Snapshot ', el('b', { text: DATA.as_of })]),
          el('span', null, ['Model ', el('b', { text: DATA.model_version })]),
          el('span', null, ['Source ', el('b', { text: 'DefiLlama public API' })])
        ])
      ]),
      el('p', { class: 'lede' }, [
        'Every protocol below ', el('b', { text: 'records no token' }),
        ' — the radar says what a token would be worth if the protocol\'s record stayed as it is, and how to farm it before or after one is issued. The value is a ',
        el('b', { text: 'comparables' }),
        ' price: each protocol\'s TVL times a peer multiple — its category median shrunk toward the global multiple (k=3), guarded so a category median outside 0.05–2.00× carries no signal — adjusted for seven-day growth, age and how many chains it runs on. Each row also carries a ',
        el('b', { text: 'confidence' }),
        ' score (0–1) for how much snapshot data supports its price; confidence never changes a rank. It never predicts whether or when a token is issued.'
      ]),
      el('div', { class: 'facts' }, [
        el('div', { class: 'fact' }, [el('span', { text: 'Protocols ranked' }), el('b', { text: String(DATA.board_size) })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Watchlist covered' }), el('b', { text: DATA.watchlist_size + ' / ' + DATA.watchlist_size }), el('small', { text: 'every watchlist protocol is on the board' })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Early finds below the floor' }), el('b', { text: String(DATA.early_size) })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Live-token set aside' }), el('b', { text: String(DATA.live_size) }), el('small', { text: 'shown as the market\'s own values' })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Global peer multiple' }), el('b', { text: fmtMult(DATA.global_multiple) }), el('small', { text: 'median mcap / TVL of live protocols' })]),
        el('div', { class: 'fact' }, [el('span', { text: 'Median confidence' }), el('b', { text: fmtConf(DATA.median_confidence) }), el('small', { text: '0–1, display only, never a rank' })])
      ])
    ]);
  }

  function controls() {
    var cats = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; state.page = 0; writeHash(); render(); });
    var catSel = el('select', { id: 'cat', 'aria-label': 'Category' }, [el('option', { value: 'all', text: 'All categories' })].concat(cats.map(function (c) {
      return el('option', { value: c, text: c, selected: c === state.cat ? 'selected' : null });
    })));
    catSel.addEventListener('change', function () { state.cat = catSel.value; state.page = 0; writeHash(); render(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Chain' }, [el('option', { value: 'all', text: 'All chains' })].concat(chains.map(function (c) {
      return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null });
    })));
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; state.page = 0; writeHash(); render(); });
    var minSel = el('select', { id: 'min', 'aria-label': 'Minimum TVL' }, [
      el('option', { value: '0', text: 'Any TVL' }),
      el('option', { value: '50000000', text: 'TVL $50M+' }),
      el('option', { value: '100000000', text: 'TVL $100M+' }),
      el('option', { value: '500000000', text: 'TVL $500M+' }),
      el('option', { value: '1000000000', text: 'TVL $1B+' })
    ]);
    minSel.value = String(state.minTvl);
    minSel.addEventListener('change', function () { state.minTvl = parseInt(minSel.value, 10) || 0; state.page = 0; writeHash(); render(); });
    var watchBox = el('input', { type: 'checkbox', id: 'watch', checked: state.watch ? 'checked' : null });
    watchBox.addEventListener('change', function () { state.watch = watchBox.checked; state.page = 0; writeHash(); render(); });
    var preTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'pre' ? 'true' : 'false', text: 'Pre-token board', onclick: function () { state.tab = 'pre'; state.page = 0; writeHash(); render(); } });
    var liveTab = el('button', { type: 'button', 'aria-pressed': state.tab === 'live' ? 'true' : 'false', text: 'Live-token comparables', onclick: function () { state.tab = 'live'; state.page = 0; writeHash(); render(); } });
    var shown = state.tab === 'pre' ? filteredRows().length + ' rows shown' : DATA.live.length + ' live-token protocols';
    return el('div', { class: 'controls' }, [
      el('div', { class: 'field' }, [el('span', { text: 'Search' }), search]),
      el('div', { class: 'field' }, [el('span', { text: 'Category' }), catSel]),
      el('div', { class: 'field' }, [el('span', { text: 'Chain' }), chainSel]),
      el('div', { class: 'field' }, [el('span', { text: 'Minimum TVL' }), minSel]),
      el('label', { class: 'check', for: 'watch' }, [watchBox, 'Watchlist only']),
      el('div', { class: 'field' }, [el('span', { text: 'View' }), el('div', { class: 'tabs' }, [preTab, liveTab])]),
      el('span', { class: 'count', text: shown })
    ]);
  }

  function sortHeader(key, label, cls) {
    var arrow = state.sort === key ? (state.dir < 0 ? ' ▼' : ' ▲') : '';
    return el('th', { class: cls || null }, el('button', {
      type: 'button',
      onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = key === 'name' ? 1 : -1; } writeHash(); render(); }
    }, label + arrow));
  }

  function boardTable() {
    var list = sortedRows(filteredRows());
    var pages = Math.max(1, Math.ceil(list.length / PAGE_SIZE));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PAGE_SIZE, state.page * PAGE_SIZE + PAGE_SIZE);
    var body;
    if (slice.length === 0) {
      body = el('div', { class: 'empty' }, [
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Loosen the search, the category or the TVL floor.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.cat = 'all'; state.chain = 'all'; state.watch = false; state.minTvl = 0; state.page = 0; writeHash(); render(); } })
      ]);
    } else {
      var rows = slice.map(function (r) {
        return el('tr', {
          'data-selected': state.detail === r.slug ? 'true' : null,
          tabindex: '0',
          onclick: function () { openDetail(r.slug); },
          onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
        }, [
          el('td', { class: 'rank', text: '#' + r.rank }),
          el('td', { class: 'name' }, [el('b', { text: r.name }), r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null, el('span', { text: r.slug })]),
          el('td', { text: r.category || 'Other' }),
          el('td', { text: r.chains.slice(0, 2).join(', ') + (r.chains.length > 2 ? ' +' + (r.chains.length - 2) : '') }),
          el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
          el('td', { class: 'num ' + ((r.change_7d || 0) >= 0 ? 'up' : 'down'), text: fmtPct(r.change_7d) }),
          el('td', { class: 'num', text: fmtAge(r.age_days) }),
          el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
          el('td', { class: 'num conf', text: fmtConf(r.confidence) }),
          el('td', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ]);
      });
      body = el('div', { class: 'tablewrap' }, el('table', null, [
        el('thead', null, el('tr', null, [
          sortHeader('implied', 'Rank'),
          sortHeader('name', 'Protocol'),
          sortHeader('cat', 'Category'),
          el('th', { text: 'Chains' }),
          sortHeader('tvl', 'TVL', 'num'),
          sortHeader('change', '7d', 'num'),
          sortHeader('age', 'Age', 'num'),
          sortHeader('peer', 'Peer ×', 'num'),
          sortHeader('conf', 'Conf.', 'num'),
          sortHeader('implied', 'Implied', 'num')
        ])),
        el('tbody', null, rows)
      ]));
    }
    var pager = el('div', { class: 'pager' }, [
      el('span', { text: list.length === 0 ? '0 rows' : 'Showing ' + (state.page * PAGE_SIZE + 1) + '–' + Math.min(list.length, (state.page + 1) * PAGE_SIZE) + ' of ' + list.length }),
      el('button', { class: 'button', type: 'button', text: '← Prev', disabled: state.page === 0 ? 'disabled' : null, onclick: function () { state.page--; writeHash(); render(); } }),
      el('span', { text: 'Page ' + (state.page + 1) + ' / ' + pages }),
      el('button', { class: 'button', type: 'button', text: 'Next →', disabled: state.page >= pages - 1 ? 'disabled' : null, onclick: function () { state.page++; writeHash(); render(); } })
    ]);
    return el('section', { class: 'panel', id: 'board', 'aria-label': 'Ranked board' }, [
      el('h2', { text: 'The board — pre-token protocols by implied value' }),
      el('p', { class: 'sub', text: 'Click a row for its model breakdown and farm plan. Rank 1 is the board\'s most valuable protocol. Confidence is display only: it never changes a rank.' }),
      body, pager
    ]);
  }

  function liveTable() {
    var rows = DATA.live.map(function (r) {
      return el('tr', null, [
        el('td', { class: 'name' }, [el('b', { text: r.name }), el('span', { text: r.slug })]),
        el('td', { text: r.category || 'Other' }),
        el('td', { text: r.chains.slice(0, 3).join(', ') }),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.multiple === null ? '—' : fmtMult(r.multiple) })
      ]);
    });
    return el('section', { class: 'panel', id: 'board', 'aria-label': 'Live-token comparables' }, [
      el('h2', { text: 'Live-token comparables — where the multiples come from' }),
      el('p', { class: 'sub', text: 'These protocols already trade, so the board shows the market\'s own value for them. Their market-cap-to-TVL multiples are the peer multiples the pre-token board is priced from, by category.' }),
      el('div', { class: 'tablewrap' }, el('table', null, [
        el('thead', null, el('tr', null, [
          el('th', { text: 'Protocol' }), el('th', { text: 'Category' }), el('th', { text: 'Chains' }),
          el('th', { class: 'num', text: 'TVL' }), el('th', { class: 'num', text: 'Market cap' }), el('th', { class: 'num', text: 'Multiple' })
        ])),
        el('tbody', null, rows)
      ]))
    ]);
  }

  function openDetail(slug) {
    state.detail = slug;
    writeHash();
    render();
    var d = document.getElementById('detail');
    if (d) d.scrollIntoView({ block: 'start' });
  }

  function detailPanel() {
    if (!state.detail) return null;
    var r = findRow(state.detail);
    if (!r) return null;
    var steps = farmSteps(r);
    // Named peers come from the row itself: they are drawn from the FULL live set, not
    // from the dashboard's displayed top-24 comparables, so a category's only peer
    // (e.g. Api3 for Risk Curators) is named here even when it is not in that top 24.
    var peerNote = (r.peer_examples && r.peer_examples.length > 0)
      ? r.peer_examples.join(', ')
      : 'No live-token peer in this category — the board used the global multiple ' + fmtMult(DATA.global_multiple) + '.';
    var stepItems = steps.map(function (s) {
      var html = esc(s).replace(/Cost:/g, '<b>Cost:</b>').replace(/Time:/g, '<b>Time:</b>');
      return el('li', { html: html });
    });
    return el('section', { class: 'panel detail', id: 'detail', 'aria-label': 'Protocol detail' }, [
      el('h2', null, ['#' + r.rank + ' — ' + r.name, r.watchlist ? el('span', { class: 'badge', text: 'WATCHLIST' }) : null]),
      el('p', { class: 'sub', text: (r.category || 'Other') + ' · ' + r.chains.join(', ') + ' · listed ' + (r.listed_at || 'date unknown') + ' · records no token' }),
      el('div', { class: 'detail-grid' }, [
        el('div', null, [
          el('h3', { text: 'Implied value — how the model prices it' }),
          el('dl', { class: 'kv' }, [
            el('dt', { text: 'TVL' }), el('dd', { text: fmtUsd(r.tvl_usd) }),
            el('dt', { text: 'Peer multiple' }), el('dd', { text: fmtMult(r.peer_multiple) + ' (' + r.peer_count + (r.peer_count === 1 ? ' peer, ' : ' peers, ') + r.peer_source + ')' }),
            el('dt', { text: 'Multiple source' }), el('dd', { class: 'note', text: r.peer_note }),
            el('dt', { text: 'Confidence' }), el('dd', { text: r.confidence.toFixed(3) + ' (display only — never a rank)' }),
            el('dt', { text: '7-day change' }), el('dd', { text: fmtPct(r.change_7d) + ' → growth ' + r.growth_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Age' }), el('dd', { text: fmtAge(r.age_days) + ' → maturity ' + r.maturity_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Chains' }), el('dd', { text: r.chains.length + ' → ' + r.chain_multiplier.toFixed(3) + '×' }),
            el('dt', { text: 'Implied value' }), el('dd', { text: fmtUsd(r.implied_value_usd) }),
            el('dt', { text: 'Live peers' }), el('dd', { class: 'note', text: peerNote })
          ]),
          el('h3', { text: 'The formula' }),
          el('pre', { class: 'formula', text: 'peer multiple = (n × category median + 3 × global) / (n + 3)\n  guarded: a category median outside 0.05–2.00× carries no\n  signal, and the row keeps the global multiple instead\nimplied = TVL × peer multiple\n  × (1 + 0.6 × clamp(7d change, −50%, +100%) / 100)\n  × (0.7 + 0.3 × min(age, 1095d) / 1095)\n  × (1 + 0.03 × min(chains − 1, 4))\nconfidence = 0.5 × n/(n+3) + 0.3 × data known + 0.2 × min(TVL/$50M, 1)\n  display only: it never changes a rank or an implied value' })
        ]),
        el('div', null, [
          el('h3', { text: 'Farm plan — six steps, with cost and time' }),
          el('ol', { class: 'steps' }, stepItems),
          el('p', { class: 'note', text: 'The plan is the radar\'s own: it never predicts whether or when a token is issued, and a protocol that records no token may still have one its DefiLlama record does not carry. Costs and times are stated assumptions (capital tiers by TVL, gas $2–8 per transaction, 5–15 minutes per action), not snapshot data — the snapshot carries no gas price per chain and no points-page information.' })
        ])
      ])
    ]);
  }

  function modelPanel() {
    var rows = DATA.peers.map(function (p) {
      return el('tr', null, [
        el('td', { text: p.category }),
        el('td', { class: 'num', text: String(p.peers) }),
        el('td', { class: 'num', text: p.raw_median === null ? '—' : fmtMult(p.raw_median) }),
        el('td', { class: 'num', text: fmtMult(p.used_multiple) }),
        el('td', { text: p.source === 'category' ? 'Category median, shrunk toward global (k=3)' : 'Global multiple (guard or no peers)' })
      ]);
    });
    return el('section', { class: 'panel', 'aria-label': 'How the model works' }, [
      el('h2', { text: 'How the model works' }),
      el('p', { class: 'sub', text: 'Every multiple below is the median market-cap-to-TVL ratio of the live-token protocols in that category, read from this same snapshot. A category median is shrunk toward the global multiple of ' + fmtMult(DATA.global_multiple) + ' with k=3: (n × median + 3 × global) / (n + 3). A raw median outside 0.05×–2.00× is treated as an artefact of one or two extreme peers, not a price — those categories keep the global multiple. Multiples are clamped to 0.05×–2.00×. Unknown ages take the pre-token median age of ' + DATA.median_age_days + ' days.' }),
      el('p', { class: 'sub', text: 'Confidence (0–1) = 0.5 × peers/(peers+3) + 0.3 × data known + 0.2 × min(TVL/$50M, 1). The weights are a design choice, stated here, not derived from the data — and confidence never changes a rank. Farm costs and times are stated assumptions, not snapshot data: the snapshot has no gas price per chain and no points-page information, so no step claims either.' }),
      el('div', { class: 'tablewrap peers' }, el('table', null, [
        el('thead', null, el('tr', null, [
          el('th', { text: 'Category' }), el('th', { class: 'num', text: 'Live peers' }),
          el('th', { class: 'num', text: 'Raw median' }), el('th', { class: 'num', text: 'Multiple used' }), el('th', { text: 'Source' })
        ])),
        el('tbody', null, rows)
      ]))
    ]);
  }

  function footer() {
    return el('footer', { class: 'foot' }, [
      el('p', null, [
        el('b', { text: 'What the radar does not say. ' }),
        'A protocol on this board records no token in the snapshot; that is DefiLlama\'s record, not proof it has none. The implied value is the radar\'s own claim, never make.fun\'s, and it says nothing about whether or when a token is issued. Farm at your own risk, with money you can afford to lose, and claim only from a protocol\'s own page.'
      ]),
      el('p', { text: 'Snapshot ' + DATA.as_of + ' · ' + DATA.rows.length + ' pre-token protocols ranked · ' + DATA.live.length + ' live-token protocols set aside · Model ' + DATA.model_version })
    ]);
  }

  function render() {
    var app = document.getElementById('app');
    if (!app || !DATA) return;
    app.innerHTML = '';
    var wrap = el('div', { class: 'wrap' }, [
      header(), controls(),
      state.tab === 'pre' ? boardTable() : liveTable(),
      detailPanel(), modelPanel(), footer()
    ]);
    app.appendChild(wrap);
    app.setAttribute('aria-busy', 'false');
    window.__ready = true;
  }

  readHash();
  if (typeof document !== 'undefined' && DATA) {
    render();
    // A deep link to a protocol (…#detail=<slug>) lands on its detail panel, not on the
    // top of the board: the panel is rendered below the table, so scroll to it once on load.
    var firstDetail = document.getElementById('detail');
    if (firstDetail) firstDetail.scrollIntoView({ block: 'start' });
    window.addEventListener('hashchange', function () { readHash(); render(); });
  }
})();
