'use strict';

/* ══════════════════════════════════════════════════════
   CATÉGORIES PAR DÉFAUT (simplifiées)
   ══════════════════════════════════════════════════════ */
const DEFAULT_CATEGORIES = [
  // Dépenses
  { id: 'alimentation', label: 'Alimentation', type: 'expense', icon: '🛒', color: '#f0a050', deletable: false },
  { id: 'transport',    label: 'Transport',    type: 'expense', icon: '🚗', color: '#5b6af0', deletable: false },
  { id: 'logement',     label: 'Logement',     type: 'expense', icon: '🏠', color: '#3ecf8e', deletable: false },
  { id: 'sante',        label: 'Santé',        type: 'expense', icon: '💊', color: '#e8c547', deletable: false },
  { id: 'loisirs',      label: 'Loisirs',      type: 'expense', icon: '🎬', color: '#c47ef0', deletable: false },
  { id: 'emprunt_dep',  label: 'Emprunt',      type: 'expense', icon: '🏦', color: '#00c853', deletable: false },
  { id: 'autre_dep',    label: 'Autres',       type: 'expense', icon: '◇',  color: '#6b6b8a', deletable: false },
  // Revenus
  { id: 'salaire',      label: 'Salaire',      type: 'income',  icon: '💰', color: '#3ecf8e', deletable: false },
  { id: 'cadeau',       label: 'Cadeau',       type: 'income',  icon: '🎁', color: '#e8c547', deletable: false },
  { id: 'emprunt_inc',  label: 'Emprunt',      type: 'income',  icon: '🏦', color: '#00c853', deletable: false },
  { id: 'autre_inc',    label: 'Autres',       type: 'income',  icon: '◇',  color: '#6b6b8a', deletable: false },
];

// IDs de catégories "emprunt" pour la gestion de la dette
const DEBT_INCOME_ID  = 'emprunt_inc';  // emprunt reçu  → dette augmente
const DEBT_EXPENSE_ID = 'emprunt_dep';  // remboursement → dette diminue

const MONTH_FR = ['Janvier','Février','Mars','Avril','Mai','Juin',
                  'Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

/* ══════════════════════════════════════════════════════
   STATE
   ══════════════════════════════════════════════════════ */
let state = {
  transactions: [],
  budgets:      {},
  categories:   JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)),
  viewMonth:    null,
};

function initState() {
  const now = new Date();
  state.viewMonth = { year: now.getFullYear(), month: now.getMonth() };
  try {
    const raw = localStorage.getItem('depensiq_v5');
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p.transactions)) state.transactions = p.transactions;
      if (p.budgets && typeof p.budgets === 'object') state.budgets = p.budgets;
      // On force les catégories par défaut pour appliquer les nouvelles règles
      // mais on ajoute quand même les catégories personnalisées
      if (Array.isArray(p.categories)) {
        const customs = p.categories.filter(c => c.id.startsWith('custom_'));
        state.categories = [...JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)), ...customs];
      }
    }
  } catch(e) { console.warn('localStorage:', e); }
}

function save() {
  try {
    localStorage.setItem('depensiq_v5', JSON.stringify({
      transactions: state.transactions,
      budgets:      state.budgets,
      categories:   state.categories,
    }));
  } catch(e) {}
}

function getCatMap() {
  return Object.fromEntries(state.categories.map(c => [c.id, c]));
}

/* ══════════════════════════════════════════════════════
   HELPERS
   ══════════════════════════════════════════════════════ */
