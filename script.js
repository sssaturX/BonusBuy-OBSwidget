const STORAGE_KEY = 'bonus_buy_widget_v3';
const list = document.querySelector('#bonusList');
const openedSummary = document.querySelector('#openedSummary');
const template = document.querySelector('#rowTemplate');
const sessionNumberInput = document.querySelector('#sessionNumber');
const currencySelect = document.querySelector('#currencySelect');
const rubles = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
const compactNumbers = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });
const IS_SERVER = location.protocol === 'http:' || location.protocol === 'https:';
const IS_ADMIN = !IS_SERVER || location.pathname.replace(/\/+$/, '').endsWith('/admin');

let currentIndex = 0;
let lastRevision = '';
let saveTimer = 0;
let applyingRemoteState = false;
let currency = '₽';

document.body.classList.toggle('admin-mode', IS_ADMIN);

function fitWidgetToWindow() {
  const baseWidth = 480;
  const baseHeight = IS_ADMIN ? 600 : 523;
  const scale = Math.max(0.1, Math.min(
    window.innerWidth / baseWidth,
    window.innerHeight / baseHeight
  ));
  const renderedWidth = baseWidth * scale;

  document.documentElement.style.setProperty('--widget-scale', String(scale));
  document.documentElement.style.setProperty(
    '--widget-left',
    `${Math.max(0, (window.innerWidth - renderedWidth) / 2) / scale}px`
  );
}

fitWidgetToWindow();
window.addEventListener('resize', fitWidgetToWindow);

const amount = input => Math.max(0, Number(String(input.value).replace(',', '.')) || 0);
const money = value => {
  const formatted = value >= 1000
    ? `${compactNumbers.format(value / 1000)}k`
    : rubles.format(value);
  return `${currency}${formatted}`;
};
const multiplier = (payout, buy) => buy > 0 ? payout / buy : 0;

function rowData(row) {
  const payoutInput = row.querySelector('.payout-input');
  return {
    name: row.querySelector('.name-input').value.trim(),
    buy: amount(row.querySelector('.buy-input')),
    payout: amount(payoutInput),
    opened: payoutInput.value.trim() !== ''
  };
}

function getState() {
  return {
    rows: [...list.children].map(rowData),
    currentIndex,
    sessionNumber: sessionNumberInput.value.trim() || '#1',
    currency
  };
}

function getAdminToken() {
  let token = sessionStorage.getItem('bonus_buy_admin_token') || '';
  if (!token && IS_ADMIN && IS_SERVER) {
    token = window.prompt('Введите ADMIN_TOKEN для управления виджетом:') || '';
    if (token) sessionStorage.setItem('bonus_buy_admin_token', token);
  }
  return token;
}

