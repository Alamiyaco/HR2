// ══════════════════════════════════════════════
//  CONFIG
// ══════════════════════════════════════════════
const SHEET_ID = '1GjFYMDHBmf_ugxci0mecqvq9GBzFmAMI5ENSrmItl3E';
const CSV_URL  = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=0`;

// ══════════════════════════════════════════════
//  STATE
// ══════════════════════════════════════════════
let DATA = [];           // All employees
let nm   = {};           // name → employee object
let cm   = {};           // manager → [direct-report names] — scoped per dept
let exp  = new Set();    // expanded tree nodes (by name)
let oD   = new Set();    // open departments

// ══════════════════════════════════════════════
//  DEPT EMOJI MAP
// ══════════════════════════════════════════════
const DEPT_ICONS = {
  'الادارة':              '🏢',
  'التسويق':              '📢',
  'التصميم الداخلي':      '🎨',
  'الحسابات':             '💰',
  'القانونية':            '⚖️',
  'المبيعات الحكومية':    '🏛️',
  'المبيعات المباشرة':    '🤝',
  'المخازن':              '📦',
  'المشتريات':            '🛒',
  'المشروع':              '📋',
  'الموارد البشرية':      '👥',
  'إدارة الجودة':         '✅',
  'تكنلوجيا المعلومات':  '💻',
  'خدمات ما بعد البيع':  '🔧',
  'مبيعات الشركات':       '🏪',
  'الادارة العامة':       '👔',
};

// ══════════════════════════════════════════════
//  CSV PARSER
// ══════════════════════════════════════════════
function parseCSV(text) {
  const rows = [];
  let current = '', inQuote = false, row = [];
  text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"' && text[i + 1] === '"') { current += '"'; i++; }
      else if (c === '"') { inQuote = false; }
      else { current += c; }
    } else {
      if      (c === '"')  { inQuote = true; }
      else if (c === ',')  { row.push(current.trim()); current = ''; }
      else if (c === '\n') { row.push(current.trim()); rows.push(row); row = []; current = ''; }
      else { current += c; }
    }
  }
  if (current || row.length) { row.push(current.trim()); rows.push(row); }
  return rows;
}

// ══════════════════════════════════════════════
//  FETCH DATA FROM GOOGLE SHEET
// ══════════════════════════════════════════════
async function loadData() {
  const btn    = document.getElementById('refreshBtn');
  const icon   = document.getElementById('refreshIcon');
  const status = document.getElementById('statusText');

  btn.classList.add('loading');
  icon.innerHTML = '<span class="spin">🔄</span>';
  status.textContent = 'جاري التحميل…';
  status.className = 'status-pill';

  try {
    const resp = await fetch(CSV_URL);
    if (!resp.ok) throw new Error('فشل الاتصال بـ Google Sheet');
    const text = await resp.text();
    const rows = parseCSV(text);
    if (rows.length < 2) throw new Error('الملف فارغ أو لا يحتوي بيانات');

    // Detect columns
    const header = rows[0].map(h => h.replace(/\ufeff/g, '').trim().toLowerCase());
    const iName   = header.findIndex(h => h.includes('employee') || h.includes('name')   || h.includes('اسم'));
    const iBranch = header.findIndex(h => h.includes('branch')   || h.includes('فرع'));
    const iDept   = header.findIndex(h => h.includes('department') || h.includes('dept') || h.includes('قسم'));
    const iPos    = header.findIndex(h => h.includes('position') || h.includes('منصب')   || h.includes('وظيفة'));
    const iMgr    = header.findIndex(h => h.includes('manager')  || h.includes('مدير'));

    if (iName < 0) throw new Error('عمود الاسم غير موجود في الجدول');
    if (iDept < 0) throw new Error('عمود القسم غير موجود في الجدول');

    DATA = [];
    for (let r = 1; r < rows.length; r++) {
      const row  = rows[r];
      const name = (row[iName] || '').trim();
      if (!name) continue;
      DATA.push({
        name:     name,
        branch:   iBranch >= 0 ? (row[iBranch] || '').trim() : '',
        dept:     iDept   >= 0 ? (row[iDept]   || '').trim() : '',
        position: iPos    >= 0 ? (row[iPos]     || '').trim() : '',
        manager:  iMgr    >= 0 ? (row[iMgr]     || '').trim() || null : null,
      });
    }

    // Remove self-references in manager field
    DATA.forEach(e => { if (e.manager === e.name) e.manager = null; });

    buildMaps();
    renderAll();

    status.innerHTML = `<span class="live-dot"></span> متصل — ${DATA.length} موظف`;
    status.className = 'status-pill ok';
    document.getElementById('lastUpdate').textContent =
      'آخر تحديث: ' + new Date().toLocaleTimeString('ar-IQ');

  } catch (err) {
    console.error(err);
    status.textContent = '⚠️ خطأ: ' + err.message;
    status.className = 'status-pill err';
    if (!DATA.length) {
      document.getElementById('mainContent').innerHTML = `
        <div class="error-screen">
          <h2>⚠️ تعذر تحميل البيانات</h2>
          <p>تأكد من أن ملف Google Sheet مشترك كـ "أي شخص لديه الرابط يمكنه العرض"<br><br>
          اذهب إلى Google Sheet ← مشاركة ← تغيير إلى "أي شخص لديه الرابط" ← مشاهد</p>
        </div>`;
    }
  }

  btn.classList.remove('loading');
  icon.innerHTML = '🔄';
}

// ══════════════════════════════════════════════
//  BUILD LOOKUP MAPS
//
//  KEY FIX: cm (children map) is scoped by department.
//  An employee only appears as a child of their manager
//  if they are in the SAME department. This means:
//    • Moving/renaming a manager never pulls employees
//      from other departments into this department's tree.
//    • The DEPARTMENT field is the authoritative grouping.
// ══════════════════════════════════════════════
function buildMaps() {
  nm = {};
  cm = {};

  // 1) Build name → employee index
  DATA.forEach(e => { nm[e.name] = e; });

  // 2) Build children map — department-scoped
  DATA.forEach(e => {
    if (!e.manager || e.manager === e.name) return;

    const mgr = nm[e.manager];
    if (!mgr) return; // manager not in dataset

    // ✅ ONLY link as child if same department
    if (mgr.dept !== e.dept) return;

    if (!cm[e.manager]) cm[e.manager] = [];
    cm[e.manager].push(e.name);
  });
}

// ══════════════════════════════════════════════
//  LEVEL & COLOR HELPERS
// ══════════════════════════════════════════════
function getLevel(e) {
  if (!e) return 'emp';
  const p = (e.position || '').toLowerCase();
  if (p.includes('المدير المفوض') || p.includes('مساعد المدير')) return 'top';
  if (p.includes('مدير'))                                          return 'mgr';
  if (p.includes('مشرف') || p.includes('رئيس') || p.includes('مسؤول الصندوق')) return 'sup';
  return 'emp';
}

function getCardClass(e) {
  const l = getLevel(e);
  if (l === 'top') return 'c-top';
  if (l === 'mgr') return 'c-mgr';
  if (l === 'sup') return 'c-sup';
  return 'c-emp';
}

// ══════════════════════════════════════════════
//  GET DEPARTMENT HEADS
//  (employees whose manager is outside the dept
//   or has no manager within the dept)
// ══════════════════════════════════════════════
function getDeptHeads(dept) {
  const members    = DATA.filter(e => e.dept === dept);
  const memberSet  = new Set(members.map(m => m.name));

  return members.filter(m => {
    // Head = no manager, or manager is not in this department
    if (!m.manager || m.manager === m.name) return true;
    return !memberSet.has(m.manager);
  });
}

// ══════════════════════════════════════════════
//  RENDER TREE NODE
// ══════════════════════════════════════════════
function renderNode(name) {
  const e = nm[name];
  if (!e) return '';

  const kids    = cm[name] || [];
  const hasKids = kids.length > 0;
  const isExp   = exp.has(name);

  // Use JSON.stringify for safe embedding of any character in onclick
  const safeRef = JSON.stringify(name);

  let h = '<div class="t-node">';
  h += `<div class="t-card ${getCardClass(e)}" onclick="toggleNode(${safeRef})">`;
  h += `<div class="cp">${esc(e.position || '—')}</div>`;
  h += `<div class="cn">${esc(e.name)}</div>`;
  if (e.branch) h += `<div class="cb">${esc(e.branch)}</div>`;
  if (hasKids) {
    h += `<span class="badge">${kids.length}</span>`;
    h += `<div class="tbtn">${isExp ? '−' : '+'}</div>`;
  }
  h += '</div>'; // t-card

  if (hasKids && isExp) {
    const empKids    = kids.filter(k => getLevel(nm[k]) === 'emp');
    const nonEmpKids = kids.filter(k => getLevel(nm[k]) !== 'emp');

    h += '<div class="t-vline"></div>';

    if (nonEmpKids.length) {
      const single = nonEmpKids.length === 1 ? ' single' : '';
      h += `<div class="t-children${single}">`;
      nonEmpKids.forEach(k => { h += `<div class="t-child">${renderNode(k)}</div>`; });
      h += '</div>';
    }

    if (empKids.length) {
      h += '<div class="emp-list-wrap">';
      if (!nonEmpKids.length) h += '<div class="emp-list-vline"></div>';
      h += '<div class="emp-list">';
      h += `<div class="emp-list-title">الموظفون المرتبطون مباشرة (${empKids.length})</div>`;
      h += '<div class="emp-items">';
      empKids.forEach(k => {
        const x = nm[k];
        h += `<div class="emp-item">
          <div class="emp-main">
            <div class="emp-name">${esc(x.name)}</div>
            <div class="emp-pos">${esc(x.position || 'موظف')}</div>
          </div>
          ${x.branch ? `<div class="emp-branch">${esc(x.branch)}</div>` : ''}
        </div>`;
      });
      h += '</div></div></div>';
    }
  }

  h += '</div>'; // t-node
  return h;
}

// ══════════════════════════════════════════════
//  RENDER FULL PAGE
// ══════════════════════════════════════════════
function renderAll() {
  // Identify CEO & assistant (from الادارة العامة or top-level)
  const ceo  = DATA.find(e => !e.manager && e.position && e.position.includes('المدير المفوض'));
  const asst = DATA.find(e => e.position && (
    e.position.includes('مساعد المدير') || e.position.includes('مساعد شخصي')
  ));

  // Departments (excluding الادارة العامة)
  const deptSet = new Set();
  DATA.forEach(e => { if (e.dept && e.dept !== 'الادارة العامة') deptSet.add(e.dept); });
  const depts = [...deptSet].sort();

  // Count members per dept
  const deptMembers = {};
  DATA.forEach(e => {
    if (!deptMembers[e.dept]) deptMembers[e.dept] = [];
    deptMembers[e.dept].push(e);
  });

  let html = '';

  // ── Stats ──
  const mgrCount = DATA.filter(e => getLevel(e) === 'mgr' || getLevel(e) === 'top').length;
  const supCount = DATA.filter(e => getLevel(e) === 'sup').length;
  html += `<div class="stats-row">
    <div class="stat"><div class="stat-n">${DATA.length}</div><div class="stat-l">إجمالي الموظفين</div></div>
    <div class="stat"><div class="stat-n">${depts.length}</div><div class="stat-l">الأقسام</div></div>
    <div class="stat"><div class="stat-n">${mgrCount}</div><div class="stat-l">المدراء</div></div>
    <div class="stat"><div class="stat-n">${supCount}</div><div class="stat-l">المشرفون</div></div>
  </div>`;

  // ── Search ──
  html += `<div class="search-wrap">
    <input type="text" id="si" placeholder="ابحث عن موظف أو قسم..." oninput="onSearch(this.value)" autocomplete="off">
    <span class="search-icon">🔍</span>
    <div class="search-results" id="sr"></div>
  </div>`;

  // ── CEO & Assistant ──
  html += '<div class="top-section">';
  if (ceo) {
    html += `<div class="ceo-card"><div class="pos">${esc(ceo.position)}</div><div class="nm">${esc(ceo.name)}</div></div>`;
  }
  if (asst) {
    html += '<div class="connector-v"></div>';
    html += `<div class="asst-card"><div class="pos">${esc(asst.position)}</div><div class="nm">${esc(asst.name)}</div></div>`;
  }
  html += '</div>';

  // ── Department Cards ──
  html += '<div class="dept-grid">';
  depts.forEach((dept, i) => {
    const members = deptMembers[dept] || [];
    if (!members.length) return;

    const isOpen  = oD.has(dept);
    const icon    = DEPT_ICONS[dept] || '📁';
    const colorCls = 'dc-' + ((i % 15) + 1);
    const safeRef  = JSON.stringify(dept);

    html += `<div class="dept-card ${isOpen ? 'open' : ''}" id="dp-${i}">`;
    html += `<div class="dept-header" onclick="toggleDept(${safeRef})">
      <div class="dept-header-right">
        <div class="dept-icon ${colorCls}">${icon}</div>
        <div class="dept-info">
          <div class="dept-name">${esc(dept)}</div>
          <div class="dept-count">${members.length} موظف</div>
        </div>
      </div>
      <div class="dept-arrow">▼</div>
    </div>`;

    html += '<div class="dept-body">';
    if (isOpen) {
      html += '<div class="tree-wrap">';
      const heads = getDeptHeads(dept);
      if (heads.length === 1) {
        html += renderNode(heads[0].name);
      } else if (heads.length > 1) {
        html += '<div class="t-children">';
        heads.forEach(h => { html += `<div class="t-child">${renderNode(h.name)}</div>`; });
        html += '</div>';
      }
      html += '</div>';
    }
    html += '</div></div>';
  });
  html += '</div>';

  document.getElementById('mainContent').innerHTML = html;

  // Keep dept order for search navigation
  window._depts = depts;
}

// ══════════════════════════════════════════════
//  INTERACTIONS
// ══════════════════════════════════════════════
function toggleDept(dept) {
  if (oD.has(dept)) oD.delete(dept);
  else oD.add(dept);
  renderAll();
}

function toggleNode(name) {
  if (exp.has(name)) exp.delete(name);
  else exp.add(name);
  renderAll();
}

function onSearch(v) {
  const sr = document.getElementById('sr');
  if (!sr || !v || v.length < 2) { if (sr) sr.classList.remove('visible'); return; }

  const results = DATA.filter(e =>
    e.name.includes(v) ||
    (e.position && e.position.includes(v)) ||
    e.dept.includes(v)
  ).slice(0, 10);

  if (!results.length) { sr.classList.remove('visible'); return; }

  sr.classList.add('visible');
  sr.innerHTML = results.map(x =>
    `<div class="sr-item" onclick="openEmployee(${JSON.stringify(x.name)})">
      <div class="sr-name">${esc(x.name)}</div>
      <div class="sr-pos">${esc(x.position || '')}${x.dept ? ' — ' + esc(x.dept) : ''}</div>
    </div>`
  ).join('');
}

function openEmployee(name) {
  const e = nm[name];
  if (!e) return;

  // Clear search
  const si = document.getElementById('si');
  const sr = document.getElementById('sr');
  if (si) si.value = '';
  if (sr) sr.classList.remove('visible');

  // Open the department and expand the path to this employee
  oD.add(e.dept);

  // Walk up manager chain to expand all ancestors
  let cur = e.manager;
  const visited = new Set();
  while (cur && cur !== name && nm[cur] && !visited.has(cur)) {
    visited.add(cur);
    exp.add(cur);
    const parent = nm[cur];
    cur = (parent.manager && parent.manager !== parent.name) ? parent.manager : null;
  }

  renderAll();

  // Scroll dept into view
  setTimeout(() => {
    const depts = window._depts || [];
    const idx   = depts.indexOf(e.dept);
    const el    = document.getElementById('dp-' + idx);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

// ══════════════════════════════════════════════
//  SAFE HTML ESCAPE
// ══════════════════════════════════════════════
function esc(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#39;');
}

// ══════════════════════════════════════════════
//  EXPOSE GLOBALS & INIT
// ══════════════════════════════════════════════
window.loadData    = loadData;
window.toggleDept  = toggleDept;
window.toggleNode  = toggleNode;
window.onSearch    = onSearch;
window.openEmployee = openEmployee;

// Initial load
loadData();

// Auto-refresh every 2 minutes
setInterval(loadData, 120_000);
