const state = {
  cases: [], dashboardRecords: [], dataVersion: '', activeView: 'dashboard', activeSignal: '', activeRiskType: '', activeRiskSecondary: '', activeRiskItem: '', activeRiskProduct: '', activeChartType: '', majorCasesExpanded: false, charts: {},
  dashboardFilters: { start: '', end: '' },
  detailFilters: { start: '', end: '', scope: 'all', customs: '', type: '', cargo: '', query: '' },
  sort: { field: 'penaltyDate', direction: 'desc' }, page: 1, pageSize: 20
};
const detailFields = {
  start: document.getElementById('detail-start-date'), end: document.getElementById('detail-end-date'),
  scope: document.getElementById('detail-scope-filter'), customs: document.getElementById('detail-customs-filter'),
  type: document.getElementById('detail-type-filter'), cargo: document.getElementById('detail-cargo-filter'), query: document.getElementById('detail-query-filter')
};
const status = document.getElementById('data-status');
const dialog = document.getElementById('facts-dialog');
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
const clean = value => String(value ?? '').trim();
const wan = value => Number.isFinite(value) ? (value / 10000).toLocaleString('zh-CN', { maximumFractionDigits: 2 }) : '—';
const rate = value => Number.isFinite(value) ? `${(value * 100).toLocaleString('zh-CN', { maximumFractionDigits: 2 })}%` : '—';
const unique = values => [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'zh-CN'));
const typesOf = item => Array.isArray(item.types) && item.types.length ? item.types : [item.type || '未分类'];
const caseDate = item => /^\d{4}-\d{2}-\d{2}$/.test(item.penaltyDate || '') ? new Date(`${item.penaltyDate}T00:00:00`) : null;
function setOptions(select, values, placeholder) { const saved = select.value; select.innerHTML = `<option value="">${placeholder}</option>${values.map(value => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join('')}`; select.value = Array.from(select.options).some(option => option.value === saved) ? saved : ''; }
function countBy(records, key) { return records.reduce((map, item) => { const name = item[key] || '未分类'; map.set(name, (map.get(name) || 0) + 1); return map; }, new Map()); }
function countByType(records) { const map = new Map(); records.forEach(item => typesOf(item).forEach(type => map.set(type, (map.get(type) || 0) + 1))); return map; }
function countBySecondary(records) { return countBy(records, 'reason'); }
function countBySecondaryItem(records) { return countBy(records, 'secondaryItem'); }
function topEntries(map, limit = 5) { return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]), 'zh-CN')).slice(0, limit); }
function latestRecognizedDate(records) {
  const dates = records.flatMap(item => [...clean(item.recognizedFiles || '').matchAll(/_(\d{8})_/g)].map(match => match[1])).filter(value => {
    const month = Number(value.slice(4, 6)), day = Number(value.slice(6, 8));
    return month >= 1 && month <= 12 && day >= 1 && day <= new Date(Number(value.slice(0, 4)), month, 0).getDate();
  }).sort();
  return dates.length ? `${dates.at(-1).slice(0, 4)}年${Number(dates.at(-1).slice(4, 6))}月${Number(dates.at(-1).slice(6, 8))}日` : '—';
}
function dashboardCases() { const { start, end } = state.dashboardFilters; return state.cases.filter(item => { const date = item.penaltyDate || ''; return (!start || date >= start) && (!end || date <= end); }); }
function signalRecords(id) { const records = state.dashboardRecords; if (id === 'company') return records.filter(item => item.companyProduct); if (id === 'peer') return records.filter(item => item.peerCompany); return records; }
function detailCases() { const f = state.detailFilters; return state.cases.filter(item => { const date = item.penaltyDate || ''; return (!f.start || date >= f.start) && (!f.end || date <= f.end) && (f.scope === 'all' || item.companyProduct) && (!f.customs || item.parentCustoms === f.customs) && (!f.type || typesOf(item).includes(f.type)) && (!f.cargo || item.cargo === f.cargo) && (!f.query || clean(item.searchText).toLowerCase().includes(f.query.toLowerCase())); }); }

