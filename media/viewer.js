/* global acquireVsCodeApi */
(function () {
  'use strict';
  const vscode = acquireVsCodeApi();
  const app = document.getElementById('app');

  let state = {
    name: '',
    summary: null,
    pageSize: 100,
    page: 0,
    total: 0,
    rows: [],
    selected: null,
    tab: 'entries',
    req: 0,
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function post(msg) {
    state.req += 1;
    vscode.postMessage({ ...msg, req: state.req });
  }

  function fmtSize(n) {
    if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${n} B`;
  }

  function renderShell() {
    const s = state.summary;
    const errChip = s.findingErrors > 0 ? `<span class="chip bad"><b>Errors:</b> ${s.findingErrors}</span>` : '<span class="chip"><b>Errors:</b> 0</span>';
    const warnChip = s.findingWarnings > 0 ? `<span class="chip warn"><b>Warnings:</b> ${s.findingWarnings}</span>` : '';

    app.innerHTML = `
      <div class="top">
        <div class="title">
          <span class="name">${esc(state.name)}</span>
          <span class="kind">${esc(s.fileKind)} · ${esc(s.projectName)} · python ${esc(s.requiresPython)} · ${s.totalLines} lines · ${fmtSize(s.fileSize)} · 100% offline</span>
        </div>
        <div class="summary">
          <span class="chip"><b>Entries:</b> ${s.rowCount}</span>
          <span class="chip"><b>Deps:</b> ${s.depCount}</span>
          <span class="chip"><b>Groups:</b> ${s.groupCount}</span>
          <span class="chip"><b>Tool Opts:</b> ${s.toolCount}</span>
          <span class="chip"><b>Scripts:</b> ${s.scriptCount}</span>
          ${errChip}${warnChip}
        </div>
        <div class="toolbar">
          <input id="q" type="search" placeholder="Filter by package, ruff, mypy, pytest, script..." />
          <select id="kindFilter">
            <option value="">All sections</option>
            <option value="dependency">Dependencies</option>
            <option value="tool">Ruff, Mypy &amp; Pytest</option>
            <option value="build-script">Build &amp; Scripts</option>
            <option value="findings">With Findings</option>
          </select>
          <button id="filterBtn" type="button">Filter</button>
          <span class="sep"></span>
          <div id="protools"></div>
        </div>
        <div class="tabs">
          <button class="tab on" data-tab="entries" type="button">All Entries (${s.rowCount})</button>
          <button class="tab" data-tab="deps" type="button">Dependencies (${(s.dependencies || []).length})</button>
          <button class="tab" data-tab="tools" type="button">Ruff / Mypy / Pytest (${(s.toolSettings || []).length})</button>
          <button class="tab" data-tab="build" type="button">Build &amp; Scripts (${(s.buildSystem || []).length + (s.scripts || []).length})</button>
          <button class="tab" data-tab="findings" type="button">Findings (${(s.findings || []).length})</button>
        </div>
        <div id="hint" class="hint"></div>
      </div>
      <div class="main">
        <div id="leftPane" class="tablewrap"></div>
        <div id="detail" class="detail"><p class="muted">Select an entry to inspect its TOML definition and findings.</p></div>
      </div>
      <div class="pager">
        <button id="prev" type="button">Prev</button>
        <span id="pageInfo"></span>
        <button id="next" type="button">Next</button>
      </div>
    `;

    const q = document.getElementById('q');
    const kSel = document.getElementById('kindFilter');
    const runFilter = () => {
      state.page = 0;
      post({ type: 'filter', filter: { text: q.value, kind: kSel.value } });
    };
    document.getElementById('filterBtn').addEventListener('click', runFilter);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') runFilter(); });
    kSel.addEventListener('change', runFilter);

    document.querySelectorAll('.tab').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((b) => b.classList.remove('on'));
        btn.classList.add('on');
        state.tab = btn.dataset.tab;
        renderPane();
      });
    });

    document.getElementById('prev').addEventListener('click', () => {
      if (state.page > 0) { state.page -= 1; loadPage(); }
    });
    document.getElementById('next').addEventListener('click', () => {
      if ((state.page + 1) * state.pageSize < state.total) { state.page += 1; loadPage(); }
    });
  }

  function loadPage() {
    post({ type: 'page', from: state.page * state.pageSize, n: state.pageSize });
  }

  function bindRowClicks(left) {
    left.querySelectorAll('tbody tr[data-idx]').forEach((tr) => {
      tr.addEventListener('click', () => {
        const idx = Number(tr.dataset.idx);
        state.selected = idx;
        left.querySelectorAll('tbody tr').forEach((row) => row.classList.toggle('sel', Number(row.dataset.idx) === idx));
        post({ type: 'detail', index: idx });
      });
    });
  }

  function renderPane() {
    const left = document.getElementById('leftPane');
    const pager = document.querySelector('.pager');
    const s = state.summary;

    if (state.tab === 'deps') {
      pager.style.display = 'none';
      const dRows = (s.dependencies || []).map((d) => `<tr>
        <td class="num">${d.line}</td>
        <td><strong>${esc(d.group)}</strong></td>
        <td><code>${esc(d.name)}</code></td>
        <td><code>${esc(d.spec)}</code></td>
        <td>${esc(d.source)}</td>
      </tr>`).join('');
      left.innerHTML = `<table id="grid">
        <thead><tr><th class="num">Line</th><th>Group</th><th>Package</th><th>Specifier</th><th>Source</th></tr></thead>
        <tbody>${dRows || '<tr><td colspan="5" class="muted">No dependencies declared in this file.</td></tr>'}</tbody>
      </table>`;
      return;
    }

    if (state.tab === 'tools') {
      pager.style.display = 'none';
      const tRows = (s.toolSettings || []).map((t) => `<tr>
        <td class="num">${t.line}</td>
        <td><strong>${esc(t.tool)}</strong></td>
        <td><code>[${esc(t.section)}]</code></td>
        <td><code>${esc(t.key)}</code></td>
        <td><code>${esc(t.value)}</code></td>
      </tr>`).join('');
      left.innerHTML = `<table id="grid">
        <thead><tr><th class="num">Line</th><th>Tool</th><th>Section</th><th>Option</th><th>Value</th></tr></thead>
        <tbody>${tRows || '<tr><td colspan="5" class="muted">No Ruff, Mypy, Pytest or uv tool settings found.</td></tr>'}</tbody>
      </table>`;
      return;
    }

    if (state.tab === 'build') {
      pager.style.display = 'none';
      const bRows = (s.buildSystem || []).map((b) => `<tr>
        <td class="num">${b.line}</td>
        <td><strong>build-system</strong></td>
        <td><code>${esc(b.key)}</code></td>
        <td><code>${esc(b.value)}</code></td>
      </tr>`).join('');
      const scRows = (s.scripts || []).map((sc) => `<tr>
        <td class="num">${sc.line}</td>
        <td><strong>${esc(sc.section)}</strong></td>
        <td><code>${esc(sc.name)}</code></td>
        <td><code>${esc(sc.target)}</code></td>
      </tr>`).join('');
      left.innerHTML = `<table id="grid">
        <thead><tr><th class="num">Line</th><th>Section</th><th>Key / Script</th><th>Target / Value</th></tr></thead>
        <tbody>${(bRows + scRows) || '<tr><td colspan="4" class="muted">No build-system or script entrypoints declared.</td></tr>'}</tbody>
      </table>`;
      return;
    }

    if (state.tab === 'findings') {
      pager.style.display = 'none';
      const fRows = (s.findings || []).map((f) => `<tr>
        <td class="${f.severity === 'error' ? 'bad' : 'warn-text'}"><strong>${esc(f.severity.toUpperCase())}</strong></td>
        <td>${esc(f.category)}</td>
        <td><code>${esc(f.rule)}</code></td>
        <td class="num">${f.line}</td>
        <td><code>${esc(f.target)}</code></td>
        <td>${esc(f.message)}</td>
      </tr>`).join('');
      left.innerHTML = fRows
        ? `<table id="grid"><thead><tr><th>Severity</th><th>Category</th><th>Rule</th><th class="num">Line</th><th>Target</th><th>Finding</th></tr></thead><tbody>${fRows}</tbody></table>`
        : '<p class="muted" style="padding:12px;">No static pinning, Ruff security, typing or credential findings.</p>';
      return;
    }

    pager.style.display = 'flex';
    const body = state.rows.map((r) => {
      const sel = state.selected === r.index ? ' class="sel"' : '';
      const badge = r.badge ? `<span class="badge-muted">${esc(r.badge)}</span>` : '';
      const statusCls = r.errorCount > 0 ? 'bad' : (r.warningCount > 0 ? 'warn-text' : 'ok');
      return `<tr data-idx="${r.index}"${sel}>
        <td class="num">${r.line}</td>
        <td class="${statusCls}"><strong>${esc(r.kind)}</strong>${badge}</td>
        <td><code>${esc(r.name)}</code></td>
        <td><code>${esc(r.signature)}</code></td>
        <td>${esc(r.risk)}</td>
      </tr>`;
    }).join('');
    left.innerHTML = `<table id="grid">
      <thead><tr><th class="num">Line</th><th>Category</th><th>Item</th><th>Value / Specifier</th><th>Status</th></tr></thead>
      <tbody>${body || '<tr><td colspan="5" class="muted">No matching config entries.</td></tr>'}</tbody>
    </table>`;
    bindRowClicks(left);

    const pages = Math.max(1, Math.ceil(state.total / state.pageSize));
    document.getElementById('pageInfo').textContent = `Page ${state.page + 1} of ${pages} (${state.total} items)`;
    document.getElementById('prev').disabled = state.page <= 0;
    document.getElementById('next').disabled = (state.page + 1) * state.pageSize >= state.total;
  }

  function renderDetail(d) {
    const el = document.getElementById('detail');
    if (!d) {
      el.innerHTML = '<p class="muted">No item selected.</p>';
      return;
    }
    const attrRows = (d.attrs || []).map((a) => `<tr><td><strong>${esc(a.key)}</strong></td><td><code>${esc(a.value)}</code></td></tr>`).join('');
    const findHtml = (d.findings && d.findings.length)
      ? '<div class="attr-head"><strong>Findings</strong></div>' + d.findings.map((f) => `<div class="error" style="margin:4px 0;padding:6px 10px;"><strong>${esc(f.rule)}</strong>: ${esc(f.message)}</div>`).join('')
      : '';
    const rawHtml = d.raw ? `<div class="attr-head"><strong>TOML Source</strong></div><pre class="trace">${esc(d.raw)}</pre>` : '';

    el.innerHTML = `
      <div class="dhead"><strong>Line ${d.line}: ${esc(d.name)}</strong><span>${esc(d.badge || '')}</span></div>
      <table class="splits"><thead><tr><th>Property</th><th>Value</th></tr></thead><tbody>${attrRows}</tbody></table>
      ${findHtml}${rawHtml}
    `;
  }

  window.addEventListener('message', (ev) => {
    const m = ev.data;
    if (!m || typeof m !== 'object') return;
    switch (m.type) {
      case 'init':
        if (m.error) {
          app.innerHTML = `<div class="error"><strong>Could not open ${esc(m.name)}</strong><p>${esc(m.error)}</p></div>`;
          return;
        }
        state.name = m.name;
        state.summary = m.summary;
        state.pageSize = m.pageSize || 100;
        state.page = 0;
        renderShell();
        loadPage();
        return;
      case 'pageResult':
        state.total = m.total;
        state.rows = m.rows || [];
        renderPane();
        if (state.rows.length && state.selected == null) {
          state.selected = state.rows[0].index;
          post({ type: 'detail', index: state.selected });
        }
        return;
      case 'filterResult':
        state.total = m.count;
        document.getElementById('hint').textContent = m.count < m.total ? `Showing ${m.count} of ${m.total} items.` : '';
        loadPage();
        return;
      case 'detailResult':
        renderDetail(m.detail);
        return;
      case 'zovoAlso': {
        const anchor = m.anchor && document.getElementById(m.anchor);
        if (anchor && m.html) {
          const old = document.querySelector('.zovo-also');
          if (old) old.remove();
          anchor.insertAdjacentHTML('afterend', m.html);
        }
        return;
      }
      case 'hint':
        if (document.getElementById('hint')) document.getElementById('hint').textContent = m.text || '';
        return;
      default:
    }
  });

  post({ type: 'ready' });
})();
