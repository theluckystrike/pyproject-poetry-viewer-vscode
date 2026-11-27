'use strict';
// Offline static TOML parser, dependency/group explorer, Ruff/Mypy/Pytest config table,
// build-system & script entrypoint map, and findings analyzer for pyproject.toml, ruff.toml and .ruff.toml.
// Pure JavaScript, zero Python/pip/uv execution, zero network calls.

function stripTomlComment(line) {
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inDouble) {
      if (ch === '\\' && i + 1 < line.length) { i += 1; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '#') return line.slice(0, i);
  }
  return line;
}

function unquote(s) {
  const t = String(s || '').trim();
  if ((t.startsWith('"""') && t.endsWith('"""')) || (t.startsWith("'''") && t.endsWith("'''"))) {
    return t.slice(3, -3);
  }
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function splitTopLevel(text, sep = ',') {
  const out = [];
  let start = 0;
  let depth = 0;
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inDouble) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '[' || ch === '{') depth += 1;
    else if (ch === ']' || ch === '}') depth = Math.max(0, depth - 1);
    else if (ch === sep && depth === 0) {
      out.push(text.slice(start, i).trim());
      start = i + 1;
    }
  }
  const tail = text.slice(start).trim();
  if (tail) out.push(tail);
  return out;
}

function parseTomlValue(raw) {
  const t = String(raw || '').trim();
  if (!t) return '';
  if (t === 'true') return true;
  if (t === 'false') return false;
  if (/^[+-]?\d+$/.test(t)) return Number(t);
  if (/^[+-]?\d+\.\d+$/.test(t)) return Number(t);
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return unquote(t);
  }
  if (t.startsWith('[') && t.endsWith(']')) {
    const inner = t.slice(1, -1).trim();
    if (!inner) return [];
    return splitTopLevel(inner, ',').filter(Boolean).map(parseTomlValue);
  }
  if (t.startsWith('{') && t.endsWith('}')) {
    const inner = t.slice(1, -1).trim();
    const obj = {};
    if (!inner) return obj;
    for (const part of splitTopLevel(inner, ',')) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const k = unquote(part.slice(0, eq).trim());
      const v = parseTomlValue(part.slice(eq + 1).trim());
      obj[k] = v;
    }
    return obj;
  }
  return t;
}

function countDelims(s) {
  let sq = 0;
  let br = 0;
  let inDouble = false;
  let inSingle = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inDouble) {
      if (ch === '\\') { i += 1; continue; }
      if (ch === '"') inDouble = false;
      continue;
    }
    if (inSingle) {
      if (ch === "'") inSingle = false;
      continue;
    }
    if (ch === '"') { inDouble = true; continue; }
    if (ch === "'") { inSingle = true; continue; }
    if (ch === '[') sq += 1;
    else if (ch === ']') sq -= 1;
    else if (ch === '{') br += 1;
    else if (ch === '}') br -= 1;
  }
  return { sq, br };
}

function parseTomlEntries(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const entries = [];
  const arrayTables = {};
  let section = '';
  let arrayIndex = null;

  for (let i = 0; i < lines.length; i += 1) {
    const clean = stripTomlComment(lines[i]).trim();
    if (!clean) continue;

    if (clean.startsWith('[[') && clean.endsWith(']]')) {
      section = clean.slice(2, -2).trim();
      arrayTables[section] = (arrayTables[section] || 0) + 1;
      arrayIndex = arrayTables[section] - 1;
      continue;
    }
    if (clean.startsWith('[') && clean.endsWith(']')) {
      section = clean.slice(1, -1).trim();
      arrayIndex = null;
      continue;
    }

    const eq = clean.indexOf('=');
    if (eq === -1) continue;
    const key = unquote(clean.slice(0, eq).trim());
    const startLine = i + 1;
    let valPart = clean.slice(eq + 1).trim();
    let rawLines = [lines[i]];
    let { sq, br } = countDelims(valPart);

    while ((sq > 0 || br > 0) && i + 1 < lines.length) {
      i += 1;
      rawLines.push(lines[i]);
      const nextClean = stripTomlComment(lines[i]).trim();
      if (nextClean) {
        valPart += ' ' + nextClean;
        const d = countDelims(nextClean);
        sq += d.sq;
        br += d.br;
      }
    }

    entries.push({
      section,
      arrayIndex,
      key,
      rawValue: valPart,
      value: parseTomlValue(valPart),
      line: startLine,
      raw: rawLines.join('\n').trim(),
    });
  }
  return { entries, totalLines: lines.length };
}

