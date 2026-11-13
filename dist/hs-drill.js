/* 商品归类钻取：纯统计模型与独立界面，兼容 file:// 直接打开。 */
(function (root) {
  'use strict';
  const MISSING = '__missing__', INCOMPLETE = '__incomplete__';
  const levels = new Set([2, 4, 6, 8]);
  const clean = value => String(value ?? '').trim();
  const escape = value => clean(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
  const countText = value => Number(value).toLocaleString('zh-CN');
  const special = key => key === MISSING || key === INCOMPLETE;
  function parseCodes(value) {
    const normalized = clean(value).replace(/[０-９]/g, char => String(char.charCodeAt(0) - 65296)).replace(/．/g, '.');
    const tokens = normalized.match(/(?<![\d.])\d{2,10}(?:\.\d{1,10})*(?![\d.])/g) || [];
    return [...new Set(tokens.map(token => token.replace(/^(\d{10})\.0+$/, '$1').replace(/\./g, '')).filter(token => token.length >= 2 && token.length <= 10))];
  }
  function isClassificationCase(item) {
    const pairs = Array.isArray(item.classificationPairs) ? item.classificationPairs.filter(pair => pair && clean(pair.primary)) : [];
    if (pairs.length) return pairs.some(pair => pair.primary === '商品归类' && ['商品编号申报错误', '商品编码申报错误'].includes(pair.secondary));
    const types = Array.isArray(item.types) ? item.types : [item.type];
    return types.includes('商品归类') && /(?:^|[；;])商品(?:编号|编码)申报错误(?:[；;]|$)/.test(clean(item.reason));
  }
  function prefixesFor(item, basis, level) {
    const codes = parseCodes(item[basis === 'actual' ? 'actualCode' : 'declaredCode']);
    if (!codes.length) return [MISSING];
    const prefixes = [...new Set(codes.filter(code => code.length >= level).map(code => code.slice(0, level)))];
    return prefixes.length ? prefixes : [INCOMPLETE];
  }
  function groupLabel(key, level) { return key === MISSING ? '商品编号未披露' : key === INCOMPLETE ? `编号不足${level}位` : key; }
  function searchable(item) {
    return [item.id, item.decisionNo, item.party, item.cargo, item.declaredCode, item.actualCode,
      ...parseCodes(item.declaredCode), ...parseCodes(item.actualCode), item.customs, item.parentCustoms,
      item.facts, item.penaltyResult, item.legalBasis, item.penaltyBasis].map(clean).join(' ').toLowerCase();
  }
  function matchesQuery(item, query) {
    const terms = clean(query).toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return true;
    const text = searchable(item);
    return terms.every(term => text.includes(term) || (/^[\d.．]+$/.test(term) && text.includes(term.replace(/[.．]/g, ''))));
  }
  function representativeProducts(records) {
    const counts = new Map();
    records.forEach(item => {
      const products = [...new Set(clean(item.cargo).split(/[；;、]/).map(clean).filter(value => value && !['品名不详', '无法确定', '未填写'].includes(value)))];
      products.forEach(product => counts.set(product, (counts.get(product) || 0) + 1));
    });
    return [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN')).slice(0, 3).map(([product]) => product);
  }
  function buildView(records, options = {}) {
    const level = levels.has(Number(options.level)) ? Number(options.level) : 8;
    const basis = options.basis === 'actual' ? 'actual' : 'declared';
    // 不能用案件ID去重：历史数据存在同ID但文号、当事人不同的记录。
    const base = [...new Set(records)].filter(isClassificationCase);
    const searched = base.filter(item => matchesQuery(item, options.query));
    const groups = new Map(), prefixes = new Map();
    searched.forEach(item => {
      const keys = prefixesFor(item, basis, level); prefixes.set(item, keys);
      keys.forEach(key => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); });
    });
    const ranking = [...groups].map(([key, items]) => ({ key, count: items.length, items, products: representativeProducts(items), share: searched.length ? items.length / searched.length : 0 }));
    ranking.sort((a, b) => Number(special(a.key)) - Number(special(b.key)) || b.count - a.count || a.key.localeCompare(b.key));
    const order = new Map(ranking.map((group, index) => [group.key, index]));
    const leadingKey = item => prefixes.get(item).slice().sort((a, b) => order.get(a) - order.get(b))[0];
    const selected = clean(options.code);
    const cases = searched.filter(item => !selected || prefixes.get(item).includes(selected));
    cases.sort((a, b) => (order.get(leadingKey(a)) ?? Infinity) - (order.get(leadingKey(b)) ?? Infinity)
      || clean(b.penaltyDate).localeCompare(clean(a.penaltyDate))
      || clean(a.decisionNo).localeCompare(clean(b.decisionNo), 'zh-CN')
      || clean(a.party).localeCompare(clean(b.party), 'zh-CN'));
    return { base, searched, ranking, cases, prefixes, leadingKey, groups, selected, level, basis };
  }
  const model = { parseCodes, prefixesFor, matchesQuery, isClassificationCase, buildView, groupLabel, MISSING, INCOMPLETE };
  let host, config, view, queryTimer, lastFactsButton, layoutObserver;
  const state = { open: false, basis: 'declared', level: 8, query: '', code: '', page: 1, pageSize: 10 };
  const el = id => host?.querySelector(`#${id}`);
  function syncRankingHeight() {
    if (!state.open || !host || host.hidden) return;
    const ranking = el('hs-ranking');
    // 窄屏两栏上下排列，不沿用桌面端同步高度，避免过长的频次榜。
    if (!root.matchMedia('(min-width:1151px)').matches) {
      ranking.style.removeProperty('height');
      return;
    }
    const table = host.querySelector('.hs-table-scroll');
    const height = Math.ceil(table.getBoundingClientRect().bottom - ranking.getBoundingClientRect().top);
    if (height > 0 && ranking.style.height !== `${height}px`) ranking.style.height = `${height}px`;
  }
  function basisLabel() { return state.basis === 'actual' ? '实际商品编号' : '申报商品编号'; }
  function renderRanking() {
    el('hs-ranking-count').textContent = `${view.ranking.filter(group => !special(group.key)).length} 个编码段`;
    el('hs-ranking-subtitle').textContent = `${basisLabel()}前${state.level}位 · 按涉及案件数降序`;
    el('hs-ranking').innerHTML = view.ranking.length ? view.ranking.map((group, index) => `<li><button type="button" class="hs-rank-button ${group.key === state.code ? 'is-selected' : ''}" data-hs-code="${escape(group.key)}" aria-pressed="${group.key === state.code}"><span class="hs-rank-number">${special(group.key) ? '—' : String(index + 1).padStart(2, '0')}</span><span class="hs-rank-main"><span class="hs-code">${escape(groupLabel(group.key, state.level))}</span><span class="hs-products">${escape(group.products.join('；') || '品名未披露')}</span></span><span class="hs-rank-count"><b>${countText(group.count)} 起</b><small>${(group.share * 100).toFixed(1)}%</small></span></button></li>`).join('') : '<li class="hs-empty">当前范围没有匹配的案件。</li>';
  }
  function renderCases() {
    host.dataset.hsPageSize = String(state.pageSize);
    const total = view.cases.length, pages = Math.max(1, Math.ceil(total / state.pageSize));
    state.page = Math.min(Math.max(state.page, 1), pages);
    const start = (state.page - 1) * state.pageSize;
    el('hs-case-count').textContent = `案件清单（共 ${countText(total)} 起）`;
    el('hs-case-body').innerHTML = total ? view.cases.slice(start, start + state.pageSize).map((item, index) => {
      const leading = state.code || view.leadingKey(item), group = view.groups.get(leading);
      const multiple = parseCodes(item.declaredCode).length > 1 || parseCodes(item.actualCode).length > 1;
      return `<tr><td class="hs-frequency-cell"><strong>${escape(groupLabel(leading, state.level))}</strong><small>${countText(group?.length || 0)} 起${(view.prefixes.get(item)?.length || 0) > 1 ? ' · 同案多编码段' : ''}</small></td><td class="hs-date-cell">${escape(item.penaltyDate || '未填写')}</td><td><span class="hs-party">${escape(item.party || '当事人不详')}</span></td><td><span>${escape(item.cargo || '品名不详')}</span>${multiple ? '<small class="hs-multi-note">同案多编码，未强行逐项配对</small>' : ''}</td><td class="hs-raw-code">${escape(item.declaredCode || '未披露')}</td><td class="hs-raw-code">${escape(item.actualCode || '未披露')}</td><td>${escape(item.customs || '未填写')}</td><td class="hs-document">${escape(item.decisionNo || '文号未填写')}</td><td><button type="button" class="hs-facts-button" data-hs-case="${start + index}" aria-haspopup="dialog">查看完整事实</button></td></tr>`;
    }).join('') : '<tr><td colspan="9" class="hs-empty">暂无符合条件的案件。可清除搜索或取消编码筛选。</td></tr>';
    el('hs-page-info').textContent = `第 ${state.page} / ${pages} 页`;
    el('hs-page-range').textContent = total ? `显示 ${start + 1}–${Math.min(start + state.pageSize, total)}，共 ${countText(total)} 起` : '共 0 起';
    el('hs-prev-page').disabled = state.page === 1; el('hs-next-page').disabled = state.page === pages;
    el('hs-selected-code').hidden = !state.code;
    el('hs-selected-label').textContent = state.code ? `已选编码：${groupLabel(state.code, state.level)}` : '';
    el('hs-clear-code').disabled = !state.code;
    syncRankingHeight();
  }
  function render() {
    if (!state.open || !host) return;
    view = buildView(config.getRecords(), state);
    el('hs-scope-label').textContent = `${config.getScopeLabel()} · 商品归类 / 商品编号申报错误`;
    el('hs-count-summary').textContent = `范围内 ${countText(view.base.length)} 起 · 搜索后 ${countText(view.searched.length)} 起 · 当前清单 ${countText(view.cases.length)} 起`;
    el('hs-basis').value = state.basis; el('hs-query').value = state.query; el('hs-page-size').value = String(state.pageSize);
    host.querySelectorAll('[data-hs-level]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.hsLevel) === state.level)));
    renderRanking(); renderCases();
  }
  function runSearch() { root.clearTimeout(queryTimer); state.query = el('hs-query').value; state.page = 1; render(); }
  function money(value) { return value === null || value === undefined || value === '' ? '未填写' : `${Number(value).toLocaleString('zh-CN', { maximumFractionDigits: 2 })} 元`; }
  function showFacts(item, button) {
    const dialog = root.document.getElementById('classification-facts-dialog');
    lastFactsButton = button;
    dialog.querySelector('#hs-facts-title').textContent = item.party || '当事人不详';
    dialog.querySelector('#hs-facts-document').textContent = `${item.decisionNo || '文号未填写'} · 案件ID ${item.id || '未填写'}`;
    const metadata = [['处罚日期', item.penaltyDate], ['处罚海关', item.customs], ['涉案货物', item.cargo || '品名不详'], ['申报商品编号', item.declaredCode || '未披露'], ['实际商品编号', item.actualCode || '未披露'], ['罚款金额', money(item.fine)], ['追缴金额', money(item.recoveryAmount)]];
    dialog.querySelector('#hs-facts-metadata').innerHTML = metadata.map(([label, value]) => `<div><dt>${escape(label)}</dt><dd>${escape(value || '未填写')}</dd></div>`).join('');
    dialog.querySelector('#hs-facts-content').textContent = item.facts || '案例库暂未填写违法事实。';
    dialog.querySelector('#hs-penalty-result').textContent = item.penaltyResult || '案例库暂未填写处罚结果。';
    dialog.querySelector('#hs-legal-basis').textContent = item.legalBasis || '未填写';
    dialog.querySelector('#hs-penalty-basis').textContent = item.penaltyBasis || '未填写';
    dialog.querySelector('#hs-multiple-codes-warning').hidden = !(parseCodes(item.declaredCode).length > 1 || parseCodes(item.actualCode).length > 1);
    if (!dialog.open) dialog.showModal();
  }
  function close() {
    if (!host) return;
    root.clearTimeout(queryTimer); state.open = false; host.hidden = true; config.onToggle?.(false);
    root.document.querySelector('[data-open-hs-drill]')?.focus({ preventScroll: true });
  }
  function open() {
    if (!host) return;
    state.open = true; host.hidden = false; render(); config.onToggle?.(true);
    const reduced = root.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    root.requestAnimationFrame(() => { host.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }); el('hs-query').focus({ preventScroll: true }); });
  }
  function init(options) {
    if (host) return;
    config = options; host = root.document.getElementById('classification-drill');
    if (!host) return;
    // 保持既有图表排版，只把新面板放在TOP5和直属海关分布之间。
    root.document.getElementById('type-chart')?.closest('.chart-section')?.after(host);
    host.addEventListener('click', event => {
      const button = event.target.closest('button'); if (!button) return;
      if (button.id === 'hs-close') return close();
      if (button.dataset.hsLevel) { state.level = Number(button.dataset.hsLevel); state.code = ''; state.page = 1; render(); }
      else if (button.hasAttribute('data-hs-code')) { state.code = state.code === button.dataset.hsCode ? '' : button.dataset.hsCode; state.page = 1; render(); }
      else if (button.hasAttribute('data-hs-case')) { const item = view.cases[Number(button.dataset.hsCase)]; if (item) showFacts(item, button); }
      else if (button.id === 'hs-clear-code') { state.code = ''; state.page = 1; render(); }
      else if (button.id === 'hs-reset') { root.clearTimeout(queryTimer); Object.assign(state, { basis: 'declared', level: 8, query: '', code: '', page: 1 }); render(); }
      else if (button.id === 'hs-clear-search') { root.clearTimeout(queryTimer); state.query = ''; state.page = 1; render(); el('hs-query').focus(); }
      else if (button.id === 'hs-prev-page') { state.page -= 1; renderCases(); }
      else if (button.id === 'hs-next-page') { state.page += 1; renderCases(); }
    });
    el('hs-search-form').addEventListener('submit', event => { event.preventDefault(); runSearch(); });
    el('hs-query').addEventListener('input', () => { root.clearTimeout(queryTimer); queryTimer = root.setTimeout(runSearch, 180); });
    el('hs-basis').addEventListener('change', event => { state.basis = event.target.value; state.code = ''; state.page = 1; render(); });
    el('hs-page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderCases(); });
    // 只观察右栏，左榜高度变化不会反过来触发循环或滚动闪烁。
    if (root.ResizeObserver) {
      layoutObserver = new root.ResizeObserver(syncRankingHeight);
      layoutObserver.observe(host.querySelector('.hs-cases-panel'));
    }
    root.addEventListener('resize', syncRankingHeight, { passive: true });
    const dialog = root.document.getElementById('classification-facts-dialog');
    root.document.getElementById('hs-close-facts').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { if (lastFactsButton?.isConnected) lastFactsButton.focus({ preventScroll: true }); });
  }
  root.CustomsClassificationDrill = { init, open, close, update: render, isOpen: () => state.open, model };
})(typeof window !== 'undefined' ? window : globalThis);
