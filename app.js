const state = {
  cases: [], dashboardRecords: [], dataVersion: '', activeView: 'dashboard', activeSignal: '', activeRiskType: '', activeRiskSecondary: '', activeRiskItem: '', activeRiskProduct: '', activeChartType: '', activeCustoms: '', activePenaltyCustoms: '', majorCasesExpanded: false, charts: {},
  dashboardFilters: { start: '', end: '', query: '' },
  detailFilters: { start: '', end: '', scope: 'all', customs: '', type: '', query: '' },
  drillQuery: '',
  customsQuery: '',
  sort: { field: 'penaltyDate', direction: 'desc' }, page: 1, pageSize: 20
};
const detailFields = {
  start: document.getElementById('detail-start-date'), end: document.getElementById('detail-end-date'),
  scope: document.getElementById('detail-scope-filter'), customs: document.getElementById('detail-customs-filter'),
  type: document.getElementById('detail-type-filter'), query: document.getElementById('detail-query-filter')
};
const status = document.getElementById('data-status');
const dialog = document.getElementById('facts-dialog');
const themeStorageKey = 'customs-dashboard-theme';
const supportedThemes = new Set(['navy', 'graphite', 'emerald']);
function applyTheme(theme, rerender = true) {
  const selected = supportedThemes.has(theme) ? theme : 'navy';
  document.documentElement.dataset.theme = selected;
  const selector = document.getElementById('theme-select');
  if (selector) selector.value = selected;
  try { localStorage.setItem(themeStorageKey, selected); } catch { /* 本地直开或隐私模式下可能不可用 */ }
  if (rerender && state.charts.type) renderDashboard();
}
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const clean = value => String(value ?? '').trim();
const wan = value => Number.isFinite(value) ? (value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
const rate = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%` : '—';
const multipleOf = value => Number.isFinite(value) ? `${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}倍` : '—';
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
const typesOf = item => Array.isArray(item.types) && item.types.length ? item.types : [item.type || '未分类'];
const isVisibleCase = item => { const pairs = (Array.isArray(item.classificationPairs) ? item.classificationPairs : []).filter(pair => clean(pair?.primary)); return pairs.length ? !pairs.some(pair => clean(pair.primary) === '收缴清单') : !typesOf(item).includes('收缴清单'); };
const caseDate = item => /^\d{4}-\d{2}-\d{2}$/.test(item.penaltyDate || '') ? new Date(`${item.penaltyDate}T00:00:00`) : null;
function setOptions(select, values, placeholder) { const saved = select.value; select.innerHTML = `<option value="">${placeholder}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`; select.value = Array.from(select.options).some(option => option.value === saved) ? saved : ''; }
function countBy(records, key) { return records.reduce((map, item) => { const name = item[key] || '未分类'; map.set(name, (map.get(name) || 0) + 1); return map; }, new Map()); }
function countByType(records) { const map = new Map(); records.forEach(item => typesOf(item).forEach(type => map.set(type, (map.get(type) || 0) + 1))); return map; }
const secondaryAliases = new Map([['商品编码申报错误', '商品编号申报错误']]);
function classificationPairsOf(item) {
  const savedPairs = Array.isArray(item.classificationPairs) ? item.classificationPairs : [];
  const pairs = savedPairs.map(pair => ({
    primary: clean(pair?.primary),
    secondary: secondaryAliases.get(clean(pair?.secondary)) || clean(pair?.secondary)
  })).filter(pair => pair.primary && pair.secondary);
  if (pairs.length) return pairs;
  const types = typesOf(item).filter(type => type && type !== '未分类');
  const actions = clean(item.reason || '').split(/[；;]/).map(action => secondaryAliases.get(clean(action)) || clean(action)).filter(Boolean);
  if (types.length === actions.length && types.length) return types.map((primary, index) => ({ primary, secondary: actions[index] }));
  return types.map(primary => ({ primary, secondary: '' }));
}
function secondaryActions(item, primary = '') {
  const actions = classificationPairsOf(item).filter(pair => !primary || pair.primary === primary).map(pair => pair.secondary).filter(Boolean);
  return [...new Set(actions)];
}
function countBySecondary(records, primary = '') {
  const map = new Map();
  records.forEach(item => secondaryActions(item, primary).forEach(action => map.set(action, (map.get(action) || 0) + 1)));
  return map;
}
function countBySecondaryItem(records) { return countBy(records, 'secondaryItem'); }
function topEntries(map, limit = 5) { return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-CN')).slice(0, limit); }
function latestRecognizedDateKey(records) {
  const dates = records.flatMap(item => [...clean(item.recognizedFiles || '').matchAll(/_(\d{8})_/g)].map(match => match[1])).filter(value => {
    const month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Number(value.slice(0, 4)), month, 0).getDate();
  }).sort();
  return dates.length ? `${dates.at(-1).slice(0, 4)}-${dates.at(-1).slice(4, 6)}-${dates.at(-1).slice(6, 8)}` : '';
}
function dashboardReferenceEnd(records) {
  const selectedEnd = clean(state.dashboardFilters.end);
  if (selectedEnd) return selectedEnd;
  return latestRecognizedDateKey(records) || records.map(item => clean(item.penaltyDate)).filter(Boolean).sort().at(-1) || '';
}
function formatDateZh(value) {
  if (!value) return '—';
  const [year, month, day] = value.split('-');
  return `${year}年${Number(month)}月${Number(day)}日`;
}
function dashboardCases() { const { start, end, query } = state.dashboardFilters; const q = query.toLowerCase(); return state.cases.filter(item => { const date = item.penaltyDate || ''; return (!start || date >= start) && (!end || date <= end) && (!q || clean(item.searchText).toLowerCase().includes(q)); }); }
function signalRecords(id) { const records = state.dashboardRecords; if (id === 'company') return records.filter(item => item.companyProduct); if (id === 'peer') return records.filter(item => item.peerCompany); return records; }
function detailCases() { const f = state.detailFilters; return state.cases.filter(item => { const date = item.penaltyDate || ''; return (!f.start || date >= f.start) && (!f.end || date <= f.end) && (f.scope === 'all' || item.companyProduct) && (!f.customs || item.parentCustoms === f.customs) && (!f.type || typesOf(item).includes(f.type)) && (!f.query || clean(item.searchText).toLowerCase().includes(f.query.toLowerCase())); }); }

function datedRecords(records, monthsAgoStart, monthsAgoEnd = 0) {
  const dates = records.map(caseDate).filter(Boolean); if (!dates.length) return [];
  const latest = new Date(Math.max(...dates)); const end = new Date(latest); end.setMonth(end.getMonth() - monthsAgoEnd); const start = new Date(latest); start.setMonth(start.getMonth() - monthsAgoStart);
  return records.filter(item => { const date = caseDate(item); return date && date > start && date <= end; });
}
function heatByType(records) {
  const recent = datedRecords(records, 3), prior = datedRecords(records, 6, 3), allTypes = unique([...recent.flatMap(typesOf), ...prior.flatMap(typesOf)]);
  return allTypes.map(type => { const now = recent.filter(item => typesOf(item).includes(type)).length, before = prior.filter(item => typesOf(item).includes(type)).length; return { type, now, before, delta: now - before }; }).sort((a, b) => b.delta - a.delta || b.now - a.now);
}
function penaltyTotal(item) { return item.penaltyAmount ?? ((item.fine == null && item.recoveryAmount == null) ? null : (Number(item.fine) || 0) + (Number(item.recoveryAmount) || 0)); }
function penaltyLabel(item) { return `处罚合计 ${wan(penaltyTotal(item))} 万元（罚款 ${wan(item.fine)} · 追缴 ${wan(item.recoveryAmount)}）`; }
function renderMetrics(records) {
  const company = signalRecords('company');
  const peer = signalRecords('peer');
  const major = records.filter(item => (penaltyTotal(item) || 0) >= 1000000).length;
  document.getElementById('metric-cases').textContent = `${records.length.toLocaleString('zh-CN')} 起`;
  document.getElementById('metric-cases-note').textContent = `更新至 ${formatDateZh(dashboardReferenceEnd(records))}`;
  document.getElementById('metric-major-cases').textContent = `${major} 起`;
  document.getElementById('metric-peer-cases').textContent = `${peer.length} 起`;
  document.getElementById('metric-company-cases').textContent = `${company.length} 起`;
}
function renderMajorCases(records) {
  const target = document.getElementById('major-cases-detail');
  const trigger = document.getElementById('major-cases-trigger');
  const cases = records.filter(item => (penaltyTotal(item) || 0) >= 1000000).sort((a, b) => (penaltyTotal(b) || 0) - (penaltyTotal(a) || 0) || (b.penaltyDate || '').localeCompare(a.penaltyDate || ''));
  trigger.setAttribute('aria-expanded', String(state.majorCasesExpanded));
  trigger.classList.toggle('is-open', state.majorCasesExpanded);
  target.hidden = !state.majorCasesExpanded;
  if (!state.majorCasesExpanded) return;
  target.innerHTML = `<div class="major-cases-heading"><div><p class="eyebrow">MAJOR CASES</p><h2>重大案件明细</h2><p>按处罚金额从高到低排列；当前筛选范围内共 ${cases.length} 起。</p></div><button id="close-major-cases" type="button">收起 ×</button></div><div class="major-cases-list">${cases.length ? cases.map(item => `<article class="major-case"><div class="major-case-meta"><span>${escapeHtml(item.penaltyDate || '日期未填')} · ${escapeHtml(item.customs || '处罚海关未填')}</span><b>${escapeHtml(penaltyLabel(item))}</b></div><h3>${escapeHtml(item.party || '当事人未填')}</h3><p class="major-case-cargo">涉案货物：${escapeHtml(item.cargo || '未填写')}</p><p class="major-case-reason">处罚原因：${escapeHtml(item.reason || '未分类')}</p><button class="major-case-facts-button" type="button" data-facts-id="${escapeHtml(item.id)}">查看完整违法事实</button><footer>${escapeHtml(item.decisionNo || item.id)}</footer></article>`).join('') : '<p class="major-cases-empty">当前筛选范围内暂无重大案件。</p>'}</div>`;
  target.querySelector('#close-major-cases').addEventListener('click', () => { state.majorCasesExpanded = false; renderMajorCases(state.dashboardRecords); });
}
function observationWindow(records) {
  const endKey = dashboardReferenceEnd(records);
  if (!endKey) return { start: '', end: '' };
  const end = new Date(`${endKey}T00:00:00`);
  const start = new Date(end);
  // 以更新日期或已选截止日期为锚点，向前回溯三个自然月；例如 2026-10-22 对应 2026-07-22。
  start.setMonth(start.getMonth() - 3);
  const toKey = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return { start: toKey(start), end: toKey(end) };
}
function renderNationalObservation(records) {
  const window = observationWindow(records);
  const f = state.dashboardFilters;
  const recent = state.cases.filter(item => {
    const date = item.penaltyDate || '';
    return date >= window.start && date <= window.end && (!f.start || date >= f.start);
  });
  const typeRow = topEntries(countByType(recent), 1)[0];
  const highType = typeRow?.[0] || '暂无数据';
  const highCount = typeRow?.[1] || 0;
  const highShare = recent.length ? Math.round((highCount / recent.length) * 100) : 0;
  const typeRecords = recent.filter(item => typesOf(item).includes(highType));
  const secondaryRow = topEntries(countBySecondary(typeRecords, highType), 1)[0];
  const secondary = secondaryRow?.[0] || '暂无数据';
  const secondaryCount = secondaryRow?.[1] || 0;
  const secondaryShare = typeRecords.length ? Math.round((secondaryCount / typeRecords.length) * 100) : 0;
  const label = `${window.start.replaceAll('-', '/')} 至 ${window.end.replaceAll('-', '/')}`;
  document.querySelector('.observation-period').textContent = `统计时间：近三个月（${label}，共 ${recent.length.toLocaleString('zh-CN')} 起案件）`;
  document.getElementById('national-observation').textContent = '';
  document.getElementById('national-observation-metrics').innerHTML = `<article class="observation-stat"><strong>高发处罚类型</strong><b>${escapeHtml(highType)}</b><small>${highCount.toLocaleString('zh-CN')} 起 · 占比 ${highShare}%</small></article><article class="observation-stat"><strong>高频违法行为</strong><b>${escapeHtml(secondary)}</b><small>${highType}下 ${secondaryCount.toLocaleString('zh-CN')} 起 · 占比 ${secondaryShare}%</small></article>`;
}
function renderIntersectionRadar() {
  const national = signalRecords('national'), company = signalRecords('company'), peer = signalRecords('peer');
  const rows = topEntries(countByType(national), 12).map(([type, nationalCount]) => {
    const companyCount = company.filter(item => typesOf(item).includes(type)).length;
    const peerCount = peer.filter(item => typesOf(item).includes(type)).length;
    const heat = heatByType(national).find(item => item.type === type)?.delta || 0;
    const level = companyCount && peerCount ? '强' : companyCount ? '中' : '观察';
    return { type, nationalCount, companyCount, peerCount, heat, level, score: companyCount * 3 + peerCount * 4 + Math.max(heat, 0) + nationalCount / 1000 };
  }).filter(item => item.companyCount || item.peerCount).sort((a, b) => b.score - a.score).slice(0, 3);
  const target = document.getElementById('intersection-radar');
  if (target) target.innerHTML = rows.length ? rows.map(item => `<div class="intersection-item"><span class="signal-level level-${item.level}">${item.level}</span><div><strong>${escapeHtml(item.type)}</strong><p>全国 ${item.nationalCount} 起 · 公司相关产品 ${item.companyCount} 起 · 同行 ${item.peerCount} 起${item.heat > 0 ? ` · 近三月 +${item.heat}` : ''}</p></div></div>`).join('') : '<p class="empty-copy">待补充同行主体库后，将自动识别三方交集。</p>';
}
function codesFromCases(records) {
  const declared = unique(records.flatMap(item => clean(item.declaredCode).split(/[、,，;；\s]+/)).filter(Boolean)).slice(0, 3);
  const actual = unique(records.flatMap(item => clean(item.actualCode).split(/[、,，;；\s]+/)).filter(Boolean)).slice(0, 3);
  return `<small class="hs-codes">申报 HS：${escapeHtml(declared.join('、') || '—')}<br>正确 HS：${escapeHtml(actual.join('、') || '—')}</small>`;
}
function topProducts(records, limit = 10) {
  const placeholders = new Set(['无法确定', '未填写', '未知', '不详', '无', '—', '-', '']);
  return topEntries(countBy(records.filter(item => item.cargo && !placeholders.has(clean(item.cargo))), 'cargo'), limit).map(([cargo, count]) => ({ cargo, count, records: records.filter(item => item.cargo === cargo) }));
}
function signalMeta(id) {
  const labels = { national: ['全国监管风险', '观察全国海关监管风险的高发领域、升温趋势与典型案件。', 'NATIONAL'], company: ['公司产品风险信号', '按 HS 前 10 位及同类产品名称映射公司产品风险。', 'COMPANY'], peer: ['同行风险信号', '从同行企业主体及别名库识别已发生的处罚事件。', 'PEER'] };
  const records = signalRecords(id), topType = topEntries(countByType(records), 1)[0] || ['暂无数据', 0];
  const topProduct = topProducts(records.filter(item => typesOf(item).includes(topType[0])), 1)[0] || { cargo: '暂无匹配产品' };
  return { id, records, title: labels[id][0], description: labels[id][1], tag: labels[id][2], topType, topProduct };
}
function relevanceLabel(item) { const evidence = (item.companyProductMatches || []).join(''); return evidence.includes('HS 前10位') ? '高相关 · HS 前10位一致' : evidence.includes('同类产品') ? '中相关 · 同类产品' : '相关'; }
function caseSummary(item, peerMode) {
  const facts = clean(item.facts) || clean(item.reason) || '案例库暂未填写处罚摘要。'; const peerName = peerMode ? (item.peerMatches?.join(' / ') || item.peerCompany || '同行主体') : '';
  return `<article class="case-summary"><div class="summary-meta"><span>${escapeHtml(item.penaltyDate || '日期未填')}</span>${peerName ? `<em>同行：${escapeHtml(peerName)}</em>` : ''}</div><strong>${escapeHtml(item.cargo || '未填写涉案货物')}</strong><p>${escapeHtml(facts)}</p><footer><span>${escapeHtml(item.customs || '海关未填')} · ${escapeHtml(item.decisionNo || item.id)}</span><b>${escapeHtml(penaltyLabel(item))} · 罚款倍数 ${escapeHtml(multipleOf(item.fineRate))}</b></footer></article>`;
}
function renderSignalDetail(meta) {
  const target = document.getElementById('signal-detail');
  if (!meta.records.length) { target.hidden = false; target.innerHTML = `<p class="signal-empty">“${escapeHtml(meta.title)}”暂未匹配到案件。同行主体库可在 <code>peer_companies.json</code> 中补充。</p>`; return; }
  const typeRows = topEntries(countByType(meta.records), 999);
  const selectedType = state.activeRiskType, typeRecords = selectedType ? meta.records.filter(item => typesOf(item).includes(selectedType)) : [];
  const isClassification = selectedType === '商品归类' || selectedType === '固体废物', isExportControl = selectedType === '出口管制';
  const secondaryRows = topEntries(countBySecondary(typeRecords, selectedType), 999), itemRows = topEntries(countBySecondaryItem(typeRecords), 999);
  const secondaryRecords = state.activeRiskSecondary ? typeRecords.filter(item => secondaryActions(item, selectedType).includes(state.activeRiskSecondary)) : typeRecords;
  const itemRecords = state.activeRiskItem ? typeRecords.filter(item => (item.secondaryItem || '未分类') === state.activeRiskItem) : typeRecords;
  const productSource = isExportControl ? itemRecords : (isClassification ? typeRecords : secondaryRecords);
  const productRows = topProducts(productSource, 999);
  const selectedProduct = state.activeRiskProduct;
  let summarySource = selectedType ? typeRecords : meta.records;
  if (selectedProduct) summarySource = productSource.filter(item => item.cargo === selectedProduct);
  else if (isExportControl && state.activeRiskItem) summarySource = itemRecords;
  else if (!isClassification && state.activeRiskSecondary) summarySource = secondaryRecords;
  const drillQuery = clean(state.drillQuery).toLowerCase();
  const summaries = summarySource.filter(item => !drillQuery || [item.cargo, item.declaredCode, item.actualCode].map(clean).join(' ').toLowerCase().includes(drillQuery)).sort((a, b) => (penaltyTotal(b) || 0) - (penaltyTotal(a) || 0) || (b.penaltyDate || '').localeCompare(a.penaltyDate || ''));
  const list = (rows, attribute, selected, extra = '') => `<ol class="signal-ranking drill-list drill-scroll">${rows.length ? rows.map(([name, count], index) => `<li><button type="button" ${attribute}="${escapeHtml(name)}" class="drill-button ${selected === name ? 'is-selected' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(name)}${extra}</span><strong>${count} 起</strong></button></li>`).join('') : '<li class="drill-placeholder">暂无可用数据</li>'}</ol>`;
  const products = `<ol class="signal-ranking drill-list drill-scroll">${productRows.length ? productRows.map((item, index) => `<li><button type="button" data-risk-product="${escapeHtml(item.cargo)}" class="drill-button product-button ${selectedProduct === item.cargo ? 'is-selected' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.cargo)}${isClassification ? codesFromCases(item.records) : ''}</span><strong>${item.count} 起</strong></button></li>`).join('') : '<li class="drill-placeholder">该范围暂无具体涉案产品</li>'}</ol>`;
  const clearFilter = name => name ? `<button type="button" class="drill-clear-filter" data-clear-risk-filter="${name}">取消筛选</button>` : '';
  const columnHeading = (title, name = '', active = '') => `<h3><span>${title}</span>${clearFilter(name, active)}</h3>`;
  const typeColumn = `<section class="drill-column">${columnHeading('处罚类型', 'type', selectedType)}${list(typeRows, 'data-risk-type', selectedType)}</section>`;
  const summaryColumn = `<section class="drill-column summary-column"><div class="summary-heading">${columnHeading('处罚摘要')}<div class="summary-actions"><label><input id="drill-query" type="search" value="${escapeHtml(state.drillQuery)}" placeholder="品名、商编等"></label><button id="drill-search" type="button">搜索</button><button id="drill-export" type="button">导出</button></div></div>${summaries.length ? `<div class="summary-list">${summaries.map(item => caseSummary(item, meta.id === 'peer')).join('')}</div>` : '<p class="drill-placeholder">当前筛选范围暂无处罚摘要。</p>'}${meta.id === 'company' && summaries[0] ? `<p class="relevance-note">公司相关度：${escapeHtml(relevanceLabel(summaries[0]))}</p>` : ''}</section>`;
  let middleColumns = '';
  if (isExportControl) {
    middleColumns = `<section class="drill-column dual-drill-column"><div class="drill-subsection">${columnHeading('违法行为', 'secondary', state.activeRiskSecondary)}${list(secondaryRows, 'data-risk-secondary', state.activeRiskSecondary)}</div><div class="drill-subsection">${columnHeading('涉案物项', 'item', state.activeRiskItem)}${list(itemRows, 'data-risk-item', state.activeRiskItem)}</div></section>`;
  } else if (isClassification) {
    middleColumns = `<section class="drill-column">${columnHeading(selectedType === '商品归类' ? '商品归类 · HS 对照' : '涉案产品', 'product', selectedProduct)}${selectedType ? products : '<p class="drill-placeholder">请先选择处罚类型。</p>'}</section>`;
  } else {
    middleColumns = `<section class="drill-column dual-drill-column"><div class="drill-subsection">${columnHeading('违法行为', 'secondary', state.activeRiskSecondary)}${selectedType ? list(secondaryRows, 'data-risk-secondary', state.activeRiskSecondary) : '<p class="drill-placeholder">请先选择处罚类型。</p>'}</div><div class="drill-subsection">${columnHeading('涉案产品', 'product', selectedProduct)}${state.activeRiskSecondary ? products : '<p class="drill-placeholder">请选择违法行为。</p>'}</div></section>`;
  }
  const prevScrollTops = [...target.querySelectorAll('.drill-scroll, .summary-list')].map(el => el.scrollTop);
  target.hidden = false;
  target.innerHTML = `<div class="signal-detail-head"><span>${escapeHtml(meta.tag)}</span><strong>${escapeHtml(meta.title)} · 风险钻取</strong><small>按案件数从多到少排列，可在各栏内滚动查看全部结果。</small><button class="signal-close" type="button" aria-label="收起详情">收起 ×</button></div><div class="signal-detail-grid export-drill-grid">${typeColumn}${middleColumns}${summaryColumn}</div>`;
  [...target.querySelectorAll('.drill-scroll, .summary-list')].forEach((el, index) => { if (index < prevScrollTops.length) el.scrollTop = prevScrollTops[index]; });
  target.querySelector('.signal-close').addEventListener('click', () => { state.activeSignal = ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; state.drillQuery = ''; renderRadar(); });
  target.querySelectorAll('[data-risk-type]').forEach(button => button.addEventListener('click', () => { state.activeRiskType = button.dataset.riskType; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-secondary]').forEach(button => button.addEventListener('click', () => { state.activeRiskSecondary = button.dataset.riskSecondary; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-item]').forEach(button => button.addEventListener('click', () => { state.activeRiskItem = button.dataset.riskItem; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-product]').forEach(button => button.addEventListener('click', () => { state.activeRiskProduct = button.dataset.riskProduct; renderRadar(); }));
  target.querySelectorAll('[data-clear-risk-filter]').forEach(button => button.addEventListener('click', () => {
    const filter = button.dataset.clearRiskFilter;
    if (filter === 'type') { state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; }
    if (filter === 'secondary') { state.activeRiskSecondary = ''; state.activeRiskProduct = ''; }
    if (filter === 'item') { state.activeRiskItem = ''; state.activeRiskProduct = ''; }
    if (filter === 'product') state.activeRiskProduct = '';
    renderRadar();
  }));
  const drillQueryInput = target.querySelector('#drill-query');
  const applyDrillSearch = () => { state.drillQuery = clean(drillQueryInput?.value); renderRadar(); };
  target.querySelector('#drill-search').addEventListener('click', applyDrillSearch);
  drillQueryInput.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); applyDrillSearch(); } });
  target.querySelector('#drill-export').addEventListener('click', () => exportDrillSummary(meta));
}
function renderRadar() {
  updateMetricTriggers();
  const selected = ['national', 'company', 'peer'].map(signalMeta).find(meta => meta.id === state.activeSignal);
  const detail = document.getElementById('signal-detail');
  if (selected) renderSignalDetail(selected);
  else { detail.hidden = true; detail.innerHTML = ''; }
}
function renderTypeBreakdown(records) {
  const target = document.getElementById('type-breakdown'), primary = state.activeChartType;
  if (primary !== '商品归类' && window.CustomsClassificationDrill?.isOpen()) window.CustomsClassificationDrill.close();
  if (!primary) { target.hidden = true; target.innerHTML = ''; return; }
  const selected = records.filter(item => typesOf(item).includes(primary)), rows = topEntries(countBySecondary(selected, primary), 999);
  target.hidden = false;
  target.innerHTML = `<div class="type-breakdown-head"><strong>${escapeHtml(primary)} · 违法行为（共${selected.length}起）</strong></div><p>各违法行为占“${escapeHtml(primary)}”案件的比例；复合违法行为会同时计入对应项目。</p><ol>${rows.map(([name, count], index) => {
    const label = `${String(index + 1).padStart(2, '0')} · ${escapeHtml(name)}`, statistic = `${count} 起 · ${((count / Math.max(selected.length, 1)) * 100).toFixed(1)}%`;
    return primary === '商品归类' && name === '商品编号申报错误'
      ? `<li class="hs-action-row"><button class="hs-open-drill" type="button" data-open-hs-drill aria-controls="classification-drill" aria-expanded="${!!window.CustomsClassificationDrill?.isOpen()}"><span>${label}</span><b>${statistic}</b><small>查看案件 ›</small></button></li>`
      : `<li><span>${label}</span><b>${statistic}</b></li>`;
  }).join('') || '<li>暂无违法行为数据</li>'}</ol>`;
}
function renderTypeCustomsBreakdown(records) {
  const target = document.getElementById('type-customs-breakdown'), primary = state.activeChartType;
  if (!primary) { target.hidden = true; target.innerHTML = ''; return; }
  const selected = records.filter(item => typesOf(item).includes(primary));
  const rows = topEntries(countBy(selected, 'customs'), 5);
  target.hidden = false;
  target.innerHTML = `<div class="type-breakdown-head"><strong>${escapeHtml(primary)} · 前五处罚海关</strong></div><p>按案件数从高到低排列。</p><ol>${rows.map(([name, count], index) => `<li><span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(name)}</span><b>${count} 起 · ${((count / Math.max(selected.length, 1)) * 100).toFixed(1)}%</b></li>`).join('') || '<li>暂无处罚海关数据</li>'}</ol>`;
}
function customsTooltip(params, records) { const point = Array.isArray(params) ? params[0] : params, name = point?.axisValue || point?.name || '', selected = records.filter(item => item.parentCustoms === name), leaders = topEntries(countByType(selected), 3); const lines = leaders.map(([type, value], index) => `${index + 1}. ${escapeHtml(type)}：${value} 起（${((value / Math.max(selected.length, 1)) * 100).toFixed(1)}%）`).join('<br>'); return `<strong>${escapeHtml(name)}</strong><br>案件数量：${selected.length} 起<br><span class="tip-caption">处罚类型 TOP 3</span><br>${lines || '暂无数据'}`; }
function renderCustomsDistributionSummary(records) {
  const target = document.getElementById('customs-distribution-summary');
  const directCustoms = topEntries(countBy(records, 'parentCustoms'), Infinity);
  if (!directCustoms.length) { target.innerHTML = '<p class="customs-summary-empty">暂无直属海关案件数据</p>'; return; }
  if (!directCustoms.some(([name]) => name === state.activeCustoms)) state.activeCustoms = directCustoms[0][0];
  const selected = records.filter(item => item.parentCustoms === state.activeCustoms);
  const penaltyCustoms = topEntries(countBy(selected, 'customs'), 5);
  if (!penaltyCustoms.some(([name]) => name === state.activePenaltyCustoms)) state.activePenaltyCustoms = penaltyCustoms[0]?.[0] || '';
  const selectedPenalty = selected.filter(item => item.customs === state.activePenaltyCustoms);
  const typeRows = topEntries(countByType(selectedPenalty), 3);
  target.innerHTML = `<div class="customs-summary-block"><div class="customs-summary-head"><strong>${escapeHtml(state.activeCustoms)} · 处罚海关 TOP 5</strong><small>点击海关名称查看其处罚类型</small></div><ol>${penaltyCustoms.map(([name, count], index) => `<li><button type="button" class="customs-summary-button ${name === state.activePenaltyCustoms ? 'is-selected' : ''}" data-penalty-customs="${escapeHtml(name)}"><span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(name)}</span><b>${count} 起 · ${((count / Math.max(selected.length, 1)) * 100).toFixed(1)}%</b></button></li>`).join('') || '<li>暂无处罚海关数据</li>'}</ol></div><div class="customs-summary-block"><div class="customs-summary-head"><strong>${escapeHtml(state.activePenaltyCustoms || '处罚海关')} · 处罚类型 TOP 3</strong><small>按案件数从高到低排列</small></div><ol>${typeRows.map(([name, count], index) => `<li><span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(name)}</span><b>${count} 起 · ${((count / Math.max(selectedPenalty.length, 1)) * 100).toFixed(1)}%</b></li>`).join('') || '<li>暂无处罚类型数据</li>'}</ol></div>`;
  target.querySelectorAll('[data-penalty-customs]').forEach(button => button.addEventListener('click', () => { state.activePenaltyCustoms = button.dataset.penaltyCustoms || ''; renderCustomsDistributionSummary(records); }));
}
function renderCharts(records) {
  const typeEntries = topEntries(countByType(records), 5);
  if (!state.activeChartType && typeEntries.length) state.activeChartType = typeEntries[0][0];
  const allCustoms = topEntries(countBy(records, 'parentCustoms'), Infinity);
  const customsQuery = state.customsQuery.toLowerCase();
  const customs = allCustoms.filter(([name]) => !customsQuery || clean(name).toLowerCase().includes(customsQuery));
  if (!customs.some(([name]) => name === state.activeCustoms)) { state.activeCustoms = customs[0]?.[0] || ''; state.activePenaltyCustoms = ''; }
  const empty = !records.length;
  const customsChartEl = document.getElementById('customs-chart');
  const barHeight = 28, minHeight = 220;
  customsChartEl.style.height = `${Math.max(minHeight, customs.length * barHeight + 54)}px`;
  state.charts.customs.resize();
  const themed = document.documentElement.dataset.theme === 'graphite';
  const chartText = themed ? '#d7e8f1' : '#506d83';
  const chartStrong = themed ? '#f2fbff' : '#315b72';
  const chartLine = themed ? '#46728b' : '#8bb6c8';
  const chartGrid = themed ? '#31536a' : '#dce8ef';
  const chartBorder = themed ? '#10283a' : '#f8fbfd';
  const tooltipStyle = { backgroundColor: '#102b45', borderColor: '#6ba9d7', borderWidth: 1, padding: 11, textStyle: { color: '#f5fbff', fontSize: 12, lineHeight: 19 } };
  state.charts.type.setOption({ animationDurationUpdate: 250, tooltip: { show: false }, color: ['#3295df', '#31bcb1', '#897af0', '#f0a44f', '#e06c8a'], legend: { type: 'scroll', orient: 'vertical', left: 10, top: 'middle', textStyle: { color: chartText, fontSize: 12 } }, series: [{ type: 'pie', radius: ['44%', '68%'], center: ['62%', '52%'], label: { show: false }, itemStyle: { borderColor: chartBorder, borderWidth: 2 }, data: typeEntries.map(([name, value]) => ({ name, value })) }], graphic: empty ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无案件', fill: chartText, fontSize: 14 } }] : [] }, true);
  state.charts.type.setOption({ series: [{ label: { show: true, formatter: '{name|{b}}\n{percent|{d}%}', rich: { name: { color: chartStrong, fontSize: 11, lineHeight: 16 }, percent: { color: '#35c2bb', fontSize: 13, fontWeight: 'bold', lineHeight: 17 } } }, labelLine: { show: true, length: 8, length2: 6, lineStyle: { color: chartLine } } }] });
  state.charts.customs.setOption({ animationDurationUpdate: 250, grid: { left: 10, right: 42, top: 10, bottom: 12, containLabel: true }, tooltip: { ...tooltipStyle, trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: params => customsTooltip(params, records) }, xAxis: { type: 'value', minInterval: 1, axisLabel: { color: chartText }, splitLine: { lineStyle: { color: chartGrid } } }, yAxis: { type: 'category', inverse: true, data: customs.map(([name]) => name), axisLabel: { color: chartStrong, width: 130, overflow: 'truncate' }, axisTick: { show: false }, axisLine: { show: false } }, series: [{ type: 'bar', barMaxWidth: 21, data: customs.map(([, value]) => value), itemStyle: { color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [{ offset: 0, color: '#287fc4' }, { offset: 1, color: '#3bc4b5' }]), borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: chartStrong, formatter: '{c}' } }], graphic: empty ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无案件', fill: chartText, fontSize: 14 } }] : [] }, true);
  renderTypeBreakdown(records);
  renderTypeCustomsBreakdown(records);
  renderCustomsDistributionSummary(records);
}
function recordsToCsv(records) {
  const headers = ['处罚决定书文号', '处罚海关', '处罚日期', '违法日期', '当事人', '涉案货物', '处罚原因', '检验检疫对象', '申报商品编号', '实际商品编码', '涉案金额（万元）', '违法经营额（万元）', '漏缴税金额（万元）', '罚款金额（万元）', '追缴金额（万元）', '处罚合计（万元）', '罚款幅度', '违法行为一级分类', '违法行为二级分类', '涉案物项二级分类', '直属海关'];
  const rows = records.map(item => [
    item.decisionNo, item.customs, item.penaltyDate, item.violationDate, item.party, item.cargo, item.reason, item.lawInspectionObject || '',
    item.declaredCode, item.actualCode, wan(item.amount), wan(item.illegalOperationAmount), wan(item.taxUnderpaymentAmount),
    wan(item.fine), wan(item.recoveryAmount), wan(penaltyTotal(item)), rate(item.fineRate),
    (item.types || [item.type]).join('、'), item.reason || '', item.secondaryItem || '', item.parentCustoms
  ]);
  return '\ufeff' + [headers, ...rows].map(row => row.map(cell => {
    const text = String(cell ?? '').replace(/"/g, '""');
    return /[",\n\r]/.test(text) ? `"${text}"` : text;
  }).join(',')).join('\r\n');
}
function downloadFile(content, filename, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
function exportDrillSummary(meta) {
  let records = meta.records.slice();
  if (state.activeRiskType) records = records.filter(item => typesOf(item).includes(state.activeRiskType));
  if (state.activeRiskSecondary) records = records.filter(item => secondaryActions(item, state.activeRiskType).includes(state.activeRiskSecondary));
  if (state.activeRiskItem) records = records.filter(item => (item.secondaryItem || '未分类') === state.activeRiskItem);
  if (state.activeRiskProduct) records = records.filter(item => item.cargo === state.activeRiskProduct);
  const query = clean(state.drillQuery).toLowerCase();
  if (query) records = records.filter(item => [item.cargo, item.declaredCode, item.actualCode].map(clean).join(' ').toLowerCase().includes(query));
  downloadFile(recordsToCsv(records), `${meta.title}_处罚摘要_${records.length}起_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
}
function exportDetailResults() {
  const records = sorted(detailCases());
  downloadFile(recordsToCsv(records), `海关行政处罚案例明细_${records.length}起_${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
}
function updateMetricTriggers() {
  const map = { 'national-trigger': 'national', 'peer-trigger': 'peer', 'company-trigger': 'company' };
  Object.entries(map).forEach(([id, signal]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const active = state.activeSignal === signal;
    el.setAttribute('aria-expanded', String(active));
    el.classList.toggle('is-open', active);
  });
}
function toggleSignal(id) {
  const opening = state.activeSignal !== id;
  state.activeSignal = opening ? id : '';
  state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; state.drillQuery = '';
  if (opening && state.majorCasesExpanded) { state.majorCasesExpanded = false; renderMajorCases(state.dashboardRecords); }
  renderRadar();
}
function renderDashboard() { const records = dashboardCases(); state.dashboardRecords = records; const { start, end } = state.dashboardFilters; const statusText = start || end ? `已筛选 ${records.length.toLocaleString('zh-CN')} 起案件` : '全量公开行政处罚'; document.getElementById('dashboard-scope-status').textContent = statusText; renderMetrics(records); renderMajorCases(records); updateMetricTriggers(); renderNationalObservation(records); renderRadar(); renderCharts(records); window.CustomsClassificationDrill?.update(); }
function factsCell(item) { return `<button class="reason-button" type="button" data-facts-id="${escapeHtml(item.id)}">${escapeHtml(item.reason || '未分类')}</button>`; }
function rateCell(item) { const basis = item.fineRateBasis ? `罚款幅度 = 罚款金额 ÷ ${item.fineRateBasis}` : '缺少罚款金额或适用分母'; return `<span title="${escapeHtml(basis)}">${rate(item.fineRate)}</span>`; }
function partyCell(item) { const party = item.party || '—'; return `<span class="party-name" title="${escapeHtml(party)}">${escapeHtml(party)}</span>`; }
function documentCell(item) { return item.originalUrl ? `<a class="doc-link" href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener">原文</a>` : '<span class="doc-unavailable">暂未上传</span>'; }
function row(item) { return `<tr><td>${escapeHtml(item.decisionNo)}</td><td>${escapeHtml(item.customs)}</td><td>${escapeHtml(item.penaltyDate)}</td><td>${escapeHtml(item.violationDate)}</td><td>${partyCell(item)}</td><td>${escapeHtml(item.cargo)}</td><td>${factsCell(item)}</td><td>${escapeHtml(item.declaredCode)}</td><td>${escapeHtml(item.actualCode)}</td><td class="number-cell">${wan(item.amount)}</td><td class="number-cell">${wan(item.illegalOperationAmount)}</td><td class="number-cell">${wan(item.taxUnderpaymentAmount)}</td><td class="number-cell">${wan(item.fine)}</td><td class="number-cell">${wan(item.recoveryAmount)}</td><td class="number-cell">${rateCell(item)}</td><td>${documentCell(item)}</td></tr>`; }
function sorted(records) { const numeric = new Set(['amount', 'illegalOperationAmount', 'taxUnderpaymentAmount', 'fine', 'recoveryAmount', 'penaltyAmount', 'fineRate']); return records.slice().sort((left, right) => { const a = left[state.sort.field], b = right[state.sort.field], aMissing = a === null || a === undefined || a === '', bMissing = b === null || b === undefined || b === ''; if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? 1 : -1); const result = numeric.has(state.sort.field) ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'zh-CN'); return state.sort.direction === 'asc' ? result : -result; }); }
function renderDetails() { const records = sorted(detailCases()), totalPages = Math.max(1, Math.ceil(records.length / state.pageSize)); state.page = Math.min(Math.max(1, state.page), totalPages); const rows = records.slice((state.page - 1) * state.pageSize, state.page * state.pageSize); document.getElementById('detail-table').innerHTML = rows.length ? rows.map(row).join('') : '<tr><td colspan="16">暂无符合条件的案件</td></tr>'; document.getElementById('detail-page-info').textContent = `第 ${state.page} / ${totalPages} 页`; document.getElementById('detail-count').textContent = `共 ${records.length} 起`; document.getElementById('detail-prev-page').disabled = state.page <= 1; document.getElementById('detail-next-page').disabled = state.page >= totalPages; document.getElementById('detail-sort-field').value = state.sort.field; document.getElementById('detail-sort-order').textContent = state.sort.direction === 'desc' ? '↓' : '↑'; }
function updateDetailFilters() { Object.entries(detailFields).forEach(([key, field]) => { state.detailFilters[key] = clean(field.value); }); state.page = 1; renderDetails(); }
function updateDashboardFilters() { state.dashboardFilters.start = clean(document.getElementById('dashboard-start-date').value); state.dashboardFilters.end = clean(document.getElementById('dashboard-end-date').value); state.dashboardFilters.query = ''; state.activeSignal = ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; state.activeChartType = window.CustomsClassificationDrill?.isOpen() ? '商品归类' : ''; state.activeCustoms = ''; state.activePenaltyCustoms = ''; state.drillQuery = ''; renderDashboard(); }
function switchView(view) { state.activeView = view; const dashboard = view === 'dashboard'; document.getElementById('dashboard-panel').hidden = !dashboard; document.getElementById('details-panel').hidden = dashboard; document.getElementById('view-switch-text').textContent = dashboard ? '进入案例明细 →' : '返回风险看板'; document.getElementById('view-switch').setAttribute('aria-label', dashboard ? '进入案例明细' : '返回风险看板'); if (dashboard) setTimeout(() => Object.values(state.charts).forEach(chart => chart.resize()), 0); window.dispatchEvent(new Event('scroll')); }
function openFacts(id) { const item = state.cases.find(caseItem => caseItem.id === id); if (!item) return; document.getElementById('facts-title').textContent = `${item.id} · ${item.reason || '违法事实'}`; document.getElementById('facts-content').textContent = item.facts || '案例库暂未填写违法事实。'; dialog.showModal(); }
function applyPayload(payload, initial = false) { const version = payload.version || `${payload.updatedAt || ''}:${(payload.cases || []).length}`; if (!initial && version === state.dataVersion) return false; state.cases = (payload.cases || []).filter(isVisibleCase); setOptions(detailFields.customs, unique(state.cases.map(item => item.parentCustoms)), '全部直属海关'); setOptions(detailFields.type, unique(state.cases.flatMap(typesOf)), '全部类型'); state.dataVersion = version; if (initial) { state.charts.type = echarts.init(document.getElementById('type-chart')); state.charts.customs = echarts.init(document.getElementById('customs-chart')); state.charts.type.on('click', params => { state.activeChartType = params.name; renderTypeBreakdown(state.dashboardRecords); renderTypeCustomsBreakdown(state.dashboardRecords); }); state.charts.customs.on('click', params => { state.activeCustoms = params.name || ''; state.activePenaltyCustoms = ''; renderCustomsDistributionSummary(state.dashboardRecords); }); } status.textContent = `已加载 ${state.cases.length.toLocaleString('zh-CN')} 起案件`; renderDashboard(); renderDetails(); return true; }
async function loadCases(initial = false) { const inline = window.__CUSTOMS_CASES_DATA__; if (window.location.protocol === 'file:' && inline) return applyPayload(inline, initial); const response = await fetch(`./data/cases.json?version=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error('数据文件不可用'); return applyPayload(await response.json(), initial); }
async function start() { try { await loadCases(true); window.setInterval(() => loadCases().catch(error => console.warn('看板自动更新失败：', error)), 10000); } catch (error) { status.textContent = '案件数据加载失败。请确认已先生成 data/cases.json。'; console.error(error); } }
Object.values(detailFields).forEach(field => field.addEventListener('input', updateDetailFilters));
document.getElementById('dashboard-start-date').addEventListener('change', updateDashboardFilters);
document.getElementById('dashboard-end-date').addEventListener('change', updateDashboardFilters);
document.getElementById('dashboard-reset-filters').addEventListener('click', () => { document.getElementById('dashboard-start-date').value = ''; document.getElementById('dashboard-end-date').value = ''; updateDashboardFilters(); });
document.getElementById('customs-query').addEventListener('input', () => { state.customsQuery = clean(document.getElementById('customs-query').value); renderCharts(state.dashboardRecords); });
document.getElementById('major-cases-trigger').addEventListener('click', () => {
  state.majorCasesExpanded = !state.majorCasesExpanded;
  if (state.majorCasesExpanded && state.activeSignal) {
    state.activeSignal = ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = '';
    renderRadar();
  }
  renderMajorCases(state.dashboardRecords);
});
document.getElementById('major-cases-trigger').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } });
['national', 'peer', 'company'].forEach(id => {
  const trigger = document.getElementById(`${id}-trigger`);
  if (!trigger) return;
  trigger.addEventListener('click', () => toggleSignal(id));
  trigger.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } });
});
document.getElementById('detail-sort-field').addEventListener('change', event => { state.sort.field = event.target.value; renderDetails(); });
document.getElementById('detail-sort-order').addEventListener('click', () => { state.sort.direction = state.sort.direction === 'desc' ? 'asc' : 'desc'; renderDetails(); });
document.getElementById('detail-page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderDetails(); });
document.getElementById('detail-prev-page').addEventListener('click', () => { state.page -= 1; renderDetails(); });
document.getElementById('detail-next-page').addEventListener('click', () => { state.page += 1; renderDetails(); });
document.getElementById('detail-reset-filters').addEventListener('click', () => { Object.entries(detailFields).forEach(([key, field]) => { field.value = key === 'scope' ? 'all' : ''; }); updateDetailFilters(); });
document.getElementById('detail-export').addEventListener('click', exportDetailResults);
document.getElementById('view-switch').addEventListener('click', () => switchView(state.activeView === 'dashboard' ? 'details' : 'dashboard'));
document.getElementById('back-to-dashboard').addEventListener('click', () => switchView('dashboard'));
const themeSelector = document.getElementById('theme-select');
if (themeSelector) {
  let savedTheme = 'navy';
  try { savedTheme = localStorage.getItem(themeStorageKey) || savedTheme; } catch { /* 本地直开或隐私模式下可能不可用 */ }
  applyTheme(savedTheme, false);
  themeSelector.addEventListener('change', event => applyTheme(event.target.value));
}
document.addEventListener('click', event => { const target = event.target.closest('[data-facts-id]'); if (target) openFacts(target.dataset.factsId); });
document.addEventListener('click', event => { if (event.target.closest('[data-open-hs-drill]')) window.CustomsClassificationDrill?.open(); });
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
const dashboardToolbar = document.getElementById('dashboard-toolbar');
const siteHeader = document.querySelector('.site-header');
let headerHeightCache = 0;
function syncHeaderHeight() {
  const height = siteHeader ? Math.round(siteHeader.getBoundingClientRect().height) : 70;
  if (height !== headerHeightCache) {
    headerHeightCache = height;
    document.documentElement.style.setProperty('--toolbar-top', `${height}px`);
  }
  return height;
}
function initDashboardToolbar() {
  if (!dashboardToolbar) return;
  const sentinel = document.createElement('div');
  sentinel.style.cssText = 'height:1px;width:100%;visibility:hidden;pointer-events:none;';
  dashboardToolbar.parentNode.insertBefore(sentinel, dashboardToolbar);
  let condensed = dashboardToolbar.classList.contains('is-condensed'), scheduled = false;
  const update = () => {
    scheduled = false;
    const headerHeight = syncHeaderHeight();
    const shouldCondense = sentinel.getBoundingClientRect().bottom < headerHeight + 1;
    if (shouldCondense !== condensed) {
      condensed = shouldCondense;
      dashboardToolbar.classList.toggle('is-condensed', shouldCondense);
    }
  };
  const scheduleUpdate = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
  window.addEventListener('scroll', scheduleUpdate, { passive: true });
  window.addEventListener('resize', () => { Object.values(state.charts).forEach(chart => chart.resize()); scheduleUpdate(); }, { passive: true });
  update();
}
initDashboardToolbar();
window.CustomsClassificationDrill?.init({
  getRecords: () => state.dashboardRecords,
  getScopeLabel: () => { const { start, end } = state.dashboardFilters; return start || end ? `处罚日期：${start || '不限'} 至 ${end || '不限'}` : '处罚日期：全部'; },
  onToggle: () => renderTypeBreakdown(state.dashboardRecords)
});
switchView('dashboard'); start();