function parsePep508(specStr) {
  const s = String(specStr || '').trim();
  const atMatch = s.match(/^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*@\s*(.+)$/);
  if (atMatch) {
    return { name: atMatch[1].trim(), spec: `@ ${atMatch[2].trim()}`, isUrl: true, url: atMatch[2].trim() };
  }
  const m = s.match(/^([A-Za-z0-9_.-]+(?:\[[^\]]+\])?)\s*(.*)$/);
  if (m) {
    return { name: m[1].trim(), spec: (m[2] || '*').trim() || '*', isUrl: false, url: '' };
  }
  return { name: s, spec: '*', isUrl: false, url: '' };
}

function formatDepSpec(val) {
  if (typeof val === 'string') return val;
  if (val && typeof val === 'object' && !Array.isArray(val)) {
    const parts = [];
    if (val.version) parts.push(String(val.version));
    if (val.git) parts.push(`git=${val.git}`);
    if (val.branch) parts.push(`branch=${val.branch}`);
    if (val.tag) parts.push(`tag=${val.tag}`);
    if (val.rev) parts.push(`rev=${val.rev}`);
    if (val.path) parts.push(`path=${val.path}`);
    if (val.extras) parts.push(`extras=[${Array.isArray(val.extras) ? val.extras.join(',') : val.extras}]`);
    if (val.optional) parts.push('optional');
    return parts.join(', ') || JSON.stringify(val);
  }
  return String(val);
}

function isUnpinnedDep(name, spec, valObj) {
  const s = String(spec || '').trim();
  if (s === '*' || s === 'latest' || s === '' || /^>=\s*0(\.0)*$/.test(s)) {
    return { reason: 'wildcard or unconstrained version (*)', kind: 'wildcard' };
  }
  if (valObj && typeof valObj === 'object' && !Array.isArray(valObj)) {
    if (valObj.git && !valObj.rev && !valObj.tag) {
      return { reason: `git dependency without rev/tag (${valObj.branch ? `branch=${valObj.branch}` : 'default branch'})`, kind: 'git-branch' };
    }
    if (valObj.version === '*') {
      return { reason: 'wildcard version "*"', kind: 'wildcard' };
    }
  }
  if (/git\+https?:\/\//i.test(s)) {
    const hasRev = /@[0-9a-f]{7,40}\b/i.test(s) || /@v?\d+\.\d+/i.test(s);
    if (!hasRev) {
      return { reason: 'git URL dependency not pinned to a commit SHA or release tag', kind: 'git-branch' };
    }
  }
  return null;
}

function hasPlaintextCreds(val) {
  const s = String(val || '');
  if (/https?:\/\/[^/\s:@]+:[^/\s@]+@/i.test(s)) return true;
  return false;
}

