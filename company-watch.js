/* 仅点击COMPANY图标进入关注企业；原公司产品风险钻取保持默认。 */
(() => {
  function groups() { return state.watchedCompanies || []; }
  const keyOf = item => item.watchCaseKey || item.id;
  function records(group) { const keys = new Set(group.caseKeys || group.caseIds || []), seen = new Set(); return state.dashboardRecords.filter(item => { const key = keyOf(item); if (!keys.has(key) || seen.has(key)) return false; seen.add(key); return true; }); }
  const disclosed = item => item.disclosureStatus === '公示';
  const badge = items => items.some(disclosed) ? '<span class="watch-public-badge">公示</span>' : '';
  function yearCounts(items) { return topEntries(countBy(items.map(item => ({ year: (item.penaltyDate || '').slice(0, 4) || '日期未填' })), 'year'), 999).sort((a, b) => b[0].localeCompare(a[0])); }
  function currentGroup(available) { return available.find(group => group.id === state.watchCompanyKey) || available[0]; }
  function total(records) { return records.reduce((sum, item) => sum + (penaltyTotal(item) || 0), 0); }
  function openDetails(group, label, options = {}) {
    let start = state.dashboardFilters.start, end = state.dashboardFilters.end;
    if (options.year) {
      start = start && start > `${options.year}-01-01` ? start : `${options.year}-01-01`;
      end = end && end < `${options.year}-12-31` ? end : `${options.year}-12-31`;
    }
    state.watchDetail = { companyId: group.id, caseKey: options.caseKey || '', undated: !!options.undated, disclosedOnly: !!options.disclosedOnly, label };
    state.detailFilters = { start, end, query: '', customs: '', penaltyCustoms: '', type: options.primary || '', secondary: options.secondary || '', scope: 'all' };
    Object.entries(detailFields).forEach(([key, field]) => { field.value = state.detailFilters[key] || ''; });
    syncPenaltyCustomsOptions(); state.page = 1; renderDetails(); switchView('details');
  }
  function bindEntry(target) {
    target.querySelector('[data-company-watch]')?.addEventListener('click', event => {
      event.stopPropagation(); state.watchMode = true; renderRadar();
    });
  }
  function render(target) {
    const visibleGroups = groups().map((group, index) => ({ group, index, cases: records(group) }))
      .filter(entry => entry.cases.length > 0)
      .sort((a, b) => b.cases.filter(disclosed).length - a.cases.filter(disclosed).length || a.index - b.index)
      .map(entry => entry.group);
    const selected = currentGroup(visibleGroups);
    state.watchCompanyKey = selected?.id || "";
    const selectedRecords = selected ? records(selected) : [];
    const publicRecords = selectedRecords.filter(disclosed);
    const years = yearCounts(selectedRecords), publicYears = yearCounts(publicRecords);
    const pairMap = new Map();
    selectedRecords.forEach(item => {
      const seen = new Set();
      classificationPairsOf(item).forEach(pair => {
        const key = JSON.stringify([pair.primary, pair.secondary]);
        if (seen.has(key)) return; seen.add(key);
        const entry = pairMap.get(key) || { ...pair, count: 0 }; entry.count++; pairMap.set(key, entry);
      });
    });
    const reasons = [...pairMap.values()].sort((a, b) => b.count - a.count);
    const missing = selectedRecords.filter(item => !Number.isFinite(penaltyTotal(item))).length;
    const ordered = selectedRecords.slice().sort((a, b) => (b.penaltyDate || '').localeCompare(a.penaltyDate || '') || String(a.id).localeCompare(String(b.id)));
    target.hidden = false;
    target.innerHTML = `<div class="signal-detail-head"><span>COMPANY</span><strong>关注企业 · 行政处罚报告</strong><button type="button" class="watch-back">返回公司产品风险</button><button class="signal-close" type="button">收起 ×</button></div><div class="watch-report"><aside class="watch-companies"><h3>公司（当事人）</h3><p class="watch-note">沿用看板处罚日期范围。</p>${visibleGroups.map((group, index) => {
      const cases = records(group);
      return `<div class="watch-company ${group.id === selected?.id ? 'is-selected' : ''}"><button type="button" data-watch-select="${index}" title="展开该企业报告">${escapeHtml(group.name)} ${badge(cases)}</button><div><button type="button" data-watch-all="${index}">${cases.length} 起 · 查看案件</button><span>${wan(total(cases))} 万元</span></div></div>`;
    }).join('') || (groups().length ? '<p class="drill-placeholder">当前日期范围内暂无关注企业的处罚案件。</p>' : '<p class="drill-placeholder">请在案例库“关注企业”Sheet填写公司全称，保存后重建看板。</p>')}</aside><section class="watch-main">${selected ? `<div class="watch-company-title"><button type="button" data-watch-current>${escapeHtml(selected.name)} ${badge(selectedRecords)}</button><small>公司全称及已填写的曾用名／别名精确匹配</small></div><div class="watch-stats"><button type="button" data-watch-total><span>处罚总次数</span><strong>${selectedRecords.length} 起</strong></button><button type="button" data-watch-money><span>处罚合计（万元）</span><strong>${wan(total(selectedRecords))}</strong><small>罚款＋追缴${missing ? `；${missing} 起金额未填，未计入合计` : ''}</small></button><div class="watch-years"><span>处罚次数 · 按处罚年份</span>${years.map(([year, count]) => `<button type="button" data-watch-year="${escapeHtml(year)}">${escapeHtml(year)}：${count} 起</button>`).join('') || '<small>暂无处罚记录</small>'}</div><button type="button" data-watch-public><span>公示总次数</span><strong>${publicRecords.length} 起</strong></button><div class="watch-years"><span>公示次数 · 按处罚年份</span>${publicYears.map(([year, count]) => `<button type="button" data-watch-public-year="${escapeHtml(year)}">${escapeHtml(year)}：${count} 起</button>`).join('') || '<small>暂无公示记录</small>'}</div></div><div class="watch-content"><section><h3>处罚原因</h3><div class="watch-reasons">${reasons.map((pair, index) => `<button type="button" data-watch-reason="${index}"><span>${escapeHtml(pair.primary)} · ${escapeHtml(pair.secondary || '未填写二级分类')}</span><b>${pair.count} 起</b></button>`).join('') || '<p class="drill-placeholder">当前范围暂无处罚原因。</p>'}</div></section><section><h3>处罚摘要</h3><div class="watch-summaries">${ordered.map((item, index) => `<article class="case-summary"><div class="summary-meta"><span>${escapeHtml(item.penaltyDate || '日期未填')}</span><span>${escapeHtml(item.party)}</span></div><button type="button" class="watch-case-title" data-watch-case="${index}">${escapeHtml(item.decisionNo || item.id)}</button><p>${escapeHtml(item.facts || item.reason || '未填写处罚摘要')}</p><footer><span>${escapeHtml(item.customs)}</span><b>处罚合计 ${wan(penaltyTotal(item))} 万元</b></footer><button type="button" class="watch-case-open" data-watch-case="${index}">查看该案明细 →</button></article>`).join('') || '<p class="drill-placeholder">当前筛选范围暂无该企业的行政处罚。</p>'}</div></section></div>` : (groups().length ? '<p class="watch-empty">当前看板日期范围内暂无关注企业的行政处罚。</p>' : '<p class="watch-empty">关注名单尚未填写。填写后，历史处罚会在此展示；只有名单首次读取后新入库的案件才发送邮件。</p>')}</section></div>`;
    target.querySelector('.watch-back').addEventListener('click', () => { state.watchMode = false; renderRadar(); });
    target.querySelector('.signal-close').addEventListener('click', () => { state.watchMode = false; state.activeSignal = ''; renderRadar(); });
    target.querySelectorAll('[data-watch-select]').forEach(button => button.addEventListener('click', () => { state.watchCompanyKey = visibleGroups[Number(button.dataset.watchSelect)].id; renderRadar(); }));
    target.querySelectorAll('[data-watch-all]').forEach(button => button.addEventListener('click', () => { const group = visibleGroups[Number(button.dataset.watchAll)]; openDetails(group, group.name); }));
    ['[data-watch-current]', '[data-watch-total]', '[data-watch-money]'].forEach(selector => target.querySelector(selector)?.addEventListener('click', () => openDetails(selected, selected.name)));
    target.querySelectorAll('[data-watch-year]').forEach(button => button.addEventListener('click', () => {
      const year = button.dataset.watchYear;
      if (/^\d{4}$/.test(year)) openDetails(selected, `${selected.name} · ${year}年`, { year });
      else openDetails(selected, `${selected.name} · 日期未填`, { undated: true });
    }));
    target.querySelector('[data-watch-public]')?.addEventListener('click', () => openDetails(selected, `${selected.name} · 公示案件`, { disclosedOnly: true }));
    target.querySelectorAll('[data-watch-public-year]').forEach(button => button.addEventListener('click', () => {
      const year = button.dataset.watchPublicYear;
      openDetails(selected, `${selected.name} · ${year} · 公示案件`, /^\d{4}$/.test(year) ? { year, disclosedOnly: true } : { undated: true, disclosedOnly: true });
    }));
    target.querySelectorAll('[data-watch-reason]').forEach(button => button.addEventListener('click', () => { const pair = reasons[Number(button.dataset.watchReason)]; openDetails(selected, selected.name, pair); }));
    target.querySelectorAll('[data-watch-case]').forEach(button => button.addEventListener('click', () => { const item = ordered[Number(button.dataset.watchCase)]; openDetails(selected, `${selected.name} · ${item.decisionNo || item.id}`, { caseKey: keyOf(item) }); }));
  }
  function matchesDetail(item) {
    const filter = state.watchDetail;
    if (!filter) return true;
    const group = groups().find(value => value.id === filter.companyId);
    const key = keyOf(item);
    return !!group && (group.caseKeys || group.caseIds || []).includes(key) && (!filter.caseKey || filter.caseKey === key) && (!filter.undated || !item.penaltyDate) && (!filter.disclosedOnly || disclosed(item)) && state.cases.find(value => keyOf(value) === key) === item;
  }
  function renderDetailFilter() {
    let element = document.getElementById('detail-watch-filter');
    if (!element) { element = document.createElement('div'); element.id = 'detail-watch-filter'; element.className = 'detail-behavior-filter'; document.getElementById('detail-behavior-filter').before(element); }
    element.hidden = !state.watchDetail;
    element.innerHTML = state.watchDetail ? `关注企业：<strong>${escapeHtml(state.watchDetail.label)}</strong> <button type="button">取消企业筛选</button>` : '';
    element.querySelector('button')?.addEventListener('click', () => { state.watchDetail = null; state.page = 1; renderDetails(); });
  }
  window.CustomsCompanyWatch = { render, bindEntry, matchesDetail, renderDetailFilter };
})();