function fmt(n) {
  return Number(n).toLocaleString('fr-FR') + ' FCFA';
}
function fmtDate(iso) {
  try { return new Date(iso + 'T00:00:00').toLocaleDateString('fr-FR', { day:'2-digit', month:'short', year:'numeric' }); }
  catch(e) { return iso; }
}
function monthKey(y, m) { return `${y}-${String(m+1).padStart(2,'0')}`; }
function txOfMonth(y, m) {
  const key = monthKey(y, m);
  return state.transactions.filter(t => typeof t.date === 'string' && t.date.startsWith(key));
}
function currentMonthTx() {
  const { year, month } = state.viewMonth;
  return txOfMonth(year, month);
}
function sumType(txs, type) {
  return txs.filter(t => t.type === type).reduce((s,t) => s + Number(t.amount), 0);
}
function catTotalsOfType(txs, type) {
  const totals = {};
  txs.filter(t => t.type === type).forEach(t => {
    totals[t.category] = (totals[t.category] || 0) + Number(t.amount);
  });
  return totals;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function getSixMonths() {
  const { year, month } = state.viewMonth;
  const r = [];
  for (let i = 5; i >= 0; i--) {
    let m = month - i, y = year;
    if (m < 0) { m += 12; y--; }
    r.push({ y, m });
  }
  return r;
}

/* ══════════════════════════════════════════════════════
   DETTE TOTALE
   dette = somme de tous les emprunts reçus (income emprunt)
           − somme de tous les remboursements (expense emprunt)
   ══════════════════════════════════════════════════════ */
function getTotalDette() {
  const empruntsRecus = state.transactions
    .filter(t => t.type === 'income'  && t.category === DEBT_INCOME_ID)
    .reduce((s,t) => s + Number(t.amount), 0);
  const remboursements = state.transactions
    .filter(t => t.type === 'expense' && t.category === DEBT_EXPENSE_ID)
    .reduce((s,t) => s + Number(t.amount), 0);
  return Math.max(0, empruntsRecus - remboursements);
}

/* ══════════════════════════════════════════════════════
   SOLDE CUMULÉ (report épargne mois précédents)
   ══════════════════════════════════════════════════════ */
function getCumulativeSavingsBeforeCurrentMonth() {
  const { year, month } = state.viewMonth;
  const key  = monthKey(year, month);
  const prev = state.transactions.filter(t => typeof t.date === 'string' && t.date < key);
  return sumType(prev,'income') - sumType(prev,'expense');
}

/* ══════════════════════════════════════════════════════
   THÈME
   ══════════════════════════════════════════════════════ */
let isDark = true;
function applyTheme(redrawCharts) {
  document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  document.getElementById('themeIcon').textContent  = isDark ? '☀' : '🌙';
  document.getElementById('themeLabel').textContent = isDark ? ' Mode clair' : ' Mode sombre';
  localStorage.setItem('depensiq_theme', isDark ? 'dark' : 'light');
  if (redrawCharts && state.viewMonth) renderLineChart();
}
document.getElementById('themeToggle').addEventListener('click', () => {
  isDark = !isDark; applyTheme(true); closeSidebar();
});

/* ══════════════════════════════════════════════════════
   NAVIGATION MOIS
   ══════════════════════════════════════════════════════ */
function renderMonthLabel() {
  const { year, month } = state.viewMonth;
  document.getElementById('currentMonthLabel').textContent = `${MONTH_FR[month].slice(0,3)} ${year}`;
}
document.getElementById('prevMonth').addEventListener('click', () => {
  let { year, month } = state.viewMonth;
  if (--month < 0) { month = 11; year--; }
  state.viewMonth = { year, month }; renderAll();
});
document.getElementById('nextMonth').addEventListener('click', () => {
  let { year, month } = state.viewMonth;
  if (++month > 11) { month = 0; year++; }
  state.viewMonth = { year, month }; renderAll();
});

/* ══════════════════════════════════════════════════════
   MENU MOBILE
   ══════════════════════════════════════════════════════ */
const sidebar        = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebarOverlay');
const hamburgerBtn   = document.getElementById('hamburgerBtn');

function openSidebar() {
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('visible');
  document.body.classList.add('sidebar-open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('visible');
  document.body.classList.remove('sidebar-open');
}
hamburgerBtn.addEventListener('click', () => sidebar.classList.contains('open') ? closeSidebar() : openSidebar());
document.getElementById('sidebarClose').addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

/* ══════════════════════════════════════════════════════
   NAVIGATION VUES
   ══════════════════════════════════════════════════════ */
let currentView = 'dashboard';

function setView(view) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-item, .bn-item').forEach(n => n.classList.remove('active'));
  const sec = document.getElementById('view-' + view);
  if (sec) sec.classList.add('active');
  document.querySelectorAll(`[data-view="${view}"]`).forEach(el => el.classList.add('active'));
  currentView = view; renderView(view); closeSidebar(); window.scrollTo(0,0);
}

document.querySelectorAll('.nav-item, .bn-item').forEach(item => {
  item.addEventListener('click', e => { e.preventDefault(); setView(item.dataset.view); });
});
document.querySelectorAll('.card-link').forEach(link => {
  link.addEventListener('click', e => { e.preventDefault(); setView(link.dataset.view); });
});

/* ══════════════════════════════════════════════════════
   RENDER GLOBAL
   ══════════════════════════════════════════════════════ */
function renderAll() {
  renderMonthLabel();
  renderView(currentView);
}
function renderView(view) {
  if (view === 'dashboard')    { renderKPIs(); renderDette(); renderRecentList(); renderDonut(); renderBarChart(); renderLineChart(); }
  if (view === 'transactions') { populateFilterCat(); renderAllTx(); }
  if (view === 'budgets')      { renderBudgets(); }
  if (view === 'stats')        { renderStats(); }
  if (view === 'categories')   { renderCategories(); }
}

/* ══════════════════════════════════════════════════════
   MODAL TRANSACTION — vérification solde & alerte
   ══════════════════════════════════════════════════════ */
let currentTxType = 'expense';

function populateTxCatSelect(type) {
  const sel = document.getElementById('tx-cat');
  sel.innerHTML = '';
  state.categories.filter(c => c.type === type).forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.icon + ' ' + c.label;
    sel.appendChild(opt);
  });
  checkBalanceAlert(); // recalcule l'alerte dès que le type change
}