function parsePyproject(input, fileName = 'pyproject.toml') {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input || '');
  const baseName = String(fileName || 'pyproject.toml').toLowerCase();
  const isStandaloneRuff = baseName === 'ruff.toml' || baseName === '.ruff.toml' || baseName.endsWith('/ruff.toml') || baseName.endsWith('/.ruff.toml');
  const fileKind = isStandaloneRuff ? 'ruff.toml' : 'pyproject.toml';

  const { entries, totalLines } = parseTomlEntries(text);

  let projectName = '';
  let projectVersion = '';
  let requiresPython = '';
  let buildBackend = '';

  const dependencies = [];
  const toolSettings = [];
  const scripts = [];
  const buildSystem = [];
  const findings = [];
  const rows = [];
  const groups = new Set();

  function addFinding(severity, category, rule, line, target, message) {
    findings.push({ severity, category, rule, line, target, message });
  }

  for (const e of entries) {
    const sec = e.section;
    const k = e.key;
    const v = e.value;

    // Plaintext index credentials check on any URL/password/token key
    if (typeof v === 'string' && hasPlaintextCreds(v)) {
      addFinding('error', 'security', 'plaintext-index-credentials', e.line, `${sec || 'root'}.${k}`, 'Index or source URL embeds plaintext user:password credentials.');
    } else if ((sec.includes('index') || sec.includes('source')) && /^(password|token|api[_-]?key)$/i.test(k) && typeof v === 'string' && v.trim() && !v.includes('${') && !v.startsWith('$')) {
      addFinding('error', 'security', 'plaintext-index-credentials', e.line, `${sec}.${k}`, `Plaintext credential "${k}" is hardcoded in ${sec}.`);
    }

    // [project] metadata & deps
    if (sec === 'project') {
      if (k === 'name') projectName = String(v);
      if (k === 'version') projectVersion = String(v);
      if (k === 'requires-python') requiresPython = String(v);
      if (k === 'dependencies' && Array.isArray(v)) {
        for (const item of v) {
          const parsed = parsePep508(item);
          dependencies.push({ name: parsed.name, spec: parsed.spec, group: 'main', source: 'project', line: e.line, raw: String(item), obj: null });
        }
      }
      continue;
    }

    // [project.optional-dependencies]
    if (sec === 'project.optional-dependencies') {
      groups.add(k);
      const arr = Array.isArray(v) ? v : [v];
      for (const item of arr) {
        const parsed = parsePep508(item);
        dependencies.push({ name: parsed.name, spec: parsed.spec, group: `optional:${k}`, source: 'project', line: e.line, raw: String(item), obj: null });
      }
      continue;
    }

    // [dependency-groups] (PEP 735 / uv)
    if (sec === 'dependency-groups') {
      groups.add(k);
      const arr = Array.isArray(v) ? v : [v];
      for (const item of arr) {
        if (typeof item === 'string') {
          const parsed = parsePep508(item);
          dependencies.push({ name: parsed.name, spec: parsed.spec, group: `group:${k}`, source: 'dependency-groups', line: e.line, raw: item, obj: null });
        }
      }
      continue;
    }

    // [project.scripts] / [project.gui-scripts] / [project.entry-points*] / [tool.poetry.scripts]
    if (sec === 'project.scripts' || sec === 'project.gui-scripts' || sec.startsWith('project.entry-points') || sec === 'tool.poetry.scripts') {
      scripts.push({ name: k, target: String(v), section: sec, line: e.line, raw: e.raw });
      continue;
    }

    // [build-system]
    if (sec === 'build-system') {
      if (k === 'build-backend') buildBackend = String(v);
      buildSystem.push({ key: k, value: Array.isArray(v) ? v.join(', ') : String(v), line: e.line, raw: e.raw });
      continue;
    }

    // [tool.poetry]
    if (sec === 'tool.poetry') {
      if (k === 'name' && !projectName) projectName = String(v);
      if (k === 'version' && !projectVersion) projectVersion = String(v);
      continue;
    }

    // [tool.poetry.dependencies] & [tool.poetry.dev-dependencies] & [tool.poetry.group.<g>.dependencies]
    if (sec === 'tool.poetry.dependencies' || sec === 'tool.poetry.dev-dependencies' || /^tool\.poetry\.group\.[^.]+\.dependencies$/.test(sec)) {
      if (k === 'python' && sec === 'tool.poetry.dependencies') {
        if (!requiresPython) requiresPython = formatDepSpec(v);
        continue;
      }
      let grp = 'poetry:main';
      if (sec === 'tool.poetry.dev-dependencies') { grp = 'poetry:dev'; groups.add('dev'); }
      else {
        const gm = sec.match(/^tool\.poetry\.group\.([^.]+)\.dependencies$/);
        if (gm) { grp = `poetry:${gm[1]}`; groups.add(gm[1]); }
      }
      dependencies.push({ name: k, spec: formatDepSpec(v), group: grp, source: 'poetry', line: e.line, raw: e.raw, obj: (v && typeof v === 'object' && !Array.isArray(v)) ? v : null });
      continue;
    }

    // [tool.uv] / [tool.uv.sources] / [[tool.uv.index]]
    if (sec === 'tool.uv' || sec.startsWith('tool.uv.')) {
      if (sec === 'tool.uv' && k === 'dev-dependencies' && Array.isArray(v)) {
        groups.add('uv:dev');
        for (const item of v) {
          const parsed = parsePep508(item);
          dependencies.push({ name: parsed.name, spec: parsed.spec, group: 'uv:dev', source: 'uv', line: e.line, raw: String(item), obj: null });
        }
      } else if (sec === 'tool.uv.sources') {
        dependencies.push({ name: k, spec: formatDepSpec(v), group: 'uv:sources', source: 'uv', line: e.line, raw: e.raw, obj: (v && typeof v === 'object' && !Array.isArray(v)) ? v : null });
      } else {
        toolSettings.push({ tool: 'uv', section: sec, key: k, value: Array.isArray(v) ? v.join(', ') : formatDepSpec(v), line: e.line, raw: e.raw });
      }
      continue;
    }

    // [tool.ruff*] or standalone ruff.toml
    if (sec === 'tool.ruff' || sec.startsWith('tool.ruff.') || (isStandaloneRuff && (sec === '' || sec === 'lint' || sec === 'format' || sec.startsWith('lint.')))) {
      const valStr = Array.isArray(v) ? v.join(', ') : formatDepSpec(v);
      toolSettings.push({ tool: 'ruff', section: sec || 'ruff', key: k, value: valStr, line: e.line, raw: e.raw });

      if ((k === 'ignore' || k === 'extend-ignore') && Array.isArray(v)) {
        const secIgnored = v.filter((code) => /^S(\d{3})?$/i.test(String(code).trim()));
        if (secIgnored.length) {
          addFinding('warning', 'security', 'disabled-ruff-security', e.line, `${sec || 'ruff'}.${k}`, `Ruff security rules disabled in ${k}: ${secIgnored.join(', ')}.`);
        }
      }
      continue;
    }

    // [tool.mypy*]
    if (sec === 'tool.mypy' || sec.startsWith('tool.mypy.')) {
      const valStr = Array.isArray(v) ? v.join(', ') : formatDepSpec(v);
      toolSettings.push({ tool: 'mypy', section: sec, key: k, value: valStr, line: e.line, raw: e.raw });
      if (k === 'disallow_untyped_defs' && v === false) {
        addFinding('warning', 'typing', 'mypy-untyped-defs', e.line, `${sec}.disallow_untyped_defs`, 'Mypy has disallow_untyped_defs = false, allowing untyped functions without error.');
      }
      continue;
    }

    // [tool.pytest*]
    if (sec === 'tool.pytest' || sec.startsWith('tool.pytest.')) {
      const valStr = Array.isArray(v) ? v.join(', ') : formatDepSpec(v);
      toolSettings.push({ tool: 'pytest', section: sec, key: k, value: valStr, line: e.line, raw: e.raw });
      continue;
    }
  }

  // Check dependency pinning findings
  for (const d of dependencies) {
    const unp = isUnpinnedDep(d.name, d.spec, d.obj);
    if (unp) {
      addFinding('warning', 'pinning', 'unpinned-wildcard-dep', d.line, d.name, `Dependency "${d.name}" (${d.group}) uses ${unp.reason}.`);
    }
  }

  // Missing requires-python check (for pyproject.toml only)
  if (!isStandaloneRuff && !requiresPython) {
    addFinding('warning', 'compatibility', 'missing-requires-python', 1, '[project].requires-python', 'No requires-python (or tool.poetry.dependencies.python) version range is declared.');
  }

  // Build rows for main table
  let idx = 0;
  function attachRowFindings(line, name) {
    return findings.filter((f) => f.line === line || f.target === name || f.target.endsWith(`.${name}`));
  }

  if (!isStandaloneRuff) {
    idx += 1;
    const pf = findings.filter((f) => f.rule === 'missing-requires-python');
    rows.push({
      index: idx,
      line: 1,
      kind: 'project',
      section: '[project]',
      name: projectName || pathBase(fileName),
      signature: `version=${projectVersion || '(unset)'} · requires-python=${requiresPython || '(missing)'}`,
      badge: buildBackend || 'pyproject',
      risk: pf.length ? `${pf.length} warning` : 'ok',
      errorCount: pf.filter((f) => f.severity === 'error').length,
      warningCount: pf.filter((f) => f.severity === 'warning').length,
      findings: pf,
      raw: `name = "${projectName || ''}"\nversion = "${projectVersion || ''}"\nrequires-python = "${requiresPython || ''}"\nbuild-backend = "${buildBackend || ''}"`,
      attrs: [
        { key: 'Project Name', value: projectName || '(unset)' },
        { key: 'Version', value: projectVersion || '(unset)' },
        { key: 'Requires Python', value: requiresPython || '(missing)' },
        { key: 'Build Backend', value: buildBackend || '(unset)' },
      ],
    });
  }

  for (const d of dependencies) {
    idx += 1;
    const rf = attachRowFindings(d.line, d.name).filter((f) => f.rule === 'unpinned-wildcard-dep' || f.rule === 'plaintext-index-credentials');
    const errs = rf.filter((f) => f.severity === 'error').length;
    const warns = rf.filter((f) => f.severity === 'warning').length;
    rows.push({
      index: idx,
      line: d.line,
      kind: 'dependency',
      section: d.group,
      name: d.name,
      signature: d.spec,
      badge: d.group,
      risk: errs ? `${errs} error` : (warns ? `${warns} warning` : 'pinned'),
      errorCount: errs,
      warningCount: warns,
      findings: rf,
      raw: d.raw,
      attrs: [
        { key: 'Package', value: d.name },
        { key: 'Specifier', value: d.spec },
        { key: 'Group', value: d.group },
        { key: 'Source', value: d.source },
        { key: 'Line', value: String(d.line) },
      ],
    });
  }

  for (const t of toolSettings) {
    idx += 1;
    const rf = findings.filter((f) => f.line === t.line);
    const errs = rf.filter((f) => f.severity === 'error').length;
    const warns = rf.filter((f) => f.severity === 'warning').length;
    rows.push({
      index: idx,
      line: t.line,
      kind: t.tool,
      section: `[${t.section}]`,
      name: `${t.section}.${t.key}`,
      signature: t.value,
      badge: t.tool,
      risk: errs ? `${errs} error` : (warns ? `${warns} warning` : 'ok'),
      errorCount: errs,
      warningCount: warns,
      findings: rf,
      raw: t.raw,
      attrs: [
        { key: 'Tool', value: t.tool },
        { key: 'Section', value: `[${t.section}]` },
        { key: 'Option', value: t.key },
        { key: 'Value', value: t.value },
        { key: 'Line', value: String(t.line) },
      ],
    });
  }

  for (const b of buildSystem) {
    idx += 1;
    rows.push({
      index: idx,
      line: b.line,
      kind: 'build',
      section: '[build-system]',
      name: b.key,
      signature: b.value,
      badge: 'build-system',
      risk: 'ok',
      errorCount: 0,
      warningCount: 0,
      findings: [],
      raw: b.raw,
      attrs: [
        { key: 'Section', value: '[build-system]' },
        { key: 'Key', value: b.key },
        { key: 'Value', value: b.value },
        { key: 'Line', value: String(b.line) },
      ],
    });
  }

  for (const sc of scripts) {
    idx += 1;
    rows.push({
      index: idx,
      line: sc.line,
      kind: 'script',
      section: `[${sc.section}]`,
      name: sc.name,
      signature: sc.target,
      badge: 'entrypoint',
      risk: 'ok',
      errorCount: 0,
      warningCount: 0,
      findings: [],
      raw: sc.raw,
      attrs: [
        { key: 'Script', value: sc.name },
        { key: 'Entrypoint', value: sc.target },
        { key: 'Section', value: `[${sc.section}]` },
        { key: 'Line', value: String(sc.line) },
      ],
    });
  }

  const stats = {
    rowCount: rows.length,
    depCount: dependencies.length,
    groupCount: groups.size,
    toolCount: toolSettings.length,
    scriptCount: scripts.length,
    findingErrors: findings.filter((f) => f.severity === 'error').length,
    findingWarnings: findings.filter((f) => f.severity === 'warning').length,
  };

  return {
    fileKind,
    projectName: projectName || pathBase(fileName),
    projectVersion: projectVersion || '(unset)',
    requiresPython: requiresPython || '(missing)',
    buildBackend: buildBackend || '(unset)',
    totalLines,
    dependencies,
    toolSettings,
    scripts,
    buildSystem,
    findings,
    rows,
    stats,
  };
}

