'use strict';
// Pro tools for PyProject & Ruff Config View:
//   1. auditPyproject: Offline Markdown dependency-pinning, Ruff and typing audit.
//   2. diffPyprojects: Compare two pyproject.toml or ruff.toml files in Markdown.
//   3. exportDepMatrix: Non-destructive Markdown and CSV dependency and tool-config inventory export.
const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const {
  parsePyproject,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildInventoryCsv,
  buildInventoryMarkdown,
} = require('./pyprojview');

const MATCH_RE = /^(pyproject\.toml|\.?ruff\.toml)$/i;

function uniquePath(targetPath) {
  if (!fs.existsSync(targetPath)) return targetPath;
  const dir = path.dirname(targetPath);
  const ext = path.extname(targetPath);
  const base = path.basename(targetPath, ext);
  for (let i = 1; i < 10000; i += 1) {
    const cand = path.join(dir, `${base}-${i}${ext}`);
    if (!fs.existsSync(cand)) return cand;
  }
  return path.join(dir, `${base}-${Date.now()}${ext}`);
}

async function resolveTargetUri(uri, provider, openLabel = 'Select pyproject.toml or ruff.toml file') {
  if (uri && uri.scheme) return uri;
  if (provider && provider.active && provider.active.uri) return provider.active.uri;
  const ed = vscode.window.activeTextEditor;
  if (ed && ed.document && MATCH_RE.test(path.basename(ed.document.uri.fsPath || ed.document.uri.path))) {
    return ed.document.uri;
  }
  const picked = await vscode.window.showOpenDialog({
    canSelectMany: false,
    filters: { 'Python TOML Config': ['toml'] },
    openLabel,
  });
  return picked && picked[0] ? picked[0] : null;
}

function listPyprojectFilesInDir(dirPath, maxDepth = 4) {
  const out = [];
  function walk(dir, depth) {
    if (depth > maxDepth) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.venv' || e.name === 'venv' || e.name === '__pycache__') continue;
      const full = path.join(dir, e.name);
      if (e.isFile() && MATCH_RE.test(e.name)) out.push(full);
      else if (e.isDirectory() && depth < maxDepth) walk(full, depth + 1);
    }
  }
  walk(dirPath, 0);
  return out.sort();
}

function createTools({ provider, pro, reach }) {
  async function auditPyproject(uri, opts = {}) {
    if (!(await pro.allowed('auditPyproject', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const isDir = target.scheme === 'file' && fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
    const files = isDir ? listPyprojectFilesInDir(targetPath) : [targetPath];
    if (!files.length) {
      vscode.window.showInformationMessage('No matching pyproject.toml or ruff.toml files were found in this folder.');
      return undefined;
    }

    const entries = [];
    for (const f of files) {
      const buf = f === targetPath && target.scheme !== 'file'
        ? Buffer.from(await vscode.workspace.fs.readFile(target))
        : fs.readFileSync(f);
      const label = isDir ? path.relative(targetPath, f) : path.basename(f);
      entries.push({ fileName: label, parsed: parsePyproject(buf, label) });
    }
    const md = buildAuditMarkdown(entries);
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('auditPyproject');
    if (reach) reach.refresh();
    return { files: files.length, markdown: md };
  }

  async function diffPyprojects(uri, opts = {}) {
    if (!(await pro.allowed('diffPyprojects', opts))) return undefined;
    const left = await resolveTargetUri(uri, provider, 'Select baseline pyproject.toml or ruff.toml file');
    if (!left) return undefined;

    let right = opts.compareUri || null;
    if (!right) {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Python TOML Config': ['toml'] },
        openLabel: 'Select second pyproject.toml or ruff.toml file to compare',
      });
      right = picked && picked[0] ? picked[0] : null;
    }
    if (!right) return undefined;

    const leftBuf = Buffer.from(await vscode.workspace.fs.readFile(left));
    const rightBuf = Buffer.from(await vscode.workspace.fs.readFile(right));
    const leftName = path.basename(left.fsPath || left.path);
    const rightName = path.basename(right.fsPath || right.path);
    const md = buildDiffMarkdown(
      leftName,
      parsePyproject(leftBuf, leftName),
      rightName,
      parsePyproject(rightBuf, rightName),
    );
    const doc = await vscode.workspace.openTextDocument({ content: md, language: 'markdown' });
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('diffPyprojects');
    if (reach) reach.refresh();
    return { markdown: md };
  }

  async function exportDepMatrix(uri, opts = {}) {
    if (!(await pro.allowed('exportDepMatrix', opts))) return undefined;
    const target = await resolveTargetUri(uri, provider);
    if (!target) return undefined;

    const targetPath = target.fsPath;
    const bytes = await vscode.workspace.fs.readFile(target);
    const baseName = path.basename(targetPath);
    const parsed = parsePyproject(Buffer.from(bytes), baseName);
    const stemRaw = baseName.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'pyproject';
    const defaultOut = uniquePath(path.join(path.dirname(targetPath), `${stemRaw}.deps.csv`));
    const saveUri = opts.outPath
      ? vscode.Uri.file(uniquePath(opts.outPath))
      : await vscode.window.showSaveDialog({
        defaultUri: vscode.Uri.file(defaultOut),
        filters: { 'CSV Dependency Matrix': ['csv'] },
        saveLabel: 'Save Markdown and CSV dependency matrix',
      });
    if (!saveUri) return undefined;

    const csvPath = uniquePath(saveUri.fsPath);
    const dir = path.dirname(csvPath);
    const stem = path.basename(csvPath, '.csv').replace(/\.deps$/i, '');
    const mdPath = uniquePath(path.join(dir, `${stem}.deps.md`));

    fs.writeFileSync(csvPath, buildInventoryCsv(parsed), 'utf8');
    fs.writeFileSync(mdPath, buildInventoryMarkdown(parsed, baseName), 'utf8');

    const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(mdPath));
    await vscode.window.showTextDocument(doc, { preview: false });
    await pro.produced('exportDepMatrix');
    if (reach) reach.refresh();
    return { files: [csvPath, mdPath], entries: parsed.stats.rowCount };
  }

  return { auditPyproject, diffPyprojects, exportDepMatrix };
}

module.exports = { createTools, uniquePath, listPyprojectFilesInDir };