function getCurrentCumulativeBalance() {
  const txs = currentMonthTx();
  const inc  = sumType(txs, 'income');
  const exp  = sumType(txs, 'expense');
  return getCumulativeSavingsBeforeCurrentMonth() + inc - exp;
}

function checkBalanceAlert() {
  const alertEl = document.getElementById('alert-insufficient');
  if (!alertEl) return;
  if (currentTxType !== 'expense') { alertEl.style.display = 'none'; return; }
  const amount    = parseFloat(document.getElementById('tx-amount').value) || 0;
  const cat       = document.getElementById('tx-cat').value;
  const isEmprunt = cat === DEBT_EXPENSE_ID; // remboursement d'emprunt : pas de blocage
  const balance   = getCurrentCumulativeBalance();
  if (!isEmprunt && amount > 0 && amount > balance) {
    alertEl.style.display = 'flex';
  } else {
    alertEl.style.display = 'none';
  }
}

function openAddModal() {
  currentTxType = 'expense';
  document.querySelectorAll('.toggle-btn[data-type]').forEach(b =>
    b.classList.toggle('active', b.dataset.type === 'expense'));
  document.getElementById('tx-amount').value = '';
  document.getElementById('tx-note').value   = '';
  document.getElementById('tx-date').value   = new Date().toISOString().split('T')[0];
  document.getElementById('alert-insufficient').style.display = 'none';
  populateTxCatSelect('expense');
  document.getElementById('modal-add').classList.add('open');
}
function closeAddModal() { document.getElementById('modal-add').classList.remove('open'); }

document.getElementById('openAddModal').addEventListener('click', openAddModal);
document.getElementById('openAddModal2').addEventListener('click', openAddModal);
document.getElementById('fabAdd').addEventListener('click', openAddModal);
document.getElementById('topbarAddBtn').addEventListener('click', openAddModal);
document.getElementById('closeModal').addEventListener('click', closeAddModal);
document.getElementById('modal-add').addEventListener('click', e => { if (e.target===e.currentTarget) closeAddModal(); });

// Bascule dépense/revenu
document.querySelectorAll('.toggle-btn[data-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn[data-type]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentTxType = btn.dataset.type;
    populateTxCatSelect(currentTxType);
  });
});

// Recalcule l'alerte à chaque frappe sur le montant ou changement de catégorie
document.getElementById('tx-amount').addEventListener('input', checkBalanceAlert);
document.getElementById('tx-cat').addEventListener('change', checkBalanceAlert);

document.getElementById('saveTransaction').addEventListener('click', () => {
  const amount = parseFloat(document.getElementById('tx-amount').value);
  const date   = document.getElementById('tx-date').value;
  const cat    = document.getElementById('tx-cat').value;
  const note   = document.getElementById('tx-note').value.trim();

  if (!amount || amount <= 0) return showToast('Montant invalide', true);
  if (!date)                  return showToast('Veuillez choisir une date', true);
  if (!cat)                   return showToast('Veuillez choisir une catégorie', true);

  // Bloquer si solde insuffisant (sauf remboursement d'emprunt)
  if (currentTxType === 'expense' && cat !== DEBT_EXPENSE_ID) {
    const balance = getCurrentCumulativeBalance();
    if (amount > balance) {
      document.getElementById('alert-insufficient').style.display = 'flex';
      return; // on n'enregistre pas
    }
  }

  // Libellé automatique basé sur la catégorie
  const catMap  = getCatMap();
  const catInfo = catMap[cat] || { label: 'Transaction' };
  const label   = catInfo.icon + ' ' + catInfo.label;

  state.transactions.unshift({ id: Date.now() + Math.random(), type: currentTxType, label, amount, date, category: cat, note });
  save(); closeAddModal(); showToast('Transaction ajoutée ✓'); renderAll();
});