function pathBase(p) {
  const s = String(p || 'pyproject.toml');
  const idx = Math.max(s.lastIndexOf('/'), s.lastIndexOf('\\'));
  return idx >= 0 ? s.slice(idx + 1) : s;
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function buildAuditMarkdown(entries) {
  const lines = [
    '# PyProject Dependency-Pinning, Ruff & Typing Audit',
    '',
    `Audited ${entries.length} config file${entries.length === 1 ? '' : 's'} offline.`,
    '',
  ];
  for (const item of entries) {
    const p = item.parsed;
    lines.push(`## ${item.fileName}`);
    lines.push('');
    lines.push(`- Project: \`${p.projectName}\` (${p.projectVersion})`);
    lines.push(`- Requires Python: \`${p.requiresPython}\``);
    lines.push(`- Build backend: \`${p.buildBackend}\``);
    lines.push(`- Dependencies: ${p.stats.depCount} across ${p.stats.groupCount} optional/dev groups`);
    lines.push(`- Tool settings (Ruff/Mypy/Pytest/uv): ${p.stats.toolCount}`);
    lines.push(`- Findings: ${p.stats.findingErrors} errors, ${p.stats.findingWarnings} warnings`);
    lines.push('');
    if (p.findings.length) {
      lines.push('| Severity | Category | Rule | Line | Target | Finding |');
      lines.push('| --- | --- | --- | ---: | --- | --- |');
      for (const f of p.findings) {
        lines.push(`| ${f.severity.toUpperCase()} | ${f.category} | \`${f.rule}\` | ${f.line} | \`${f.target}\` | ${f.message} |`);
      }
      lines.push('');
    } else {
      lines.push('No static pinning, Ruff security, typing or credential findings detected.');
      lines.push('');
    }
  }
  return lines.join('\n');
}

function buildDiffMarkdown(leftName, left, rightName, right) {
  const lines = [
    `# PyProject Config Diff: ${leftName} vs ${rightName}`,
    '',
    '## Metadata Summary',
    '',
    '| Field | Baseline | Comparison | Status |',
    '| --- | --- | --- | --- |',
  ];
  const metaPairs = [
    ['Project', left.projectName, right.projectName],
    ['Version', left.projectVersion, right.projectVersion],
    ['requires-python', left.requiresPython, right.requiresPython],
    ['build-backend', left.buildBackend, right.buildBackend],
    ['Dependencies', String(left.stats.depCount), String(right.stats.depCount)],
    ['Findings', `${left.stats.findingErrors}E / ${left.stats.findingWarnings}W`, `${right.stats.findingErrors}E / ${right.stats.findingWarnings}W`],
  ];
  for (const [label, a, b] of metaPairs) {
    lines.push(`| ${label} | \`${a}\` | \`${b}\` | ${a === b ? 'Same' : 'Changed'} |`);
  }
  lines.push('');
  lines.push('## Dependency Changes');
  lines.push('');
  const lMap = new Map(left.dependencies.map((d) => [`${d.group}:${d.name}`, d.spec]));
  const rMap = new Map(right.dependencies.map((d) => [`${d.group}:${d.name}`, d.spec]));
  const allKeys = Array.from(new Set([...lMap.keys(), ...rMap.keys()])).sort();
  const depChanges = [];
  for (const key of allKeys) {
    const a = lMap.get(key);
    const b = rMap.get(key);
    if (a === b) continue;
    depChanges.push(`| \`${key}\` | \`${a || '(none)'}\` | \`${b || '(none)'}\` | ${!a ? 'Added' : (!b ? 'Removed' : 'Changed')} |`);
  }
  if (depChanges.length) {
    lines.push('| Group:Package | Baseline | Comparison | Change |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(...depChanges);
  } else {
    lines.push('No dependency changes.');
  }
  lines.push('');
  lines.push('## Tool Config Changes (Ruff, Mypy, Pytest, uv)');
  lines.push('');
  const ltMap = new Map(left.toolSettings.map((t) => [`${t.section}.${t.key}`, t.value]));
  const rtMap = new Map(right.toolSettings.map((t) => [`${t.section}.${t.key}`, t.value]));
  const allT = Array.from(new Set([...ltMap.keys(), ...rtMap.keys()])).sort();
  const tChanges = [];
  for (const key of allT) {
    const a = ltMap.get(key);
    const b = rtMap.get(key);
    if (a === b) continue;
    tChanges.push(`| \`${key}\` | \`${a || '(none)'}\` | \`${b || '(none)'}\` | ${!a ? 'Added' : (!b ? 'Removed' : 'Changed')} |`);
  }
  if (tChanges.length) {
    lines.push('| Option | Baseline | Comparison | Change |');
    lines.push('| --- | --- | --- | --- |');
    lines.push(...tChanges);
  } else {
    lines.push('No tool config changes.');
  }
  lines.push('');
  return lines.join('\n');
}

function buildInventoryMarkdown(parsed, fileName) {
  const lines = [
    `# Dependency & Tool-Config Inventory: ${fileName}`,
    '',
    `- Project: \`${parsed.projectName}\` (${parsed.projectVersion})`,
    `- Requires Python: \`${parsed.requiresPython}\``,
    `- Build backend: \`${parsed.buildBackend}\``,
    '',
    '## Dependencies',
    '',
  ];
  if (parsed.dependencies.length) {
    lines.push('| Package | Specifier | Group | Source | Line |');
    lines.push('| --- | --- | --- | --- | ---: |');
    for (const d of parsed.dependencies) {
      lines.push(`| \`${d.name}\` | \`${d.spec}\` | ${d.group} | ${d.source} | ${d.line} |`);
    }
  } else {
    lines.push('No dependencies declared.');
  }
  lines.push('');
  lines.push('## Tool Config (Ruff, Mypy, Pytest, uv)');
  lines.push('');
  if (parsed.toolSettings.length) {
    lines.push('| Tool | Section | Option | Value | Line |');
    lines.push('| --- | --- | --- | --- | ---: |');
    for (const t of parsed.toolSettings) {
      lines.push(`| ${t.tool} | \`[${t.section}]\` | \`${t.key}\` | \`${t.value}\` | ${t.line} |`);
    }
  } else {
    lines.push('No tool settings declared.');
  }
  lines.push('');
  if (parsed.scripts.length) {
    lines.push('## Script Entrypoints');
    lines.push('');
    lines.push('| Script | Target | Section | Line |');
    lines.push('| --- | --- | --- | ---: |');
    for (const s of parsed.scripts) {
      lines.push(`| \`${s.name}\` | \`${s.target}\` | \`[${s.section}]\` | ${s.line} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function buildInventoryCsv(parsed) {
  const rows = [['Category', 'Section', 'Name', 'Value', 'Status', 'Line']];
  for (const r of parsed.rows) {
    rows.push([r.kind, r.section, r.name, r.signature, r.risk, String(r.line)]);
  }
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

module.exports = {
  parsePyproject,
  parseTomlEntries,
  buildAuditMarkdown,
  buildDiffMarkdown,
  buildInventoryMarkdown,
  buildInventoryCsv,
};