function datedRecords(records, monthsAgoStart, monthsAgoEnd = 0) {
  const dates = records.map(caseDate).filter(Boolean); if (!dates.length) return [];
  const latest = new Date(Math.max(...dates)); const end = new Date(latest); end.setMonth(end.getMonth() - monthsAgoEnd); const start = new Date(latest); start.setMonth(start.getMonth() - monthsAgoStart);
  return records.filter(item => { const date = caseDate(item); return date && date > start && date <= end; });
}
function heatByType(records) {
  const recent = datedRecords(records, 3), prior = datedRecords(records, 6, 3), allTypes = unique([...recent.flatMap(typesOf), ...prior.flatMap(typesOf)]);
  return allTypes.map(type => { const now = recent.filter(item => typesOf(item).includes(type)).length, before = prior.filter(item => typesOf(item).includes(type)).length; return { type, now, before, delta: now - before }; }).sort((a, b) => b.delta - a.delta || b.now - a.now);
}
function renderMetrics(records) {
  const company = signalRecords('company');
  const major = records.filter(item => (item.fine || 0) >= 1000000).length;
  document.getElementById('metric-cases').textContent = `${records.length.toLocaleString('zh-CN')} 起`;
  document.getElementById('metric-cases-note').textContent = `更新至 ${latestRecognizedDate(records)}`;
  document.getElementById('metric-fine').textContent = wan(records.reduce((sum, item) => sum + (item.fine || 0), 0));
  document.getElementById('metric-major-cases').textContent = `${major} 起`;
  document.getElementById('metric-company-cases').textContent = `${company.length} 起`;
}
function renderMajorCases(records) {
  const target = document.getElementById('major-cases-detail');
  const trigger = document.getElementById('major-cases-trigger');
  const cases = records.filter(item => (item.fine || 0) >= 1000000).sort((a, b) => (b.fine || 0) - (a.fine || 0) || (b.penaltyDate || '').localeCompare(a.penaltyDate || ''));
  trigger.setAttribute('aria-expanded', String(state.majorCasesExpanded));
  trigger.classList.toggle('is-open', state.majorCasesExpanded);
  target.hidden = !state.majorCasesExpanded;
  if (!state.majorCasesExpanded) return;
  target.innerHTML = `<div class="major-cases-heading"><div><p class="eyebrow">MAJOR CASES</p><h2>重大案件明细</h2><p>按处罚金额从高到低排列；当前筛选范围内共 ${cases.length} 起。</p></div><button id="close-major-cases" type="button">收起 ×</button></div><div class="major-cases-list">${cases.length ? cases.map(item => `<article class="major-case"><div class="major-case-meta"><span>${escapeHtml(item.penaltyDate || '日期未填')} · ${escapeHtml(item.customs || '处罚海关未填')}</span><b>罚款 ${wan(item.fine)} 万元</b></div><h3>${escapeHtml(item.party || '当事人未填')}</h3><p class="major-case-cargo">涉案货物：${escapeHtml(item.cargo || '未填写')}</p><p class="major-case-reason">处罚原因：${escapeHtml(item.reason || '未分类')}</p><button class="major-case-facts-button" type="button" data-facts-id="${escapeHtml(item.id)}">查看完整违法事实</button><footer>${escapeHtml(item.decisionNo || item.id)}</footer></article>`).join('') : '<p class="major-cases-empty">当前筛选范围内暂无重大案件。</p>'}</div>`;
  target.querySelector('#close-major-cases').addEventListener('click', () => { state.majorCasesExpanded = false; renderMajorCases(state.dashboardRecords); });
}
function renderNationalObservation(records) {
  const recent = datedRecords(records, 3), recentTypeRows = topEntries(countByType(recent), 1), highType = recentTypeRows[0]?.[0] || '暂无数据';
  const highShare = recent.length && recentTypeRows[0] ? Math.round((recentTypeRows[0][1] / recent.length) * 100) : 0;
  const fastest = heatByType(records).find(item => item.delta > 0);
  const risePercent = fastest?.before ? Math.round((fastest.delta / fastest.before) * 100) : fastest?.now ? 100 : 0;
  const riseText = fastest ? `${fastest.type}案件对比前三个月，近三个月上升幅度达${risePercent}%` : '近期暂无明显上升类型';
  document.getElementById('national-observation').textContent = `近3个月，${highType}案件占比${highShare}%，为高发风险类型；${riseText}。`;
  document.getElementById('national-observation-metrics').innerHTML = `<article class="observation-stat"><strong>${escapeHtml(highType)}</strong><b>${highShare}%</b><small>近3个月案件占比</small></article><article class="observation-stat rising"><strong>${escapeHtml(fastest?.type || '暂无数据')}</strong><b>${risePercent}% <i aria-hidden="true">↑</i></b><small>相对前三个月上升</small></article>`;
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
  return `<article class="case-summary"><div class="summary-meta"><span>${escapeHtml(item.penaltyDate || '日期未填')}</span>${peerName ? `<em>同行：${escapeHtml(peerName)}</em>` : ''}</div><strong>${escapeHtml(item.cargo || '未填写涉案货物')}</strong><p>${escapeHtml(facts)}</p><footer><span>${escapeHtml(item.customs || '海关未填')} · ${escapeHtml(item.decisionNo || item.id)}</span><b>罚款 ${wan(item.fine)} 万元 · 处罚幅度 ${escapeHtml(rate(item.fineRate))}</b></footer></article>`;
}
function renderSignalDetail(meta) {
  const target = document.getElementById('signal-detail');
  if (!meta.records.length) { target.hidden = false; target.innerHTML = `<p class="signal-empty">“${escapeHtml(meta.title)}”暂未匹配到案件。同行主体库可在 <code>peer_companies.json</code> 中补充。</p>`; return; }
  const selectedType = state.activeRiskType, typeRecords = selectedType ? meta.records.filter(item => typesOf(item).includes(selectedType)) : [];
  const typeRows = topEntries(countByType(meta.records), 999), isClassification = selectedType === '商品归类' || selectedType === '固体废物', isExportControl = selectedType === '出口管制';
  const secondaryRows = topEntries(countBySecondary(typeRecords), 999), itemRows = topEntries(countBySecondaryItem(typeRecords), 999);
  const secondaryRecords = state.activeRiskSecondary ? typeRecords.filter(item => (item.reason || '未分类') === state.activeRiskSecondary) : typeRecords;
  const itemRecords = state.activeRiskItem ? typeRecords.filter(item => (item.secondaryItem || '未分类') === state.activeRiskItem) : typeRecords;
  const productSource = isExportControl ? itemRecords : (isClassification ? typeRecords : secondaryRecords);
  const productRows = topProducts(productSource, 999), selectedProduct = state.activeRiskProduct;
  let summarySource = [];
  if (selectedProduct) summarySource = productSource.filter(item => item.cargo === selectedProduct);
  else if (isExportControl && state.activeRiskItem) summarySource = itemRecords;
  else if (!isClassification && state.activeRiskSecondary) summarySource = secondaryRecords;
  const summaries = summarySource.sort((a, b) => (b.fine || 0) - (a.fine || 0) || (b.penaltyDate || '').localeCompare(a.penaltyDate || ''));
  const list = (rows, attribute, selected, extra = '') => `<ol class="signal-ranking drill-list drill-scroll">${rows.length ? rows.map(([name, count], index) => `<li><button type="button" ${attribute}="${escapeHtml(name)}" class="drill-button ${selected === name ? 'is-selected' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(name)}${extra}</span><strong>${count} 起</strong></button></li>`).join('') : '<li class="drill-placeholder">暂无可用数据</li>'}</ol>`;
  const products = `<ol class="signal-ranking drill-list drill-scroll">${productRows.length ? productRows.map((item, index) => `<li><button type="button" data-risk-product="${escapeHtml(item.cargo)}" class="drill-button product-button ${selectedProduct === item.cargo ? 'is-selected' : ''}"><b>${String(index + 1).padStart(2, '0')}</b><span>${escapeHtml(item.cargo)}${isClassification ? codesFromCases(item.records) : ''}</span><strong>${item.count} 起</strong></button></li>`).join('') : '<li class="drill-placeholder">该范围暂无具体涉案产品</li>'}</ol>`;
  const typeColumn = `<section class="drill-column"><h3>处罚类型</h3>${list(typeRows, 'data-risk-type', selectedType)}</section>`;
  const summaryColumn = `<section class="drill-column summary-column"><h3>处罚摘要</h3>${summaries.length ? `<div class="summary-list">${summaries.map(item => caseSummary(item, meta.id === 'peer')).join('')}</div>` : '<p class="drill-placeholder">请选择分类或涉案产品后查看最新五起处罚摘要。</p>'}${meta.id === 'company' && summaries[0] ? `<p class="relevance-note">公司相关度：${escapeHtml(relevanceLabel(summaries[0]))}</p>` : ''}</section>`;
  let middleColumns = '';
  if (isExportControl) {
    middleColumns = `<section class="drill-column dual-drill-column"><div class="drill-subsection"><h3>违法行为二级分类</h3>${list(secondaryRows, 'data-risk-secondary', state.activeRiskSecondary)}</div><div class="drill-subsection"><h3>涉案物项二级分类</h3>${list(itemRows, 'data-risk-item', state.activeRiskItem)}</div></section>`;
  } else if (isClassification) {
    middleColumns = `<section class="drill-column"><h3>${selectedType === '商品归类' ? '商品归类 · HS 对照' : '涉案产品'}</h3>${selectedType ? products : '<p class="drill-placeholder">请先选择处罚类型。</p>'}</section>`;
  } else {
    middleColumns = `<section class="drill-column"><h3>违法行为二级分类</h3>${selectedType ? list(secondaryRows, 'data-risk-secondary', state.activeRiskSecondary) : '<p class="drill-placeholder">请先选择处罚类型。</p>'}</section><section class="drill-column"><h3>涉案产品</h3>${state.activeRiskSecondary ? products : '<p class="drill-placeholder">请选择违法行为二级分类。</p>'}</section>`;
  }
  target.hidden = false;
  target.innerHTML = `<div class="signal-detail-head"><span>${escapeHtml(meta.tag)}</span><strong>${escapeHtml(meta.title)} · 风险钻取</strong><small>按案件数从多到少排列，可在各栏内滚动查看全部结果。</small><button class="signal-close" type="button" aria-label="收起详情">收起 ×</button></div><div class="signal-detail-grid ${isExportControl ? 'export-drill-grid' : (!isClassification ? 'secondary-drill-grid' : '')}">${typeColumn}${middleColumns}${summaryColumn}</div>`;
  target.querySelector('.signal-close').addEventListener('click', () => { state.activeSignal = ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; renderRadar(); });
  target.querySelectorAll('[data-risk-type]').forEach(button => button.addEventListener('click', () => { state.activeRiskType = button.dataset.riskType; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-secondary]').forEach(button => button.addEventListener('click', () => { state.activeRiskSecondary = button.dataset.riskSecondary; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-item]').forEach(button => button.addEventListener('click', () => { state.activeRiskItem = button.dataset.riskItem; state.activeRiskProduct = ''; renderRadar(); }));
  target.querySelectorAll('[data-risk-product]').forEach(button => button.addEventListener('click', () => { state.activeRiskProduct = button.dataset.riskProduct; renderRadar(); }));
}
function renderRadar() {
  const metas = ['national', 'company', 'peer'].map(signalMeta), target = document.getElementById('risk-radar');
  target.innerHTML = metas.map(meta => `<button type="button" class="signal-card ${state.activeSignal === meta.id ? 'is-active' : ''}" data-signal="${meta.id}" aria-expanded="${state.activeSignal === meta.id}"><div class="signal-card-top"><span>${escapeHtml(meta.tag)}</span><i aria-hidden="true">${state.activeSignal === meta.id ? '−' : '+'}</i></div><h3>${escapeHtml(meta.title)}</h3><p>${escapeHtml(meta.description)}</p><div class="signal-card-metrics"><strong>${meta.records.length} <small>起</small></strong><span>高频：${escapeHtml(meta.topType[0])}<br>产品：${escapeHtml(meta.topProduct.cargo)}</span></div></button>`).join('');
  target.querySelectorAll('[data-signal]').forEach(button => button.addEventListener('click', () => { const id = button.dataset.signal; const changing = state.activeSignal !== id; state.activeSignal = changing ? id : ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; renderRadar(); }));
  const selected = metas.find(meta => meta.id === state.activeSignal), detail = document.getElementById('signal-detail'); if (selected) renderSignalDetail(selected); else { detail.hidden = true; detail.innerHTML = ''; }
}
function typeTooltip(params, records) { const selected = records.filter(item => typesOf(item).includes(params.name)), leaders = topEntries(countBy(selected, 'customs'), 3); const lines = leaders.map(([name, value], index) => `${index + 1}. ${escapeHtml(name)}：${value} 起（${((value / Math.max(selected.length, 1)) * 100).toFixed(1)}%）`).join('<br>'); return `<strong>${escapeHtml(params.name)}</strong><br>关联案件：${params.value} 起<br><span class="tip-caption">处罚海关 TOP 3</span><br>${lines || '暂无数据'}`; }
function renderTypeBreakdown(records) {
  const target = document.getElementById('type-breakdown'), primary = state.activeChartType;
  if (!primary) { target.hidden = true; target.innerHTML = ''; return; }
  const selected = records.filter(item => typesOf(item).includes(primary)), rows = topEntries(countBySecondary(selected), 999);
  target.hidden = false;
  target.innerHTML = `<div class="type-breakdown-head"><strong>${escapeHtml(primary)} · 违法行为二级分类</strong><button type="button" id="close-type-breakdown">收起 ×</button></div><p>各二级分类占“${escapeHtml(primary)}”案件的比例。</p><ol>${rows.map(([name, count], index) => `<li><span>${String(index + 1).padStart(2, '0')} · ${escapeHtml(name)}</span><b>${count} 起 · ${((count / Math.max(selected.length, 1)) * 100).toFixed(1)}%</b></li>`).join('') || '<li>暂无二级分类数据</li>'}</ol>`;
  target.querySelector('#close-type-breakdown').addEventListener('click', () => { state.activeChartType = ''; renderTypeBreakdown(state.dashboardRecords); });
}
function customsTooltip(params, records) { const point = Array.isArray(params) ? params[0] : params, name = point?.axisValue || point?.name || '', selected = records.filter(item => item.parentCustoms === name), leaders = topEntries(countByType(selected), 3); const lines = leaders.map(([type, value], index) => `${index + 1}. ${escapeHtml(type)}：${value} 起（${((value / Math.max(selected.length, 1)) * 100).toFixed(1)}%）`).join('<br>'); return `<strong>${escapeHtml(name)}</strong><br>案件数量：${selected.length} 起<br><span class="tip-caption">处罚类型 TOP 3</span><br>${lines || '暂无数据'}`; }
function renderCharts(records) {
  const typeEntries = topEntries(countByType(records), 5), allTypes = topEntries(countByType(records), 999), rest = allTypes.slice(5).reduce((sum, [, value]) => sum + value, 0); if (rest) typeEntries.push(['其他', rest]); const customs = topEntries(countBy(records, 'parentCustoms'), 6), empty = !records.length;
  const tooltipStyle = { backgroundColor: '#102b45', borderColor: '#6ba9d7', borderWidth: 1, padding: 11, textStyle: { color: '#f5fbff', fontSize: 12, lineHeight: 19 } };
  state.charts.type.setOption({ animationDurationUpdate: 250, tooltip: { ...tooltipStyle, trigger: 'item', confine: true, formatter: params => typeTooltip(params, records) }, color: ['#1677c8', '#22a9a1', '#7667e8', '#e79245', '#d86682', '#7e9fba'], legend: { type: 'scroll', orient: 'vertical', right: 10, top: 'middle', textStyle: { color: '#506d83', fontSize: 12 } }, series: [{ type: 'pie', radius: ['44%', '68%'], center: ['33%', '52%'], label: { show: false }, itemStyle: { borderColor: '#f8fbfd', borderWidth: 2 }, data: typeEntries.map(([name, value]) => ({ name, value })) }], graphic: empty ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无案件', fill: '#7893a4', fontSize: 14 } }] : [] }, true);
  state.charts.type.setOption({ series: [{ label: { show: true, formatter: '{name|{b}}\n{percent|{d}%}', rich: { name: { color: '#315b72', fontSize: 11, lineHeight: 16 }, percent: { color: '#0f8f92', fontSize: 13, fontWeight: 'bold', lineHeight: 17 } } }, labelLine: { show: true, length: 8, length2: 6, lineStyle: { color: '#8bb6c8' } } }] });
  state.charts.customs.setOption({ animationDurationUpdate: 250, grid: { left: 10, right: 42, top: 10, bottom: 12, containLabel: true }, tooltip: { ...tooltipStyle, trigger: 'axis', confine: true, axisPointer: { type: 'shadow' }, formatter: params => customsTooltip(params, records) }, xAxis: { type: 'value', minInterval: 1, axisLabel: { color: '#647f93' }, splitLine: { lineStyle: { color: '#dce8ef' } } }, yAxis: { type: 'category', inverse: true, data: customs.map(([name]) => name), axisLabel: { color: '#34566f', width: 130, overflow: 'truncate' }, axisTick: { show: false }, axisLine: { show: false } }, series: [{ type: 'bar', barMaxWidth: 21, data: customs.map(([, value]) => value), itemStyle: { color: new echarts.graphic.LinearGradient(1, 0, 0, 0, [{ offset: 0, color: '#2078bf' }, { offset: 1, color: '#38b9af' }]), borderRadius: [0, 4, 4, 0] }, label: { show: true, position: 'right', color: '#34566f', formatter: '{c}' } }], graphic: empty ? [{ type: 'text', left: 'center', top: 'middle', style: { text: '暂无案件', fill: '#7893a4', fontSize: 14 } }] : [] }, true);
  renderTypeBreakdown(records);
}
function renderDashboard() { const records = dashboardCases(); state.dashboardRecords = records; const { start, end } = state.dashboardFilters; const statusText = start || end ? `已筛选 ${records.length.toLocaleString('zh-CN')} 起案件` : '全量公开行政处罚'; document.getElementById('dashboard-scope-status').textContent = statusText; renderMetrics(records); renderMajorCases(records); renderNationalObservation(records); renderRadar(); renderCharts(records); }
function factsCell(item) { return `<button class="reason-button" type="button" data-facts-id="${escapeHtml(item.id)}">${escapeHtml(item.reason || '未分类')}</button>`; }
function rateCell(item) { const basis = item.fineRateBasis ? `处罚幅度 = 处罚金额 ÷ ${item.fineRateBasis}` : '缺少处罚金额或适用分母'; return `<span title="${escapeHtml(basis)}">${rate(item.fineRate)}</span>`; }
function partyCell(item) { const party = item.party || '—'; return `<span class="party-name" title="${escapeHtml(party)}">${escapeHtml(party)}</span>`; }
function documentCell(item) { return item.originalUrl ? `<a class="doc-link" href="${escapeHtml(item.originalUrl)}" target="_blank" rel="noopener">原文</a>` : '<span class="doc-unavailable">暂未上传</span>'; }
function row(item) { return `<tr><td>${escapeHtml(item.decisionNo)}</td><td>${escapeHtml(item.customs)}</td><td>${escapeHtml(item.penaltyDate)}</td><td>${escapeHtml(item.violationDate)}</td><td>${partyCell(item)}</td><td>${escapeHtml(item.cargo)}</td><td>${factsCell(item)}</td><td>${escapeHtml(item.declaredCode)}</td><td>${escapeHtml(item.actualCode)}</td><td class="number-cell">${wan(item.amount)}</td><td class="number-cell">${wan(item.illegalOperationAmount)}</td><td class="number-cell">${wan(item.taxUnderpaymentAmount)}</td><td class="number-cell">${wan(item.fine)}</td><td class="number-cell">${wan(item.recoveryAmount)}</td><td class="number-cell">${rateCell(item)}</td><td>${documentCell(item)}</td></tr>`; }
function sorted(records) { const numeric = new Set(['amount', 'illegalOperationAmount', 'taxUnderpaymentAmount', 'fine', 'recoveryAmount', 'fineRate']); return records.slice().sort((left, right) => { const a = left[state.sort.field], b = right[state.sort.field], aMissing = a === null || a === undefined || a === '', bMissing = b === null || b === undefined || b === ''; if (aMissing || bMissing) return aMissing === bMissing ? 0 : (aMissing ? 1 : -1); const result = numeric.has(state.sort.field) ? Number(a) - Number(b) : String(a).localeCompare(String(b), 'zh-CN'); return state.sort.direction === 'asc' ? result : -result; }); }
function renderDetails() { const records = sorted(detailCases()), totalPages = Math.max(1, Math.ceil(records.length / state.pageSize)); state.page = Math.min(Math.max(1, state.page), totalPages); const rows = records.slice((state.page - 1) * state.pageSize, state.page * state.pageSize); document.getElementById('detail-table').innerHTML = rows.length ? rows.map(row).join('') : '<tr><td colspan="16">暂无符合条件的案件</td></tr>'; document.getElementById('detail-page-info').textContent = `第 ${state.page} / ${totalPages} 页`; document.getElementById('detail-count').textContent = `共 ${records.length} 起`; document.getElementById('detail-prev-page').disabled = state.page <= 1; document.getElementById('detail-next-page').disabled = state.page >= totalPages; document.getElementById('detail-sort-field').value = state.sort.field; document.getElementById('detail-sort-order').textContent = state.sort.direction === 'desc' ? '↓' : '↑'; }
function updateDetailFilters() { Object.entries(detailFields).forEach(([key, field]) => { state.detailFilters[key] = clean(field.value); }); state.page = 1; renderDetails(); }
function updateDashboardFilters() { state.dashboardFilters.start = clean(document.getElementById('dashboard-start-date').value); state.dashboardFilters.end = clean(document.getElementById('dashboard-end-date').value); state.activeSignal = ''; state.activeRiskType = ''; state.activeRiskSecondary = ''; state.activeRiskItem = ''; state.activeRiskProduct = ''; state.activeChartType = ''; renderDashboard(); }
function switchView(view) { state.activeView = view; const dashboard = view === 'dashboard'; document.getElementById('dashboard-panel').hidden = !dashboard; document.getElementById('details-panel').hidden = dashboard; document.getElementById('view-switch-text').textContent = dashboard ? '进入案例明细 →' : '返回风险看板'; document.getElementById('view-switch').setAttribute('aria-label', dashboard ? '进入案例明细' : '返回风险看板'); if (dashboard) setTimeout(() => Object.values(state.charts).forEach(chart => chart.resize()), 0); }
function openFacts(id) { const item = state.cases.find(caseItem => caseItem.id === id); if (!item) return; document.getElementById('facts-title').textContent = `${item.id} · ${item.reason || '违法事实'}`; document.getElementById('facts-content').textContent = item.facts || '案例库暂未填写违法事实。'; dialog.showModal(); }
function applyPayload(payload, initial = false) { const version = payload.version || `${payload.updatedAt || ''}:${(payload.cases || []).length}`; if (!initial && version === state.dataVersion) return false; state.cases = payload.cases || []; setOptions(detailFields.customs, unique(state.cases.map(item => item.parentCustoms)), '全部直属海关'); setOptions(detailFields.type, unique(state.cases.flatMap(typesOf)), '全部类型'); setOptions(detailFields.cargo, unique(state.cases.map(item => item.cargo)), '全部涉案货物'); state.dataVersion = version; if (initial) { state.charts.type = echarts.init(document.getElementById('type-chart')); state.charts.customs = echarts.init(document.getElementById('customs-chart')); state.charts.type.on('click', params => { if (params.name === '其他') return; state.activeChartType = params.name; renderTypeBreakdown(state.dashboardRecords); }); } status.textContent = `已加载 ${state.cases.length.toLocaleString('zh-CN')} 起案件`; renderDashboard(); renderDetails(); return true; }
async function loadCases(initial = false) { const inline = window.__CUSTOMS_CASES_DATA__; if (window.location.protocol === 'file:' && inline) return applyPayload(inline, initial); const response = await fetch(`./data/cases.json?version=${Date.now()}`, { cache: 'no-store' }); if (!response.ok) throw new Error('数据文件不可用'); return applyPayload(await response.json(), initial); }
async function start() { try { await loadCases(true); window.setInterval(() => loadCases().catch(error => console.warn('看板自动更新失败：', error)), 10000); } catch (error) { status.textContent = '案件数据加载失败。请确认已先生成 data/cases.json。'; console.error(error); } }
Object.values(detailFields).forEach(field => field.addEventListener('input', updateDetailFilters));
document.getElementById('dashboard-start-date').addEventListener('change', updateDashboardFilters);
document.getElementById('dashboard-end-date').addEventListener('change', updateDashboardFilters);
document.getElementById('dashboard-reset-filters').addEventListener('click', () => { document.getElementById('dashboard-start-date').value = ''; document.getElementById('dashboard-end-date').value = ''; updateDashboardFilters(); });
document.getElementById('major-cases-trigger').addEventListener('click', () => { state.majorCasesExpanded = !state.majorCasesExpanded; renderMajorCases(state.dashboardRecords); });
document.getElementById('major-cases-trigger').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.currentTarget.click(); } });
document.getElementById('detail-sort-field').addEventListener('change', event => { state.sort.field = event.target.value; renderDetails(); });
document.getElementById('detail-sort-order').addEventListener('click', () => { state.sort.direction = state.sort.direction === 'desc' ? 'asc' : 'desc'; renderDetails(); });
document.getElementById('detail-page-size').addEventListener('change', event => { state.pageSize = Number(event.target.value); state.page = 1; renderDetails(); });
document.getElementById('detail-prev-page').addEventListener('click', () => { state.page -= 1; renderDetails(); });
document.getElementById('detail-next-page').addEventListener('click', () => { state.page += 1; renderDetails(); });
document.getElementById('detail-reset-filters').addEventListener('click', () => { Object.entries(detailFields).forEach(([key, field]) => { field.value = key === 'scope' ? 'all' : ''; }); updateDetailFilters(); });
document.getElementById('view-switch').addEventListener('click', () => switchView(state.activeView === 'dashboard' ? 'details' : 'dashboard'));
document.getElementById('back-to-dashboard').addEventListener('click', () => switchView('dashboard'));
document.addEventListener('click', event => { const target = event.target.closest('[data-facts-id]'); if (target) openFacts(target.dataset.factsId); });
document.getElementById('close-dialog').addEventListener('click', () => dialog.close());
const dashboardToolbar = document.getElementById('dashboard-toolbar');
const dashboardToolbarTrigger = dashboardToolbar.getBoundingClientRect().top + window.scrollY - 70;
function updateDashboardToolbar() { dashboardToolbar.classList.toggle('is-condensed', window.scrollY > dashboardToolbarTrigger); }
window.addEventListener('scroll', updateDashboardToolbar, { passive: true });
window.addEventListener('resize', () => { Object.values(state.charts).forEach(chart => chart.resize()); updateDashboardToolbar(); });
switchView('dashboard'); start();
updateDashboardToolbar();