/* ══════════════════════════════════════════════════════
   MODAL BUDGET
   ══════════════════════════════════════════════════════ */
function populateBudgetCatSelect() {
  const sel = document.getElementById('budget-cat');
  sel.innerHTML = '';
  state.categories.filter(c => c.type === 'expense').forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.icon + ' ' + c.label; sel.appendChild(opt);
  });
}
document.getElementById('openBudgetModal').addEventListener('click', () => {
  populateBudgetCatSelect();
  document.getElementById('budget-limit').value = '';
  document.getElementById('modal-budget').classList.add('open');
});
document.getElementById('closeBudgetModal').addEventListener('click', () =>
  document.getElementById('modal-budget').classList.remove('open'));
document.getElementById('modal-budget').addEventListener('click', e => {
  if (e.target===e.currentTarget) document.getElementById('modal-budget').classList.remove('open');
});
document.getElementById('saveBudget').addEventListener('click', () => {
  const cat   = document.getElementById('budget-cat').value;
  const limit = parseFloat(document.getElementById('budget-limit').value);
  if (!cat)             return showToast('Choisissez une catégorie', true);
  if (!limit||limit<=0) return showToast('Montant invalide', true);
  state.budgets[cat] = limit; save();
  document.getElementById('modal-budget').classList.remove('open');
  showToast('Budget enregistré ✓'); renderBudgets();
});

/* ══════════════════════════════════════════════════════
   MODAL CATÉGORIE
   ══════════════════════════════════════════════════════ */
let currentCatType = 'expense';
document.getElementById('openCatModal').addEventListener('click', () => {
  currentCatType = 'expense';
  document.querySelectorAll('.toggle-btn[data-cattype]').forEach(b =>
    b.classList.toggle('active', b.dataset.cattype === 'expense'));
  document.getElementById('cat-name').value  = '';
  document.getElementById('cat-icon').value  = '';
  document.getElementById('cat-color').value = '#e8c547';
  document.getElementById('modal-cat').classList.add('open');
});
document.getElementById('closeCatModal').addEventListener('click', () =>
  document.getElementById('modal-cat').classList.remove('open'));
document.getElementById('modal-cat').addEventListener('click', e => {
  if (e.target===e.currentTarget) document.getElementById('modal-cat').classList.remove('open');
});
document.querySelectorAll('.toggle-btn[data-cattype]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.toggle-btn[data-cattype]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active'); currentCatType = btn.dataset.cattype;
  });
});
document.getElementById('saveCat').addEventListener('click', () => {
  const name  = document.getElementById('cat-name').value.trim();
  const icon  = document.getElementById('cat-icon').value.trim() || '◇';
  const color = document.getElementById('cat-color').value;
  if (!name) return showToast('Veuillez saisir un nom', true);
  state.categories.push({ id: 'custom_' + Date.now(), label: name, type: currentCatType, icon, color, deletable: true });
  save(); document.getElementById('modal-cat').classList.remove('open');
  showToast('Catégorie créée ✓'); renderCategories();
});

let pendingDeleteCatId = null;
function askDeleteCategory(id) {
  pendingDeleteCatId = id;
  document.getElementById('modal-confirm-cat').classList.add('open');
}
document.getElementById('cancelDeleteCat').addEventListener('click', () => {
  pendingDeleteCatId = null;
  document.getElementById('modal-confirm-cat').classList.remove('open');
});
document.getElementById('confirmDeleteCat').addEventListener('click', () => {
  if (!pendingDeleteCatId) return;
  const cat = state.categories.find(c => c.id === pendingDeleteCatId);
  const fb  = cat && cat.type === 'expense' ? 'autre_dep' : 'autre_inc';
  state.transactions.forEach(t => { if (t.category === pendingDeleteCatId) t.category = fb; });
  delete state.budgets[pendingDeleteCatId];
  state.categories = state.categories.filter(c => c.id !== pendingDeleteCatId);
  pendingDeleteCatId = null; save();
  document.getElementById('modal-confirm-cat').classList.remove('open');
  showToast('Catégorie supprimée'); renderAll();
});

/* ══════════════════════════════════════════════════════
   FILTRES
   ══════════════════════════════════════════════════════ */
function populateFilterCat() {
  const sel = document.getElementById('filter-cat');
  sel.innerHTML = '<option value="all">Toutes catégories</option>';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id; opt.textContent = c.icon + ' ' + c.label; sel.appendChild(opt);
  });
}
['search','filter-type','filter-cat'].forEach(id => {
  const el = document.getElementById(id);
  el.addEventListener('input', renderAllTx); el.addEventListener('change', renderAllTx);
});