async function saveToServer() {
  if (!IS_ADMIN || applyingRemoteState) return;
  if (!IS_SERVER) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(getState()));
    return;
  }

  try {
    const response = await fetch('/api/state', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getAdminToken()}`
      },
      body: JSON.stringify(getState())
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    lastRevision = state.updatedAt || lastRevision;
    document.body.classList.remove('save-error');
  } catch (error) {
    console.error('Не удалось сохранить состояние виджета:', error);
    document.body.classList.add('save-error');
  }
}

function scheduleSave() {
  if (!IS_ADMIN || applyingRemoteState) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveToServer, 180);
}

function keepCurrentVisible() {
  const row = list.children[currentIndex];
  if (!row) return;

  const rowTop = row.offsetTop - list.offsetTop;
  const rowBottom = rowTop + row.offsetHeight;
  const visibleTop = list.scrollTop;
  const visibleBottom = visibleTop + list.clientHeight;

  if (rowTop < visibleTop) {
    list.scrollTop = rowTop;
  } else if (rowBottom > visibleBottom) {
    list.scrollTop = rowBottom - list.clientHeight;
  }
}

function selectRow(index, focusField = false) {
  if (!IS_ADMIN) return;
  const rows = [...list.children];
  if (!rows.length) return;
  currentIndex = Math.min(Math.max(0, index), rows.length - 1);
  update();
  const row = rows[currentIndex];
  keepCurrentVisible();
  if (focusField) {
    const firstEmpty = [...row.querySelectorAll('input')].find(input => !input.value.trim());
    (firstEmpty || row.querySelector('.name-input')).focus();
  }
}

function update() {
  const rows = [...list.children];
  const data = rows.map(rowData);
  currentIndex = Math.min(Math.max(0, currentIndex), Math.max(0, rows.length - 1));

  const totalBuy = data.reduce((sum, item) => sum + item.buy, 0);
  const totalPayout = data.reduce((sum, item) => sum + item.payout, 0);
  const opened = data.filter(item => item.opened);
  const openedBuy = opened.reduce((sum, item) => sum + item.buy, 0);
  const openedPayout = opened.reduce((sum, item) => sum + item.payout, 0);
  const remainingBuy = data.filter(item => !item.opened).reduce((sum, item) => sum + item.buy, 0);
  const amountToBreakEven = Math.max(0, totalBuy - totalPayout);
  const neededX = remainingBuy > 0 ? amountToBreakEven / remainingBuy : 0;
  const averageX = openedBuy > 0 ? openedPayout / openedBuy : 0;
  const bestPayout = Math.max(0, ...opened.map(item => item.payout));

  openedSummary.replaceChildren();
  opened
    .map(item => ({ ...item, sourceIndex: data.indexOf(item) }))
    .sort((a, b) => multiplier(b.payout, b.buy) - multiplier(a.payout, a.buy))
    .slice(0, 2)
    .forEach((item, index) => {
      const summaryRow = document.createElement('div');
      summaryRow.className = 'summary-row';
      summaryRow.innerHTML = `
        <span class="summary-rank">${index === 0 ? '♛' : '♜'} ${item.sourceIndex + 1}.</span>
        <strong></strong>
        <span>(${money(item.buy)}) = ${money(item.payout)}</span>
        <b>${multiplier(item.payout, item.buy).toFixed(2)}X</b>
      `;
      summaryRow.querySelector('strong').textContent = item.name || 'БЕЗ НАЗВАНИЯ';
      openedSummary.appendChild(summaryRow);
    });
  openedSummary.hidden = opened.length === 0;

  rows.forEach((row, index) => {
    const item = data[index];
    const x = multiplier(item.payout, item.buy);
    row.querySelector('.row-number').textContent = `${index + 1}.`;
    row.querySelector('.buy-display').textContent = money(item.buy);
    row.querySelector('.payout-display').textContent = item.opened ? money(item.payout) : '';
    row.querySelector('.row-x').textContent = item.opened ? `${x.toFixed(2)}X` : '';
    row.classList.toggle('opened', item.opened);
    row.classList.toggle('best', item.opened && item.payout === bestPayout);
    row.classList.toggle('current', index === currentIndex);
    row.setAttribute('aria-current', index === currentIndex ? 'true' : 'false');
  });

  document.querySelector('#totalBuy').textContent = money(totalBuy);
  document.querySelector('#neededX').textContent = `${neededX.toFixed(2)}x`;
  document.querySelector('#averageX').textContent = `${averageX.toFixed(2)}x`;
  document.querySelector('#counter').textContent = `${opened.length}/${rows.length}`;
  scheduleSave();
}

function addRow(data = {}, focus = false) {
  const row = template.content.firstElementChild.cloneNode(true);
  row.querySelector('.name-input').value = data.name || '';
  row.querySelector('.buy-input').value = data.buy || '';
  row.querySelector('.payout-input').value = data.opened ? data.payout : (data.payout || '');
  row.querySelectorAll('input').forEach(input => {
    input.readOnly = !IS_ADMIN;
    input.tabIndex = IS_ADMIN ? 0 : -1;
    input.addEventListener('input', update);
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const inputs = [...row.querySelectorAll('input')];
      const next = inputs[inputs.indexOf(input) + 1];
      if (next) {
        next.focus();
      } else {
        const rowIndex = [...list.children].indexOf(row);
        if (rowIndex === list.children.length - 1) addRow({}, false);
        selectRow(rowIndex + 1, true);
      }
    });
  });

  row.addEventListener('click', event => {
    if (!IS_ADMIN || event.target.closest('.delete-row')) return;
    selectRow([...list.children].indexOf(row));
  });

  row.querySelector('.delete-row').addEventListener('click', () => {
    if (!IS_ADMIN) return;
    row.classList.add('removing');
    setTimeout(() => {
      row.remove();
      if (!list.children.length) addRow({}, true);
      currentIndex = Math.min(currentIndex, list.children.length - 1);
      update();
    }, 140);
  });

  list.appendChild(row);
  if (focus) currentIndex = list.children.length - 1;
  if (focus) row.querySelector('.name-input').focus();
}

function applyState(state) {
  if (!state || !Array.isArray(state.rows)) return;
  applyingRemoteState = true;
  list.replaceChildren();
  state.rows.forEach(item => addRow(item));
  if (!list.children.length) addRow();
  currentIndex = Math.min(Math.max(0, Number(state.currentIndex) || 0), list.children.length - 1);
  sessionNumberInput.value = state.sessionNumber || '#1';
  currency = state.currency || '₽';
  currencySelect.value = currency;
  lastRevision = state.updatedAt || lastRevision;
  update();
  keepCurrentVisible();
  applyingRemoteState = false;
}

async function fetchState() {
  try {
    const response = await fetch('/api/state', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const state = await response.json();
    if (!lastRevision || state.updatedAt !== lastRevision) applyState(state);
  } catch (error) {
    console.error('Не удалось загрузить состояние виджета:', error);
  }
}

async function load() {
  if (IS_SERVER) {
    await fetchState();
    if (!list.children.length) applyState({ rows: [{}], currentIndex: 0 });
    if (!IS_ADMIN) setInterval(fetchState, 750);
    return;
  }

  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.rows)) {
      applyState(saved);
      return;
    }
  } catch (_) {}
  applyState({ rows: [{}], currentIndex: 0 });
}

document.querySelector('#addRow').addEventListener('click', () => {
  if (!IS_ADMIN) return;
  addRow({}, true);
  update();
});

sessionNumberInput.readOnly = !IS_ADMIN;
sessionNumberInput.tabIndex = IS_ADMIN ? 0 : -1;
sessionNumberInput.addEventListener('input', () => {
  if (!sessionNumberInput.value.startsWith('#')) {
    sessionNumberInput.value = `#${sessionNumberInput.value.replaceAll('#', '')}`;
  }
  scheduleSave();
});

currencySelect.addEventListener('change', () => {
  currency = currencySelect.value;
  update();
});

document.addEventListener('keydown', event => {
  if (!IS_ADMIN || event.target.matches('input')) return;
  if (event.key === 'ArrowUp') {
    event.preventDefault();
    selectRow(currentIndex - 1);
  }
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    selectRow(currentIndex + 1);
  }
});

load();
