'use strict';
// View model for PyProject & Ruff Config View: pagination and filtering by category, findings and text.

class PyProjectViewModel {
  constructor(parsed, name, fileSize) {
    this.parsed = parsed;
    this.name = name;
    this.fileSize = fileSize;
    this.filter = { text: '', kind: '' };
    this.filtered = parsed.rows.slice();
  }

  summary() {
    const p = this.parsed;
    const s = p.stats;
    return {
      name: this.name,
      fileSize: this.fileSize,
      fileKind: p.fileKind,
      projectName: p.projectName,
      projectVersion: p.projectVersion,
      requiresPython: p.requiresPython,
      buildBackend: p.buildBackend,
      totalLines: p.totalLines,
      rowCount: s.rowCount,
      depCount: s.depCount,
      groupCount: s.groupCount,
      toolCount: s.toolCount,
      scriptCount: s.scriptCount,
      findingErrors: s.findingErrors,
      findingWarnings: s.findingWarnings,
      dependencies: p.dependencies,
      toolSettings: p.toolSettings,
      scripts: p.scripts,
      buildSystem: p.buildSystem,
      findings: p.findings,
    };
  }

  totalCount() {
    return this.parsed.rows.length;
  }

  count() {
    return this.filtered.length;
  }

  setFilter(f) {
    const text = f && typeof f.text === 'string' ? f.text.trim().toLowerCase() : '';
    const kind = f && typeof f.kind === 'string' ? f.kind.trim() : '';
    this.filter = { text, kind };
    this.filtered = this.parsed.rows.filter((r) => {
      if (kind === 'dependency' && r.kind !== 'dependency') return false;
      if (kind === 'tool' && r.kind !== 'ruff' && r.kind !== 'mypy' && r.kind !== 'pytest' && r.kind !== 'tool') return false;
      if (kind === 'build-script' && r.kind !== 'build' && r.kind !== 'script' && r.kind !== 'project') return false;
      if (kind === 'findings' && !r.errorCount && !r.warningCount) return false;
      if (text) {
        const hay = `${r.name} ${r.kind} ${r.section} ${r.signature} ${r.badge} ${r.raw}`.toLowerCase();
        if (!hay.includes(text)) return false;
      }
      return true;
    });
    return this.filtered.length;
  }

  rows(from, limit) {
    const start = Math.max(0, Number(from) || 0);
    const n = Math.max(1, Math.min(500, Number(limit) || 100));
    return this.filtered.slice(start, start + n).map((r) => ({
      index: r.index,
      line: r.line,
      name: r.name,
      kind: r.kind,
      section: r.section,
      signature: r.signature,
      badge: r.badge,
      risk: r.risk,
      errorCount: r.errorCount,
      warningCount: r.warningCount,
    }));
  }

  detail(index) {
    const r = this.parsed.rows.find((x) => x.index === index) || this.parsed.rows[0] || null;
    if (!r) return null;
    return {
      index: r.index,
      line: r.line,
      name: r.name,
      kind: r.kind,
      section: r.section,
      badge: r.badge,
      risk: r.risk,
      raw: r.raw,
      findings: r.findings,
      attrs: r.attrs,
    };
  }
}

module.exports = { PyProjectViewModel };