/* ══════════════════════════════════════════════════════
   TOAST
   ══════════════════════════════════════════════════════ */
function showToast(msg, error) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (error ? ' error' : '');
  clearTimeout(t._tid); t._tid = setTimeout(() => t.classList.remove('show'), 2800);
}

/* ══════════════════════════════════════════════════════
   KPIs
   ══════════════════════════════════════════════════════ */
function renderKPIs() {
  const txs      = currentMonthTx();
  const income   = sumType(txs, 'income');
  const expense  = sumType(txs, 'expense');
  const monthSav = income - expense;
  const carryOver= getCumulativeSavingsBeforeCurrentMonth();
  const balance  = carryOver + monthSav;

  document.getElementById('kpi-income').textContent  = fmt(income);
  document.getElementById('kpi-expense').textContent = fmt(expense);
  document.getElementById('kpi-balance').textContent = fmt(balance);
  document.getElementById('kpi-savings').textContent = fmt(monthSav);
  document.getElementById('kpi-balance-trend').textContent = balance >= 0 ? '↑ Excédent cumulé' : '↓ Déficit cumulé';
}

/* ══════════════════════════════════════════════════════
   CARTE DETTE
   ══════════════════════════════════════════════════════ */
function renderDette() {
  const dette      = getTotalDette();
  const detteVal   = document.getElementById('dette-value');
  const detteBadge = document.getElementById('dette-badge');
  detteVal.textContent = fmt(dette);
  if (dette > 0) {
    detteBadge.textContent = '⚠ Dette en cours';
    detteBadge.className   = 'dette-badge has-debt';
  } else {
    detteBadge.textContent = '✓ Aucune dette';
    detteBadge.className   = 'dette-badge';
  }
}

/* ══════════════════════════════════════════════════════
   LISTE RÉCENTE
   ══════════════════════════════════════════════════════ */
function renderRecentList() {
  const list = document.getElementById('recent-list');
  const txs  = currentMonthTx().slice(0, 6);
  list.innerHTML = '';
  if (!txs.length) { list.innerHTML = '<li class="tx-empty">Aucune transaction ce mois</li>'; return; }
  txs.forEach(t => list.appendChild(makeTxItem(t)));
}

function isDebtTx(t) {
  return (t.type === 'income'  && t.category === DEBT_INCOME_ID) ||
         (t.type === 'expense' && t.category === DEBT_EXPENSE_ID);
}

function makeTxItem(t) {
  const catMap = getCatMap();
  const cat    = catMap[t.category] || { icon:'◇', label:'Autre', color:'#888' };
  const debt   = isDebtTx(t);
  // Classe de couleur : dette = vert vif spécial, sinon type normal
  const dotCls    = debt ? 'debt' : t.type;
  const amountCls = debt ? 'debt' : t.type;
  const sign      = t.type === 'expense' ? '-' : '+';

  const li = document.createElement('li');
  li.className = 'tx-item';
  li.innerHTML = `
    <span class="tx-dot ${dotCls}"></span>
    <div class="tx-info">
      <div class="tx-label-text">${esc(t.label)}</div>
      <div class="tx-meta">${fmtDate(t.date)} · ${esc(cat.label)}${t.note ? ' · ' + esc(t.note) : ''}</div>
    </div>
    <span class="tx-amount ${amountCls}">${sign}${fmt(t.amount)}</span>
    <button class="tx-delete" title="Supprimer">✕</button>
  `;
  li.querySelector('.tx-delete').addEventListener('click', () => deleteTx(t.id));
  return li;
}

function deleteTx(id) {
  state.transactions = state.transactions.filter(t => t.id !== id);
  save(); showToast('Transaction supprimée'); renderAll();
}

/* ══════════════════════════════════════════════════════
   ALL TRANSACTIONS
   ══════════════════════════════════════════════════════ */
function renderAllTx() {
  const search = document.getElementById('search').value.toLowerCase();
  const typeF  = document.getElementById('filter-type').value;
  const catF   = document.getElementById('filter-cat').value;
  const txs    = currentMonthTx()
    .filter(t => !search || t.label.toLowerCase().includes(search) || (t.note||'').toLowerCase().includes(search))
    .filter(t => typeF==='all' || t.type===typeF)
    .filter(t => catF==='all'  || t.category===catF);
  const list = document.getElementById('all-tx-list');
  list.innerHTML = '';
  if (!txs.length) { list.innerHTML = '<li class="tx-empty">Aucune transaction</li>'; return; }
  txs.forEach(t => list.appendChild(makeTxItem(t)));
}

