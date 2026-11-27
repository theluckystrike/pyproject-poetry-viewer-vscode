'use strict';
module.exports = {
  prefix: 'zovoPyprojview',
  triesKey: 'zovoPyprojview.proTrial',
  slot: '#protools',
  tools: [
    { id: 'auditPyproject', title: 'Audit pyproject and Ruff config', command: 'zovoPyprojview.auditPyproject' },
    { id: 'diffPyprojects', title: 'Compare two pyproject files', command: 'zovoPyprojview.diffPyprojects' },
    { id: 'exportDepMatrix', title: 'Export dependency matrix', command: 'zovoPyprojview.exportDepMatrix' },
  ],
};
