'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  parsePyproject,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildInventoryMarkdown,
  buildInventoryCsv,
} = require('../src/pyprojview');
const { PyProjectViewModel } = require('../src/view');
const { editorHtml, csp } = require('../src/html');

const pySamplePath = path.join(__dirname, '..', 'samples', 'pyproject.toml');
const ruffSamplePath = path.join(__dirname, '..', 'samples', 'ruff.toml');
const pyText = fs.readFileSync(pySamplePath, 'utf8');
const ruffText = fs.readFileSync(ruffSamplePath, 'utf8');

test('parsePyproject parses project, optional-dependencies, poetry groups, build-system, scripts and tool tables', () => {
  const p = parsePyproject(pyText, 'pyproject.toml');
  assert.equal(p.fileKind, 'pyproject.toml');
  assert.equal(p.projectName, 'acme-analytics-api');
  assert.equal(p.projectVersion, '1.4.0');
  assert.equal(p.buildBackend, 'hatchling.build');
  assert.ok(p.dependencies.length >= 7);
  assert.equal(p.scripts.length, 1);
  assert.equal(p.scripts[0].name, 'acme-api');
  assert.ok(p.toolSettings.some((t) => t.tool === 'ruff'));
  assert.ok(p.toolSettings.some((t) => t.tool === 'mypy'));
  assert.ok(p.toolSettings.some((t) => t.tool === 'pytest'));
});

test('static findings catch unpinned deps, missing requires-python, disabled ruff S rules, mypy untyped defs and plaintext creds', () => {
  const p = parsePyproject(pyText, 'pyproject.toml');
  const rules = new Set(p.findings.map((f) => f.rule));
  assert.ok(rules.has('unpinned-wildcard-dep'));
  assert.ok(rules.has('missing-requires-python'));
  assert.ok(rules.has('disabled-ruff-security'));
  assert.ok(rules.has('mypy-untyped-defs'));
  assert.ok(rules.has('plaintext-index-credentials'));
});

test('clean standalone ruff.toml produces zero static findings', () => {
  const p = parsePyproject(ruffText, 'ruff.toml');
  assert.equal(p.fileKind, 'ruff.toml');
  assert.equal(p.findings.length, 0);
  assert.ok(p.toolSettings.length >= 4);
});

test('clean pyproject.toml with requires-python and pinned deps produces zero findings', () => {
  const clean = `
[build-system]
requires = ["setuptools>=75.0"]
build-backend = "setuptools.build_meta"

[project]
name = "clean-pkg"
version = "0.2.0"
requires-python = ">=3.11"
dependencies = ["httpx>=0.27.0,<1.0"]

[tool.ruff.lint]
select = ["E", "F", "S"]
ignore = ["E501"]

[tool.mypy]
disallow_untyped_defs = true
`;
  const p = parsePyproject(clean, 'pyproject.toml');
  assert.equal(p.findings.length, 0);
  assert.equal(p.requiresPython, '>=3.11');
});

test('PyProjectViewModel filters by category, findings and search text', () => {
  const p = parsePyproject(pyText, 'pyproject.toml');
  const vm = new PyProjectViewModel(p, 'pyproject.toml', pyText.length);
  assert.equal(vm.totalCount(), p.rows.length);
  assert.ok(vm.setFilter({ kind: 'dependency' }) >= 7);
  assert.ok(vm.setFilter({ kind: 'tool' }) >= 5);
  assert.ok(vm.setFilter({ kind: 'findings' }) >= 3);
  assert.ok(vm.setFilter({ text: 'fastapi' }) >= 1);
  const d = vm.detail(1);
  assert.ok(d && d.name && Array.isArray(d.attrs));
});

test('buildAuditMarkdown, buildDiffMarkdown, buildInventoryMarkdown and buildInventoryCsv produce valid output', () => {
  const left = parsePyproject(pyText, 'pyproject.toml');
  const right = parsePyproject(ruffText, 'ruff.toml');
  const audit = buildAuditMarkdown([{ fileName: 'pyproject.toml', parsed: left }]);
  assert.ok(audit.includes('# PyProject Dependency-Pinning, Ruff & Typing Audit'));
  assert.ok(audit.includes('plaintext-index-credentials'));

  const diff = buildDiffMarkdown('pyproject.toml', left, 'ruff.toml', right);
  assert.ok(diff.includes('Changed'));
  assert.ok(diff.includes('Dependency Changes'));

  const md = buildInventoryMarkdown(left, 'pyproject.toml');
  assert.ok(md.includes('## Dependencies'));
  assert.ok(md.includes('fastapi'));

  const csv = buildInventoryCsv(left);
  assert.ok(csv.startsWith('Category,Section,Name,Value,Status,Line\n'));
  assert.ok(csv.includes('fastapi'));
});

test('editorHtml enforces strict CSP with nonce', () => {
  const c = csp('vscode-webview:', 'abc123');
  assert.ok(c.includes("default-src 'none'"));
  assert.ok(c.includes("script-src 'nonce-abc123'"));
  const html = editorHtml({ cspSource: 'vscode-webview:', script: 'v.js', styleUri: 'v.css', title: 'pyproject.toml', nonce: 'abc123' });
  assert.ok(html.includes('nonce="abc123"'));
  assert.ok(html.includes('zovoPyprojview.getPro'));
});