/* ══════════════════════════════════════════════════════
   DONUT
   ══════════════════════════════════════════════════════ */
function renderDonut() {
  const txs     = currentMonthTx();
  const totals  = catTotalsOfType(txs, 'expense');
  const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]).slice(0,6);
  const total   = entries.reduce((s,[,v])=>s+v,0);
  const catMap  = getCatMap();
  const svg     = document.getElementById('donut-svg');
  const legend  = document.getElementById('donut-legend');
  const center  = document.getElementById('donut-center');

  svg.innerHTML    = '<circle cx="100" cy="100" r="70" fill="none" stroke="var(--donut-bg)" stroke-width="30"/>';
  legend.innerHTML = '';
  if (!total) { center.innerHTML = '<span>—</span>'; return; }
  center.innerHTML = `<span style="font-size:.65rem;color:var(--muted)">${fmt(total)}</span>`;

  const circ = 2*Math.PI*70; let offset = 0;
  entries.forEach(([catId,val]) => {
    const cat  = catMap[catId] || { color:'#888', icon:'◇', label:'Autre' };
    const dash = (val/total)*circ;
    const c    = document.createElementNS('http://www.w3.org/2000/svg','circle');
    c.setAttribute('cx',100); c.setAttribute('cy',100); c.setAttribute('r',70);
    c.setAttribute('fill','none'); c.setAttribute('stroke',cat.color); c.setAttribute('stroke-width',30);
    c.setAttribute('stroke-dasharray',`${dash} ${circ-dash}`);
    c.setAttribute('stroke-dashoffset',-offset);
    svg.appendChild(c); offset += dash;
    const li = document.createElement('li');
    li.className = 'legend-item';
    li.innerHTML = `<span class="legend-dot" style="background:${cat.color}"></span>${cat.icon} ${esc(cat.label)}<span style="margin-left:auto;color:var(--text);font-size:.73rem">${fmt(val)}</span>`;
    legend.appendChild(li);
  });
}

/* ══════════════════════════════════════════════════════
   HISTOGRAMME 6 MOIS
   ══════════════════════════════════════════════════════ */
function renderBarChart() {
  const container = document.getElementById('bar-chart');
  container.innerHTML = '';
  const data = getSixMonths().map(({y,m}) => {
    const txs = txOfMonth(y,m);
    const inc = sumType(txs,'income'), exp = sumType(txs,'expense');
    return { label: MONTH_FR[m].slice(0,3), income:inc, expense:exp, savings:Math.max(0,inc-exp) };
  });
  const max = Math.max(...data.flatMap(d=>[d.income,d.expense,d.savings]),1);
  const H   = 82;
  data.forEach(d => {
    const grp = document.createElement('div');
    grp.className = 'bar-group';
    grp.innerHTML = `
      <div class="bar-cols">
        <div class="bar income-bar"  style="height:${Math.round(d.income/max*H)}px"  title="Revenus : ${fmt(d.income)}"></div>
        <div class="bar expense-bar" style="height:${Math.round(d.expense/max*H)}px" title="Dépenses : ${fmt(d.expense)}"></div>
        <div class="bar savings-bar" style="height:${Math.round(d.savings/max*H)}px" title="Épargne : ${fmt(d.savings)}"></div>
      </div>
      <div class="bar-label">${d.label}</div>`;
    container.appendChild(grp);
  });
}

/* ══════════════════════════════════════════════════════
   COURBE D'ÉVOLUTION 6 MOIS
   ══════════════════════════════════════════════════════ */
function renderLineChart() {
  const svg    = document.getElementById('line-svg');
  const labels = document.getElementById('line-x-labels');
  if (!svg || !labels) return;
  svg.innerHTML = ''; labels.innerHTML = '';

  const data = getSixMonths().map(({y,m}) => {
    const txs = txOfMonth(y,m);
    const inc = sumType(txs,'income'), exp = sumType(txs,'expense');
    return { label: MONTH_FR[m].slice(0,3), income:inc, expense:exp, savings:Math.max(0,inc-exp) };
  });

  const W=600, H=160, PL=42, PR=10, PT=12, PB=22;
  const plotW=W-PL-PR, plotH=H-PT-PB;
  const allV  = data.flatMap(d=>[d.income,d.expense,d.savings]);
  const maxV  = Math.max(...allV,1);
  const n     = data.length;
  const xAt   = i => PL + (i/(n-1))*plotW;
  const yAt   = v => PT + plotH - (v/maxV)*plotH;

  const cs        = getComputedStyle(document.documentElement);
  const gridColor = cs.getPropertyValue('--grid-line').trim() || 'rgba(128,128,128,.15)';
  const mutedC    = cs.getPropertyValue('--muted').trim()     || '#888';
  const cGreen    = cs.getPropertyValue('--green').trim()     || '#3ecf8e';
  const cRed      = cs.getPropertyValue('--red').trim()       || '#f0605b';
  const cAccent   = cs.getPropertyValue('--accent').trim()    || '#e8c547';

  [0,.25,.5,.75,1].forEach(f => {
    const yy = yAt(f*maxV);
    const ln = document.createElementNS('http://www.w3.org/2000/svg','line');
    ln.setAttribute('x1',PL); ln.setAttribute('x2',W-PR);
    ln.setAttribute('y1',yy); ln.setAttribute('y2',yy);
    ln.setAttribute('stroke',gridColor); ln.setAttribute('stroke-width','1');
    svg.appendChild(ln);
    const lbl = document.createElementNS('http://www.w3.org/2000/svg','text');
    lbl.setAttribute('x',PL-4); lbl.setAttribute('y',yy+3);
    lbl.setAttribute('fill',mutedC); lbl.setAttribute('font-size','8');
    lbl.setAttribute('text-anchor','end'); lbl.setAttribute('font-family','DM Mono,monospace');
    lbl.textContent = Math.round(f*maxV/1000)+'k';
    svg.appendChild(lbl);
  });

  function drawSeries(key, color, fillOp) {
    const pts = data.map((d,i) => ({ x:xAt(i), y:yAt(d[key]) }));
    const areaD = [`M ${pts[0].x} ${yAt(0)}`,...pts.map(p=>`L ${p.x} ${p.y}`),`L ${pts[n-1].x} ${yAt(0)}`,'Z'].join(' ');
    const area  = document.createElementNS('http://www.w3.org/2000/svg','path');
    area.setAttribute('d',areaD); area.setAttribute('fill',color); area.setAttribute('fill-opacity',fillOp);
    svg.appendChild(area);
    const lineD = pts.map((p,i)=>(i===0?`M ${p.x} ${p.y}`:`L ${p.x} ${p.y}`)).join(' ');
    const line  = document.createElementNS('http://www.w3.org/2000/svg','path');
    line.setAttribute('d',lineD); line.setAttribute('fill','none');
    line.setAttribute('stroke',color); line.setAttribute('stroke-width','2.2');
    line.setAttribute('stroke-linejoin','round'); line.setAttribute('stroke-linecap','round');
    svg.appendChild(line);
    pts.forEach((p,i) => {
      const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
      dot.setAttribute('cx',p.x); dot.setAttribute('cy',p.y); dot.setAttribute('r','4');
      dot.setAttribute('fill',color); dot.setAttribute('stroke','var(--card)'); dot.setAttribute('stroke-width','2');
      const title = document.createElementNS('http://www.w3.org/2000/svg','title');
      title.textContent = `${data[i].label} : ${fmt(data[i][key])}`;
      dot.appendChild(title); svg.appendChild(dot);
    });
  }
  drawSeries('income', cGreen, .12);
  drawSeries('expense',cRed,   .10);
  drawSeries('savings',cAccent,.10);
  data.forEach(d => {
    const sp = document.createElement('span'); sp.textContent = d.label; labels.appendChild(sp);
  });
}

/* ══════════════════════════════════════════════════════
   BUDGETS
   ══════════════════════════════════════════════════════ */
function renderBudgets() {
  const grid    = document.getElementById('budget-grid');
  const catMap  = getCatMap();
  const entries = Object.entries(state.budgets);
  grid.innerHTML = '';
  if (!entries.length) { grid.innerHTML = '<p class="tx-empty" style="grid-column:1/-1">Aucun budget défini</p>'; return; }
  const spent = catTotalsOfType(currentMonthTx().filter(t=>t.type==='expense'), 'expense');
  entries.forEach(([catId,limit]) => {
    const cat  = catMap[catId] || { icon:'◇', label:'Autre', color:'#888' };
    const used = spent[catId]  || 0;
    const pct  = Math.min((used/limit)*100, 100);
    const cls  = pct>=100?'danger':pct>=75?'warn':'';
    const card = document.createElement('div');
    card.className = 'budget-card';
    card.innerHTML = `
      <div class="budget-card-header">
        <div class="budget-cat-name"><span style="color:${cat.color}">${cat.icon}</span> ${esc(cat.label)}</div>
        <button class="budget-delete" title="Supprimer">✕</button>
      </div>
      <div class="budget-amounts">
        <span class="budget-spent">${fmt(used)}</span><span>/ ${fmt(limit)}</span>
      </div>
      <div class="budget-bar-bg"><div class="budget-bar-fill ${cls}" style="width:${pct}%"></div></div>
      <div style="font-family:'DM Mono',monospace;font-size:.7rem;color:var(--muted);text-align:right">${Math.round(pct)} %</div>`;
    card.querySelector('.budget-delete').addEventListener('click', () => {
      delete state.budgets[catId]; save(); showToast('Budget supprimé'); renderBudgets();
    });
    grid.appendChild(card);
  });
}

/* ══════════════════════════════════════════════════════
   STATISTIQUES
   ══════════════════════════════════════════════════════ */
function renderStats() {
  const catMap  = getCatMap();
  const totals  = catTotalsOfType(currentMonthTx(), 'expense');
  const entries = Object.entries(totals).sort((a,b)=>b[1]-a[1]);
  const topMax  = entries[0] ? entries[0][1] : 1;
  const topDiv  = document.getElementById('stats-top-cat');
  topDiv.innerHTML = '';
  if (!entries.length) {
    topDiv.innerHTML = '<p class="tx-empty">Aucune dépense ce mois</p>';
  } else {
    entries.forEach(([catId,val]) => {
      const cat = catMap[catId] || { icon:'◇', label:'Autre', color:'#888' };
      const pct = (val/topMax)*100;
      const row = document.createElement('div');
      row.className = 'stat-row';
      row.innerHTML = `
        <div class="stat-cat-name"><span style="color:${cat.color}">${cat.icon}</span> ${esc(cat.label)}</div>
        <div class="stat-cat-bar"><div class="stat-cat-fill" style="width:${pct}%;background:${cat.color}"></div></div>
        <div class="stat-cat-val">${fmt(val)}</div>`;
      topDiv.appendChild(row);
    });
  }
  const body = document.getElementById('stats-annual-body');
  body.innerHTML = '';
  const { year, month } = state.viewMonth;
  for (let i=11; i>=0; i--) {
    let m = month-i, y = year;
    if (m<0) { m+=12; y--; }
    const mtxs = txOfMonth(y,m);
    const inc  = sumType(mtxs,'income');
    const exp  = sumType(mtxs,'expense');
    const sav  = inc - exp;
    const savColor = sav>=0?'var(--green)':'var(--red)';
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${MONTH_FR[m].slice(0,3)} ${y}</td>
      <td class="col-income">${inc>0?'+'+fmt(inc):'—'}</td>
      <td class="col-expense">${exp>0?'-'+fmt(exp):'—'}</td>
      <td style="color:${savColor};font-weight:600">${inc===0&&exp===0?'—':(sav>=0?'+':'')+fmt(sav)}</td>`;
    body.appendChild(tr);
  }
}

/* ══════════════════════════════════════════════════════
   CATÉGORIES
   ══════════════════════════════════════════════════════ */
function renderCategories() {
  const expGrid = document.getElementById('cat-grid-expense');
  const incGrid = document.getElementById('cat-grid-income');
  expGrid.innerHTML = ''; incGrid.innerHTML = '';
  state.categories.forEach(cat => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.innerHTML = `
      <div class="cat-card-left">
        <div class="cat-icon-badge" style="background:${cat.color}22">
          <span style="color:${cat.color}">${cat.icon}</span>
        </div>
        <div class="cat-info">
          <span class="cat-name">${esc(cat.label)}</span>
          <span class="cat-type">${cat.type==='expense'?'Dépense':'Revenu'}</span>
        </div>
      </div>
      <button class="cat-delete" ${cat.deletable?'':'disabled title="Catégorie système"'}>✕</button>`;
    if (cat.deletable)
      card.querySelector('.cat-delete').addEventListener('click', () => askDeleteCategory(cat.id));
    (cat.type==='expense'?expGrid:incGrid).appendChild(card);
  });
  if (!expGrid.children.length) expGrid.innerHTML = '<p class="tx-empty">Aucune catégorie</p>';
  if (!incGrid.children.length) incGrid.innerHTML = '<p class="tx-empty">Aucune catégorie</p>';
}

/* ══════════════════════════════════════════════════════
   INIT
   ══════════════════════════════════════════════════════ */
function init() {
  initState();
  const saved = localStorage.getItem('depensiq_theme');
  isDark = saved ? saved === 'dark' : true;
  applyTheme(false);
  populateTxCatSelect('expense');
  populateFilterCat();
  renderAll();
}

init();
