(function () {
  'use strict';

  /* =========================================================
     Storage keys
     ========================================================= */
  var LS = {
    settings: 'invoiceflow:settings',
    form: 'invoiceflow:formData',
    clients: 'invoiceflow:clients',
    invoices: 'invoiceflow:invoices'
  };

  var UNITS = ['Hrs', 'Pcs', 'Kg', 'Ltr', 'Nos'];
  var DEFAULT_LINE_TAX = 18;

  /* =========================================================
     Central state
     ========================================================= */
  var state = {
    currency: 'USD',
    subtotal: 0,
    tax: 0,
    grandTotal: 0,
    status: 'Draft',
    selectedClientId: null,
    clients: [],
    invoices: [],
    activeTab: 'create',
    historyClientId: null,
    portalClientId: null
  };

  var rowIdCounter = 0;
  var toastTimer = null;

  /* =========================================================
     Small helpers
     ========================================================= */
  function $(id) { return document.getElementById(id); }

  function esc(value) {
    return String(value === null || value === undefined ? '' : value)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function uid(prefix) {
    return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed === null || parsed === undefined ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function num(value) {
    var n = parseFloat(value);
    return isNaN(n) ? 0 : n;
  }

  /* Currency-aware full string, e.g. "$1,234.00" */
  function money(amount, currency) {
    var value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency || state.currency,
        currencyDisplay: 'narrowSymbol'
      }).format(value);
    } catch (e) {
      return value.toFixed(2);
    }
  }

  /* Numeric-only string for the .currency-symbol + span layout */
  function formatMoney(amount) {
    var value = Number(amount) || 0;
    try {
      return new Intl.NumberFormat(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }).format(value);
    } catch (e) {
      return value.toFixed(2);
    }
  }

  function currencySymbol(currency) {
    try {
      var parts = new Intl.NumberFormat(undefined, {
        style: 'currency',
        currency: currency
      }).formatToParts(0);
      for (var i = 0; i < parts.length; i++) {
        if (parts[i].type === 'currency') return parts[i].value;
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  function toast(message, isError) {
    var el = $('toast');
    if (!el) return;
    el.textContent = message;
    el.className = 'toast' + (isError ? ' error' : '');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.className = 'toast hidden';
    }, 3200);
  }

  function statusClass(status) {
    return 'badge-' + String(status || 'Draft').toLowerCase();
  }

  function statusBadge(status) {
    return '<span class="badge ' + statusClass(status) + '">' + esc(status || 'Draft') + '</span>';
  }

  /* =========================================================
     DOM references
     ========================================================= */
  var itemsBody = $('items-body');
  var addItemBtn = $('add-item');
  var printBtn = $('print-invoice');
  var downloadPdfBtn = $('download-pdf');
  var saveInvoiceBtn = $('save-invoice');

  var subtotalEl = $('subtotal');
  var taxAmountEl = $('tax-amount');
  var grandTotalEl = $('grand-total');

  var dateInput = $('invoice-date');
  var numberInput = $('invoice-number');
  var currencySelect = $('currency-select');
  var statusSelect = $('invoice-status');

  var invoiceArea = $('invoice-area');
  var stampContainer = $('status-stamp-container');

  var fromName = $('from-name');
  var fromEmail = $('from-email');
  var fromAddress = $('from-address');
  var fromLogoInput = $('from-logo');
  var toName = $('to-name');
  var toEmail = $('to-email');
  var toAddress = $('to-address');
  var headerLogo = $('header-logo');

  var clientSelect = $('client-select');
  var clientForm = $('client-form');
  var clientName = $('client-name');
  var clientEmail = $('client-email');
  var clientAddress = $('client-address');
  var clientTaxId = $('client-tax-id');
  var clientsBody = $('clients-body');
  var clientsEmpty = $('clients-empty');

  var historyTitle = $('history-title');
  var historyEmpty = $('history-empty');
  var historyContent = $('history-content');
  var historyBody = $('history-body');
  var historySummary = $('history-summary');
  var statementBtn = $('generate-statement');

  var portalClientSelect = $('portal-client-select');
  var portalEmpty = $('portal-empty');
  var portalContent = $('portal-content');
  var portalSummary = $('portal-summary');
  var portalInvoices = $('portal-invoices');
  var portalInvoiceCount = $('portal-invoice-count');

  var pdfFileInput = $('pdf-file-input');
  var parsePdfsBtn = $('parse-pdfs');
  var importStatusEl = $('import-status');
  var importReviewWrap = $('import-review-wrap');
  var importReviewBody = $('import-review-body');
  var saveImportedBtn = $('save-imported');

  /* =========================================================
     Persistence
     ========================================================= */
  function saveSettings() {
    writeJSON(LS.settings, {
      currency: state.currency,
      status: state.status
    });
  }

  function loadSettings() {
    var data = readJSON(LS.settings, {});
    if (!data || typeof data !== 'object') return;

    if (typeof data.currency === 'string' && data.currency) state.currency = data.currency;
    if (typeof data.status === 'string') state.status = data.status;
  }

  function saveForm() {
    var data = {
      from: {
        name: fromName ? fromName.value : '',
        email: fromEmail ? fromEmail.value : '',
        address: fromAddress ? fromAddress.value : '',
        logo: (headerLogo && headerLogo.src && !headerLogo.classList.contains('hidden'))
          ? headerLogo.src
          : ''
      },
      to: {
        name: toName ? toName.value : '',
        email: toEmail ? toEmail.value : '',
        address: toAddress ? toAddress.value : ''
      }
    };
    writeJSON(LS.form, data);
  }

  function loadForm() {
    var data = readJSON(LS.form, null);
    if (!data || typeof data !== 'object') return;

    if (data.from) {
      if (fromName) fromName.value = data.from.name || '';
      if (fromEmail) fromEmail.value = data.from.email || '';
      if (fromAddress) fromAddress.value = data.from.address || '';
      if (data.from.logo && headerLogo) {
        headerLogo.src = data.from.logo;
        headerLogo.classList.remove('hidden');
      }
    }
    if (data.to) {
      if (toName) toName.value = data.to.name || '';
      if (toEmail) toEmail.value = data.to.email || '';
      if (toAddress) toAddress.value = data.to.address || '';
    }
  }

  function saveClients() {
    writeJSON(LS.clients, state.clients);
  }

  function saveInvoices() {
    writeJSON(LS.invoices, state.invoices);
  }

  function loadData() {
    var clients = readJSON(LS.clients, []);
    state.clients = Array.isArray(clients) ? clients : [];

    var invoices = readJSON(LS.invoices, []);
    state.invoices = Array.isArray(invoices) ? invoices : [];
  }

  /* =========================================================
     Tax / totals (Create tab)
     ========================================================= */
  function updateCurrencySymbols() {
    var symbol = currencySymbol(state.currency);
    var nodes = document.querySelectorAll('.currency-symbol');
    for (var i = 0; i < nodes.length; i++) {
      nodes[i].textContent = symbol ? symbol + '\u00A0' : '';
    }
  }

  /* Per-line math: amount = (qty x rate) - discount, tax = amount x tax% */
  function lineTotals(data) {
    var gross = data.quantity * data.rate;
    var discount = gross * (num(data.discountPct) / 100);
    var amount = gross - discount;
    var tax = amount * (num(data.taxPct) / 100);
    return { gross: gross, discount: discount, amount: amount, tax: tax };
  }

  function getRowData(row) {
    function val(selector) {
      var el = row.querySelector(selector);
      return el ? el.value : '';
    }

    return {
      id: row.getAttribute('data-row-id') || '',
      code: val('.item-code'),
      description: val('.item-description'),
      hsn: val('.item-hsn'),
      quantity: num(val('.item-quantity')),
      unit: val('.item-unit'),
      rate: num(val('.item-rate')),
      discountPct: num(val('.item-discount')),
      taxPct: num(val('.item-tax'))
    };
  }

  function calculateRow(row) {
    var data = getRowData(row);
    var totals = lineTotals(data);

    var amountCell = row.querySelector('.item-amount');
    var taxCell = row.querySelector('.item-tax-amount');
    if (amountCell) amountCell.textContent = formatMoney(totals.amount);
    if (taxCell) taxCell.textContent = formatMoney(totals.tax);

    return totals;
  }

  function recalcInvoice() {
    var subtotal = 0;
    var totalTax = 0;

    var rows = itemsBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var totals = calculateRow(rows[i]);
      subtotal += totals.amount;
      totalTax += totals.tax;
    }

    state.subtotal = subtotal;
    state.tax = totalTax;
    state.grandTotal = subtotal + totalTax;

    updateCurrencySymbols();

    if (subtotalEl) subtotalEl.textContent = formatMoney(state.subtotal);
    if (taxAmountEl) taxAmountEl.textContent = formatMoney(state.tax);
    if (grandTotalEl) grandTotalEl.textContent = formatMoney(state.grandTotal);
  }

  /* =========================================================
     Rows
     ========================================================= */
  function textCell(className, placeholder, value) {
    var td = document.createElement('td');
    var input = document.createElement('input');
    input.type = 'text';
    input.className = className;
    input.placeholder = placeholder;
    input.value = value || '';
    td.appendChild(input);
    return td;
  }

  function numberCell(className, step, value) {
    var td = document.createElement('td');
    var input = document.createElement('input');
    input.type = 'number';
    input.className = className;
    input.min = '0';
    input.step = String(step);
    input.value = value !== undefined && value !== null ? value : 0;
    td.appendChild(input);
    return td;
  }

  function unitCell(value) {
    var td = document.createElement('td');
    var select = document.createElement('select');
    select.className = 'item-unit';

    for (var i = 0; i < UNITS.length; i++) {
      var option = document.createElement('option');
      option.value = UNITS[i];
      option.textContent = UNITS[i];
      select.appendChild(option);
    }

    select.value = value || 'Nos';
    td.appendChild(select);
    return td;
  }

  function moneyCell(className, withSymbol) {
    var td = document.createElement('td');
    td.className = 'amount-cell';

    if (withSymbol) {
      var symbolSpan = document.createElement('span');
      symbolSpan.className = 'currency-symbol';
      symbolSpan.textContent = currencySymbol(state.currency) + '\u00A0';
      td.appendChild(symbolSpan);
    }

    var span = document.createElement('span');
    span.className = className;
    span.textContent = formatMoney(0);
    td.appendChild(span);

    return td;
  }

  function createRowElement(itemData) {
    var data = itemData || {};
    var rowId = data.id || ('row-' + (++rowIdCounter) + '-' + Date.now().toString(36));
    var tr = document.createElement('tr');
    tr.setAttribute('data-row-id', rowId);

    var codeTd = textCell('item-code', 'SKU-001', data.code);
    codeTd.className = 'col-code';

    var qtyValue = (data.quantity !== undefined && data.quantity !== null) ? data.quantity : 1;
    var rateValue = (data.rate !== undefined && data.rate !== null) ? data.rate : 0;
    var discountValue = (data.discountPct !== undefined && data.discountPct !== null) ? data.discountPct : 0;
    var taxValue = (data.taxPct !== undefined && data.taxPct !== null) ? data.taxPct : DEFAULT_LINE_TAX;

    var actionTd = document.createElement('td');
    actionTd.className = 'actions-col no-print';
    var removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-secondary remove-item';
    removeBtn.textContent = 'Remove';
    actionTd.appendChild(removeBtn);

    tr.appendChild(codeTd);
    tr.appendChild(textCell('item-description', 'Service or product', data.description));
    tr.appendChild(textCell('item-hsn', 'HSN/SAC', data.hsn));
    tr.appendChild(numberCell('item-quantity', 1, qtyValue));
    tr.appendChild(unitCell(data.unit));
    tr.appendChild(numberCell('item-rate', 0.01, rateValue));
    tr.appendChild(numberCell('item-discount', 0.01, discountValue));
    tr.appendChild(numberCell('item-tax', 0.01, taxValue));
    tr.appendChild(moneyCell('item-amount', true));
    tr.appendChild(moneyCell('item-tax-amount', true));
    tr.appendChild(actionTd);

    return tr;
  }

  function addItem(itemData) {
    itemsBody.appendChild(createRowElement(itemData));
    recalcInvoice();
  }

  function removeItem(row) {
    var rows = itemsBody.querySelectorAll('tr');
    if (rows.length === 1) {
      var desc = row.querySelector('.item-description');
      var qty = row.querySelector('.item-quantity');
      var rate = row.querySelector('.item-rate');
      if (desc) desc.value = '';
      if (qty) qty.value = '1';
      if (rate) rate.value = '0';
      var amount = row.querySelector('.item-amount');
      if (amount) amount.textContent = formatMoney(0);
    } else {
      row.parentNode.removeChild(row);
    }
    recalcInvoice();
  }

  function resetRows() {
    itemsBody.innerHTML = '';
    addItem({ description: '', quantity: 1, rate: 0 });
  }

  /* =========================================================
     Status stamp
     ========================================================= */
  function renderStamp() {
    if (!stampContainer) return;
    var status = state.status || 'Draft';
    stampContainer.innerHTML =
      '<div class="status-stamp ' + esc(status.toLowerCase()) + '">' + esc(status) + '</div>';
  }

  /* =========================================================
     Tab navigation
     ========================================================= */
  function switchTab(name) {
    state.activeTab = name;

    var buttons = document.querySelectorAll('.tab-btn');
    for (var i = 0; i < buttons.length; i++) {
      buttons[i].classList.toggle('active', buttons[i].getAttribute('data-tab') === name);
    }

    var panels = document.querySelectorAll('.tab-panel');
    for (var j = 0; j < panels.length; j++) {
      panels[j].classList.toggle('active', panels[j].id === 'tab-' + name);
    }

    if (name === 'clients') renderClients();
    if (name === 'portal') renderPortal();
    if (name === 'import') renderImportReview();
  }

  /* =========================================================
     Client helpers
     ========================================================= */
  function getClient(id) {
    for (var i = 0; i < state.clients.length; i++) {
      if (state.clients[i].id === id) return state.clients[i];
    }
    return null;
  }

  function invoicesForClient(clientId) {
    var client = getClient(clientId);
    var clientName = client ? String(client.name || '').trim().toLowerCase() : '';

    return state.invoices.filter(function (inv) {
      if (inv.clientId === clientId) return true;
      /* Imported invoices carry no client link — match on vendor name */
      if (inv.source === 'imported' && clientName) {
        return String(inv.clientName || '').trim().toLowerCase() === clientName;
      }
      return false;
    });
  }

  function findClientByEmail(email) {
    var value = String(email || '').trim().toLowerCase();
    if (!value) return null;
    for (var i = 0; i < state.clients.length; i++) {
      var c = state.clients[i];
      if (String(c.email || '').trim().toLowerCase() === value) return c;
    }
    return null;
  }

  function findClientByName(name) {
    var value = String(name || '').trim().toLowerCase();
    if (!value) return null;
    for (var i = 0; i < state.clients.length; i++) {
      var c = state.clients[i];
      if (String(c.name || '').trim().toLowerCase() === value) return c;
    }
    return null;
  }

  function groupTotals(invoices) {
    var groups = {};
    invoices.forEach(function (inv) {
      var cur = inv.currency || 'USD';
      if (!groups[cur]) groups[cur] = { billed: 0, paid: 0, outstanding: 0 };
      var total = Number(inv.total) || 0;
      groups[cur].billed += total;
      if (String(inv.status).toLowerCase() === 'paid') {
        groups[cur].paid += total;
      } else {
        groups[cur].outstanding += total;
      }
    });
    return groups;
  }

  /* =========================================================
     Create tab: client select
     ========================================================= */
  function renderClientSelects() {
    var options = '<option value="">— Select a saved client —</option>';
    state.clients.forEach(function (c) {
      options += '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    });
    if (clientSelect) {
      clientSelect.innerHTML = options;
      clientSelect.value = state.selectedClientId || '';
    }

    var portalOptions = '<option value="">— Select a client —</option>';
    state.clients.forEach(function (c) {
      portalOptions += '<option value="' + esc(c.id) + '">' + esc(c.name) + '</option>';
    });
    if (portalClientSelect) {
      portalClientSelect.innerHTML = portalOptions;
      portalClientSelect.value = state.portalClientId || '';
    }
  }

  /* =========================================================
     Clients & History tab
     ========================================================= */
  function renderClients() {
    renderClientSelects();

    if (!clientsBody) return;
    clientsBody.innerHTML = '';

    if (!state.clients.length) {
      if (clientsEmpty) clientsEmpty.classList.remove('hidden');
    } else {
      if (clientsEmpty) clientsEmpty.classList.add('hidden');
    }

    state.clients.forEach(function (client) {
      var count = invoicesForClient(client.id).length;

      var tr = document.createElement('tr');
      tr.className = 'clickable';
      if (state.historyClientId === client.id) tr.className += ' selected';
      tr.setAttribute('data-client-id', client.id);

      tr.innerHTML =
        '<td>' + esc(client.name) + '</td>' +
        '<td>' + esc(client.email || '—') + '</td>' +
        '<td>' + count + '</td>' +
        '<td class="actions-col">' +
          '<button type="button" class="btn btn-secondary btn-small statement-btn" data-id="' + esc(client.id) + '">Statement</button>' +
        '</td>';

      clientsBody.appendChild(tr);
    });

    renderHistory();
  }

  function selectHistoryClient(clientId) {
    state.historyClientId = clientId;
    renderClients();
  }

  function renderHistory() {
    var client = getClient(state.historyClientId);

    if (!client) {
      if (historyEmpty) historyEmpty.classList.remove('hidden');
      if (historyContent) historyContent.classList.add('hidden');
      if (statementBtn) statementBtn.classList.add('hidden');
      if (historyTitle) historyTitle.textContent = 'Client History';
      return;
    }

    var invoices = invoicesForClient(client.id).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    if (historyEmpty) historyEmpty.classList.add('hidden');
    if (historyContent) historyContent.classList.remove('hidden');
    if (statementBtn) statementBtn.classList.remove('hidden');
    if (historyTitle) historyTitle.textContent = client.name + ' — History';

    var groups = groupTotals(invoices);
    var currencies = Object.keys(groups);

    var summaryHtml = '';
    if (!currencies.length) {
      summaryHtml =
        '<div class="summary-card"><span class="summary-label">Total Billed</span>' +
        '<strong class="summary-value">' + esc(money(0, state.currency)) + '</strong></div>' +
        '<div class="summary-card"><span class="summary-label">Total Paid</span>' +
        '<strong class="summary-value">' + esc(money(0, state.currency)) + '</strong></div>' +
        '<div class="summary-card"><span class="summary-label">Outstanding</span>' +
        '<strong class="summary-value">' + esc(money(0, state.currency)) + '</strong></div>';
    } else {
      summaryHtml += summaryCardHtml('Total Billed', groups, 'billed', false);
      summaryHtml += summaryCardHtml('Total Paid', groups, 'paid', false);
      summaryHtml += summaryCardHtml('Total Outstanding', groups, 'outstanding', true);
    }
    historySummary.innerHTML = summaryHtml;

    historyBody.innerHTML = invoices.length
      ? invoices.map(function (inv) {
          var originalBtn = inv.source === 'imported'
            ? '<button type="button" class="btn btn-secondary btn-small view-original" data-id="' + esc(inv.id) + '">View Original PDF</button>'
            : '';
          return '<tr>' +
            '<td>' + esc(inv.number) + '</td>' +
            '<td>' + esc(inv.date) + '</td>' +
            '<td class="amount-cell">' + esc(money(inv.total, inv.currency)) + '</td>' +
            '<td>' + statusBadge(inv.status) + '</td>' +
            '<td class="actions-col">' + originalBtn + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="5" class="empty-state">No invoices for this client yet.</td></tr>';
  }

  function summaryCardHtml(label, groups, key, danger) {
    var currencies = Object.keys(groups);
    var valueHtml;

    if (currencies.length === 1) {
      valueHtml = '<strong class="summary-value">' +
        esc(money(groups[currencies[0]][key], currencies[0])) + '</strong>';
    } else {
      valueHtml = '<div class="summary-list">' + currencies.map(function (cur) {
        return '<div class="summary-line"><span>' + esc(cur) + '</span>' +
          '<strong>' + esc(money(groups[cur][key], cur)) + '</strong></div>';
      }).join('') + '</div>';
    }

    return '<div class="summary-card' + (danger ? ' is-outstanding' : '') + '">' +
      '<span class="summary-label">' + esc(label) + '</span>' + valueHtml + '</div>';
  }

  /* =========================================================
     Client portal
     ========================================================= */
  function renderPortal() {
    renderClientSelects();

    var client = getClient(state.portalClientId);

    if (!client) {
      if (portalEmpty) portalEmpty.classList.remove('hidden');
      if (portalContent) portalContent.classList.add('hidden');
      return;
    }

    var invoices = invoicesForClient(client.id).slice().sort(function (a, b) {
      return String(b.date || '').localeCompare(String(a.date || ''));
    });

    if (portalEmpty) portalEmpty.classList.add('hidden');
    if (portalContent) portalContent.classList.remove('hidden');

    var groups = groupTotals(invoices);
    var currencies = Object.keys(groups);

    if (portalSummary) {
      portalSummary.innerHTML =
        summaryCardHtml('Total Outstanding', groups, 'outstanding', true) +
        summaryCardHtml('Total Paid', groups, 'paid', false) +
        summaryCardHtml('Total Billed', groups, 'billed', false);
    }

    if (portalInvoiceCount) {
      portalInvoiceCount.textContent = invoices.length + ' invoice' + (invoices.length === 1 ? '' : 's');
    }

    if (!invoices.length) {
      portalInvoices.innerHTML = '<div class="empty-state">No invoices yet for ' +
        esc(client.name) + '.</div>';
      return;
    }

    portalInvoices.innerHTML = invoices.map(function (inv) {
      return '<div class="portal-invoice">' +
        '<div class="portal-invoice-main">' +
          '<strong>' + esc(inv.number) + '</strong>' +
          statusBadge(inv.status) +
          '<span class="muted">' + esc(inv.date) + '</span>' +
        '</div>' +
        '<div class="portal-invoice-amount">' + esc(money(inv.total, inv.currency)) + '</div>' +
        '<div class="portal-invoice-actions">' +
          (inv.source === 'imported'
            ? '<button type="button" class="btn btn-secondary btn-small" data-portal-action="original" data-id="' + esc(inv.id) + '">View Original PDF</button>'
            : '') +
          '<button type="button" class="btn btn-secondary btn-small" data-portal-action="download" data-id="' + esc(inv.id) + '">Download PDF</button>' +
          '<button type="button" class="btn btn-primary btn-small" data-portal-action="pay" data-id="' + esc(inv.id) + '">Pay Now</button>' +
        '</div>' +
      '</div>';
    }).join('');
  }

  /* =========================================================
     Save invoice
     ========================================================= */
  function nextInvoiceNumber() {
    var max = 0;
    state.invoices.forEach(function (inv) {
      var match = /(\d+)\s*$/.exec(String(inv.number || ''));
      if (match) {
        var n = parseInt(match[1], 10);
        if (!isNaN(n) && n > max) max = n;
      }
    });
    var next = max + 1;
    return 'INV-' + (next < 10 ? '00' + next : next < 100 ? '0' + next : String(next));
  }

  function resolveClient() {
    var name = toName ? toName.value.trim() : '';
    var email = toEmail ? toEmail.value.trim() : '';
    var address = toAddress ? toAddress.value.trim() : '';

    if (state.selectedClientId) {
      var selected = getClient(state.selectedClientId);
      if (selected) return { client: selected, created: false };
    }

    var existing = findClientByEmail(email) || findClientByName(name);
    if (existing) return { client: existing, created: false };

    if (!name && !email) return { client: null, created: false };

    var client = {
      id: uid('cli'),
      name: name,
      email: email,
      address: address,
      taxId: '',
      createdAt: new Date().toISOString()
    };
    state.clients.push(client);
    saveClients();
    return { client: client, created: true };
  }

  function saveInvoice() {
    var items = [];
    var subtotal = 0;
    var totalTax = 0;

    var rows = itemsBody.querySelectorAll('tr');
    for (var i = 0; i < rows.length; i++) {
      var data = getRowData(rows[i]);
      if (!String(data.description).trim()) continue;

      var totals = lineTotals(data);
      items.push({
        code: String(data.code).trim(),
        description: String(data.description).trim(),
        hsn: String(data.hsn).trim(),
        quantity: data.quantity,
        unit: data.unit,
        rate: data.rate,
        discountPct: data.discountPct,
        taxPct: data.taxPct,
        discountAmount: totals.discount,
        amount: totals.amount,
        taxAmount: totals.tax
      });
      subtotal += totals.amount;
      totalTax += totals.tax;
    }

    if (!items.length) {
      toast('Add at least one item with a description before saving.', true);
      return;
    }

    var resolved = resolveClient();

    var total = subtotal + totalTax;

    var invoice = {
      id: uid('inv'),
      number: (numberInput && numberInput.value.trim()) || nextInvoiceNumber(),
      clientId: resolved.client ? resolved.client.id : null,
      clientName: (toName && toName.value.trim()) || (resolved.client ? resolved.client.name : ''),
      clientEmail: (toEmail && toEmail.value.trim()) || (resolved.client ? resolved.client.email : ''),
      clientAddress: (toAddress && toAddress.value.trim()) || (resolved.client ? resolved.client.address : ''),
      date: (dateInput && dateInput.value) || new Date().toISOString().slice(0, 10),
      currency: state.currency,
      subtotal: subtotal,
      taxAmount: totalTax,
      total: total,
      status: state.status,
      items: items,
      createdAt: new Date().toISOString()
    };

    state.invoices.push(invoice);
    saveInvoices();

    if (resolved.created) {
      state.historyClientId = resolved.client.id;
    }
    state.portalClientId = resolved.client ? resolved.client.id : state.portalClientId;

    renderClientSelects();
    renderClients();
    renderPortal();
    renderHistory();

    toast('Invoice ' + invoice.number + ' saved' +
      (resolved.client ? ' for ' + resolved.client.name : '') + '.');

    // Reset the editor for the next invoice
    if (numberInput) numberInput.value = '';
    resetRows();
    recalcInvoice();
  }

  /* =========================================================
     PDF generation
     ========================================================= */
  function pdfOptions(filename) {
    return {
      margin: 12,
      filename: filename,
      image: { type: 'jpeg', quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    };
  }

  function runPdf(element, filename) {
    if (typeof html2pdf === 'undefined') {
      toast('PDF library is unavailable. Use Print instead.', true);
      return;
    }

    var holder = document.createElement('div');
    holder.className = 'pdf-holder';
    holder.appendChild(element);
    document.body.appendChild(holder);

    html2pdf().set(pdfOptions(filename)).from(element).save()
      .then(function () {
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        toast('PDF downloaded: ' + filename);
      })
      .catch(function () {
        if (holder.parentNode) holder.parentNode.removeChild(holder);
        toast('PDF generation failed.', true);
      });
  }

  function buildInvoiceElement(invoice) {
    var wrapper = document.createElement('div');
    wrapper.className = 'pdf-doc';

    var itemsHtml = invoice.items.map(function (it) {
      return '<tr>' +
        '<td>' + esc(it.code || '—') + '</td>' +
        '<td>' + esc(it.description) + '</td>' +
        '<td>' + esc(it.hsn || '—') + '</td>' +
        '<td class="pdf-num">' + esc(it.quantity) + '</td>' +
        '<td>' + esc(it.unit || 'Nos') + '</td>' +
        '<td class="pdf-num">' + esc(money(it.rate, invoice.currency)) + '</td>' +
        '<td class="pdf-num">' + esc(it.discountPct || 0) + '%</td>' +
        '<td class="pdf-num">' + esc(it.taxPct || 0) + '%</td>' +
        '<td class="pdf-num">' + esc(money(it.amount, invoice.currency)) + '</td>' +
        '<td class="pdf-num">' + esc(money(it.taxAmount, invoice.currency)) + '</td>' +
      '</tr>';
    }).join('');

    wrapper.innerHTML =
      '<h1>Invoice ' + esc(invoice.number) + '</h1>' +
      '<p class="pdf-sub">' + esc(invoice.date) + ' · ' + esc(invoice.status) + '</p>' +
      '<div class="pdf-meta">' +
        '<div>' +
          '<h2>From</h2>' +
          '<p><strong>' + esc((fromName && fromName.value) || 'Your Business') + '</strong></p>' +
          '<p>' + esc((fromEmail && fromEmail.value) || '') + '</p>' +
          '<p>' + esc((fromAddress && fromAddress.value) || '') + '</p>' +
        '</div>' +
        '<div>' +
          '<h2>Bill To</h2>' +
          '<p><strong>' + esc(invoice.clientName || 'Client') + '</strong></p>' +
          '<p>' + esc(invoice.clientEmail || '') + '</p>' +
          '<p>' + esc(invoice.clientAddress || '') + '</p>' +
        '</div>' +
      '</div>' +
      '<table>' +
        '<thead><tr>' +
          '<th>Code</th><th>Description</th><th>HSN/SAC</th><th class="pdf-num">Qty</th>' +
          '<th>Unit</th><th class="pdf-num">Rate</th><th class="pdf-num">Disc %</th>' +
          '<th class="pdf-num">Tax %</th><th class="pdf-num">Amount</th><th class="pdf-num">Tax Amt</th>' +
        '</tr></thead>' +
        '<tbody>' + itemsHtml + '</tbody>' +
      '</table>' +
      '<div class="pdf-totals">' +
        '<div><span>Subtotal</span><span>' + esc(money(invoice.subtotal, invoice.currency)) + '</span></div>' +
        '<div><span>Total Tax</span><span>' + esc(money(invoice.taxAmount, invoice.currency)) + '</span></div>' +
        '<div class="grand"><span>Grand Total</span><span>' + esc(money(invoice.total, invoice.currency)) + '</span></div>' +
      '</div>' +
      '<p class="pdf-foot">Generated by InvoiceFlow on ' + esc(new Date().toLocaleDateString()) + '</p>';

    return wrapper;
  }

  function downloadInvoicePdf(invoice) {
    var el = buildInvoiceElement(invoice);
    var safeName = String(invoice.number || 'invoice').replace(/[^a-z0-9\-_]+/gi, '_');
    runPdf(el, 'InvoiceFlow_' + safeName + '.pdf');
  }

  function generateStatement(clientId) {
    var client = getClient(clientId);
    if (!client) {
      toast('Select a client first.', true);
      return;
    }

    var invoices = invoicesForClient(client.id).slice().sort(function (a, b) {
      return String(a.date || '').localeCompare(String(b.date || ''));
    });

    var groups = groupTotals(invoices);
    var currencies = Object.keys(groups);

    var rowsHtml = invoices.length
      ? invoices.map(function (inv) {
          return '<tr>' +
            '<td>' + esc(inv.number) + '</td>' +
            '<td>' + esc(inv.date) + '</td>' +
            '<td>' + esc(inv.status) + '</td>' +
            '<td class="pdf-num">' + esc(money(inv.total, inv.currency)) + '</td>' +
          '</tr>';
        }).join('')
      : '<tr><td colspan="4">No invoices on record.</td></tr>';

    var totalsHtml = '';
    if (!currencies.length) {
      totalsHtml =
        '<div><span>Total Billed</span><span>' + esc(money(0, state.currency)) + '</span></div>' +
        '<div><span>Total Paid</span><span>' + esc(money(0, state.currency)) + '</span></div>' +
        '<div class="grand"><span>Total Outstanding</span><span>' + esc(money(0, state.currency)) + '</span></div>';
    } else {
      currencies.forEach(function (cur) {
        var g = groups[cur];
        totalsHtml +=
          '<div><span>Total Billed (' + esc(cur) + ')</span><span>' + esc(money(g.billed, cur)) + '</span></div>' +
          '<div><span>Total Paid (' + esc(cur) + ')</span><span>' + esc(money(g.paid, cur)) + '</span></div>' +
          '<div><span>Outstanding (' + esc(cur) + ')</span><span>' + esc(money(g.outstanding, cur)) + '</span></div>';
      });
      var primary = currencies[0];
      totalsHtml += '<div class="grand"><span>Total Outstanding (' + esc(primary) + ')</span><span>' +
        esc(money(groups[primary].outstanding, primary)) + '</span></div>';
    }

    var el = document.createElement('div');
    el.className = 'pdf-doc';
    el.innerHTML =
      '<h1>Client Statement</h1>' +
      '<p class="pdf-sub">Generated ' + esc(new Date().toLocaleDateString()) + '</p>' +
      '<div class="pdf-meta">' +
        '<div>' +
          '<h2>Client</h2>' +
          '<p><strong>' + esc(client.name) + '</strong></p>' +
          '<p>' + esc(client.email || '') + '</p>' +
          '<p>' + esc(client.address || '') + '</p>' +
        '</div>' +
        '<div>' +
          '<h2>Account Details</h2>' +
          '<p>Tax ID: ' + esc(client.taxId || '—') + '</p>' +
          '<p>Invoices: ' + invoices.length + '</p>' +
        '</div>' +
      '</div>' +
      '<table>' +
        '<thead><tr><th>Invoice #</th><th>Date</th><th>Status</th><th class="pdf-num">Amount</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>' +
      '<div class="pdf-totals">' + totalsHtml + '</div>' +
      '<p class="pdf-foot">This statement is generated automatically by InvoiceFlow.</p>';

    var safeName = String(client.name || 'client').replace(/[^a-z0-9\-_]+/gi, '_');
    runPdf(el, 'InvoiceFlow_Statement_' + safeName + '.pdf');
  }

  /* =========================================================
     Create tab: PDF export of the live invoice
     ========================================================= */
  function downloadCurrentInvoicePdf() {
    if (typeof html2pdf === 'undefined') {
      window.print();
      return;
    }
    if (!invoiceArea) return;

    invoiceArea.classList.add('pdf-export');
    html2pdf().set(pdfOptions('InvoiceFlow_Invoice.pdf')).from(invoiceArea).save()
      .then(function () {
        invoiceArea.classList.remove('pdf-export');
      })
      .catch(function () {
        invoiceArea.classList.remove('pdf-export');
        toast('PDF generation failed. Try Print instead.', true);
      });
  }

  /* =========================================================
     PDF import (text extraction, heuristics, IndexedDB)
     ========================================================= */
  var parsedInvoices = [];

  function setImportStatus(message, type) {
    if (!importStatusEl) return;

    if (!message) {
      importStatusEl.innerHTML = '';
      return;
    }

    var cls = 'import-status-line';
    if (type === 'error') cls += ' is-error';
    if (type === 'ok') cls += ' is-ok';

    importStatusEl.innerHTML = '<div class="' + cls + '">' + esc(message) + '</div>';
  }

  function openFilesDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) {
        reject(new Error('IndexedDB is not supported in this browser.'));
        return;
      }

      var request;
      try {
        request = window.indexedDB.open('InvoiceFlowFiles', 1);
      } catch (e) {
        reject(e);
        return;
      }

      request.onupgradeneeded = function (event) {
        var db = event.target.result;
        if (!db.objectStoreNames.contains('pdfs')) {
          db.createObjectStore('pdfs', { keyPath: 'id' });
        }
      };

      request.onsuccess = function (event) { resolve(event.target.result); };
      request.onerror = function () {
        reject(request.error || new Error('Could not open the local file database.'));
      };
      request.onblocked = function () {
        reject(new Error('Database upgrade blocked by another tab.'));
      };
    });
  }

  function savePdfBlob(invoiceId, file) {
    return openFilesDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('pdfs', 'readwrite');
        tx.objectStore('pdfs').put({ id: invoiceId, blob: file, name: file.name });

        tx.oncomplete = function () { db.close(); resolve(true); };
        tx.onerror = function () { db.close(); reject(tx.error); };
        tx.onabort = function () { db.close(); reject(tx.error); };
      });
    });
  }

  function getPdfBlob(invoiceId) {
    return openFilesDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction('pdfs', 'readonly');
        var request = tx.objectStore('pdfs').get(invoiceId);

        request.onsuccess = function () {
          db.close();
          resolve(request.result || null);
        };
        request.onerror = function () {
          db.close();
          reject(request.error);
        };
      });
    });
  }

  function extractPdfText(file) {
    if (typeof pdfjsLib === 'undefined') {
      return Promise.reject(new Error('PDF library not loaded'));
    }

    return new Promise(function (resolve, reject) {
      var reader = new FileReader();

      reader.onerror = function () { reject(new Error('Could not read the file.')); };

      reader.onload = function () {
        var data = new Uint8Array(reader.result);

        pdfjsLib.getDocument({ data: data }).promise.then(function (pdf) {
          var pages = pdf.numPages;
          var pageTexts = [];
          var chain = Promise.resolve();

          for (var i = 1; i <= pages; i++) {
            (function (pageNumber) {
              chain = chain.then(function () {
                return pdf.getPage(pageNumber).then(function (page) {
                  return page.getTextContent().then(function (content) {
                    var line = '';
                    for (var j = 0; j < content.items.length; j++) {
                      var item = content.items[j];
                      line += item.str;
                      line += item.hasEOL ? '\n' : ' ';
                    }
                    pageTexts.push(line);
                  });
                });
              });
            })(i);
          }

          chain.then(function () {
            var text = pageTexts.join('\n')
              .replace(/[^\S\n]+/g, ' ')
              .replace(/\n{2,}/g, '\n')
              .trim();
            resolve({ text: text, pages: pages });
          }).catch(reject);
        }).catch(reject);
      };

      reader.readAsArrayBuffer(file);
    });
  }

  /* Currency may be a symbol or a code/word such as "Rs." / "INR" */
  var CURRENCY_PREFIX = '(?:[\u20b9$\u20ac\u00a3]\\s*|(?:rs\\.?|inr|usd|eur|gbp|aud|cad|jpy)\\s*)?';

  /* Lines that are never the vendor name */
  var VENDOR_SKIP = /(tax\s+invoice|original|irn|site\s+code|page\s+no|eway|gstin|address|invoice\s*(?:no|number|#)|date)/i;

  /* Business entity suffixes */
  var VENDOR_HINT = /(limited|pvt\.?\s*ltd\.?|llp|inc\.?|corporation)/i;

  /* Words that suggest a postal address rather than a business name */
  var ADDRESS_HINT = /(floor|street|road|nagar|estate|plot|suite|building|district|state|pin\s*code|near|opp|phase|block)/i;

  /* 15-character GSTIN */
  var GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d][Z][A-Z\d]\b/;

  var INVOICE_LABEL = /(?:invoice\s*(?:no|number|#)|inv\s*no|bill\s*no)/i;

  /* Collapse runs of spaces/tabs but keep newlines so logical lines survive */
  function normalizeText(text) {
    return String(text || '')
      .replace(/\r\n?/g, '\n')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function textLines(source) {
    return source.split('\n').map(function (line) {
      return line.trim();
    }).filter(function (line) {
      return line.length > 0;
    });
  }

  function findVendor(source) {
    var lines = textLines(source);
    var i;
    var line;

    /* Pass 1: first line that looks like a registered business name */
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (VENDOR_SKIP.test(line)) continue;
      if (VENDOR_HINT.test(line)) return line.slice(0, 50);
    }

    /* Pass 2: first descriptive line that is not an address */
    for (i = 0; i < lines.length; i++) {
      line = lines[i];
      if (VENDOR_SKIP.test(line)) continue;

      var words = line.split(/\s+/).filter(Boolean);
      var looksLikeAddress = ADDRESS_HINT.test(line) || /\d/.test(line);
      if (words.length > 2 && !looksLikeAddress) return line.slice(0, 50);
    }

    return null;
  }

  function findGstin(source) {
    var all = [];
    var re = new RegExp(GSTIN_RE.source, 'g');
    var match;

    while ((match = re.exec(source)) !== null) {
      all.push(match[0]);
    }

    if (!all.length) return null;

    /* Two GSTINs: first is usually the vendor, second the client */
    return all.length >= 2 ? all[1] : all[0];
  }

  function findInvoiceNumber(source) {
    var lines = textLines(source);

    for (var i = 0; i < lines.length; i++) {
      if (!INVOICE_LABEL.test(lines[i])) continue;

      var match = lines[i].match(
        /(?:invoice\s*(?:no|number|#)|inv\s*no|bill\s*no)\s*[:.\-#]?\s*([A-Z0-9][A-Z0-9\-\/]*)/i
      );

      if (match && match[1] && match[1].length >= 4) {
        return match[1].toUpperCase();
      }
    }

    return null;
  }

  function findTotal(source) {
    var strong = source.match(
      new RegExp('(?:gross\\s*total|grand\\s*total|total\\s*amount)\\s*[:\\-]?\\s*' +
        CURRENCY_PREFIX + '([\\d,]+(?:\\.\\d{1,2})?)', 'i')
    );

    if (strong) {
      var strongValue = parseFloat(strong[1].replace(/,/g, ''));
      if (!isNaN(strongValue)) return strongValue;
    }

    /* Fallback: largest number that carries a decimal part */
    var loose = source.match(/\d[\d,]*\.\d{2}/g) || [];
    var best = null;

    for (var i = 0; i < loose.length; i++) {
      var value = parseFloat(loose[i].replace(/,/g, ''));
      if (isNaN(value)) continue;
      if (best === null || value > best) best = value;
    }

    return best;
  }

  function formatDate(day, month, year) {
    if (year < 100) year += 2000;
    if (!(day >= 1 && day <= 31) || !(month >= 1 && month <= 12)) return null;

    var mm = month < 10 ? '0' + month : String(month);
    var dd = day < 10 ? '0' + day : String(day);
    return year + '-' + mm + '-' + dd;
  }

  function findDate(source) {
    /* ISO first so "2024-03-09" is not clipped */
    var iso = source.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
    if (iso) {
      return formatDate(parseInt(iso[3], 10), parseInt(iso[2], 10), parseInt(iso[1], 10)) || iso[0];
    }

    var dmy = source.match(/\b(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})\b/);
    if (dmy) {
      return formatDate(parseInt(dmy[1], 10), parseInt(dmy[2], 10), parseInt(dmy[3], 10)) || dmy[0];
    }

    return null;
  }

  function parseInvoiceText(text) {
    var source = normalizeText(text);

    var result = {
      vendor: findVendor(source),
      invoiceNumber: findInvoiceNumber(source),
      gstin: findGstin(source),
      total: findTotal(source),
      date: findDate(source),
      confidence: 'low'
    };

    result.confidence = (result.vendor && result.invoiceNumber && result.total !== null) ? 'high' : 'low';

    return result;
  }

  function reviewInputCell(row, index, field, type) {
    var value = row[field];
    if (value === null || value === undefined) value = '';
    return '<td><input type="' + (type || 'text') + '" data-index="' + index +
      '" data-field="' + field + '" value="' + esc(value) + '" placeholder="Fill manually"></td>';
  }

  function renderImportReview() {
    if (!importReviewBody) return;

    importReviewBody.innerHTML = '';

    if (!parsedInvoices.length) {
      if (importReviewWrap) importReviewWrap.classList.add('hidden');
      return;
    }

    if (importReviewWrap) importReviewWrap.classList.remove('hidden');

    parsedInvoices.forEach(function (row, index) {
      var tr = document.createElement('tr');
      var needsReview = row.failed || row.confidence === 'low';
      if (needsReview) tr.className = 'row-low-confidence';

      var flag = '';
      if (row.failed) {
        flag = '<span class="warn-icon" title="Text extraction failed — please fill in manually">&#9888;</span>';
      } else if (row.confidence === 'low') {
        flag = '<span class="badge badge-pending" title="Some fields could not be detected">Please verify</span>';
      }

      tr.innerHTML =
        '<td class="file-cell">' + flag + esc(row.fileName) + '</td>' +
        reviewInputCell(row, index, 'vendor') +
        reviewInputCell(row, index, 'invoiceNumber') +
        reviewInputCell(row, index, 'date') +
        reviewInputCell(row, index, 'total', 'number') +
        reviewInputCell(row, index, 'gstin') +
        '<td><select data-index="' + index + '" data-field="status">' +
          '<option value="Pending"' + (row.status === 'Pending' ? ' selected' : '') + '>Pending</option>' +
          '<option value="Paid"' + (row.status === 'Paid' ? ' selected' : '') + '>Paid</option>' +
        '</select></td>' +
        '<td class="actions-col"><button type="button" class="btn btn-remove" data-remove="' +
          index + '" title="Remove">&#10005;</button></td>';

      importReviewBody.appendChild(tr);
    });
  }

  function handleReviewChange(event) {
    var target = event.target;
    var indexAttr = target.getAttribute('data-index');
    var field = target.getAttribute('data-field');
    if (indexAttr === null || !field) return;

    var row = parsedInvoices[Number(indexAttr)];
    if (!row) return;

    if (field === 'total') {
      var parsed = parseFloat(target.value);
      row.total = isNaN(parsed) ? null : parsed;
    } else {
      row[field] = target.value;
    }
  }

  function handleParsePdfs() {
    if (typeof pdfjsLib === 'undefined') {
      toast('PDF library not loaded', true);
      return;
    }

    var files = (pdfFileInput && pdfFileInput.files)
      ? Array.prototype.slice.call(pdfFileInput.files)
      : [];

    if (!files.length) {
      toast('Select at least one PDF file.', true);
      return;
    }

    parsedInvoices = [];
    renderImportReview();
    setImportStatus('Parsing file 1 of ' + files.length + '...');

    var chain = Promise.resolve();

    files.forEach(function (file, index) {
      chain = chain.then(function () {
        setImportStatus('Parsing file ' + (index + 1) + ' of ' + files.length + '...');

        return extractPdfText(file).then(function (result) {
          var parsed = parseInvoiceText(result.text);
          parsedInvoices.push({
            fileName: file.name,
            file: file,
            pages: result.pages,
            failed: !result.text,
            vendor: parsed.vendor,
            invoiceNumber: parsed.invoiceNumber,
            date: parsed.date,
            total: parsed.total,
            gstin: parsed.gstin,
            status: 'Pending',
            confidence: parsed.confidence
          });
          renderImportReview();
        }).catch(function () {
          parsedInvoices.push({
            fileName: file.name,
            file: file,
            pages: 0,
            failed: true,
            vendor: null,
            invoiceNumber: null,
            date: null,
            total: null,
            gstin: null,
            status: 'Pending',
            confidence: 'low'
          });
          renderImportReview();
        });
      });
    });

    chain.then(function () {
      var failed = parsedInvoices.filter(function (row) { return row.failed; }).length;
      setImportStatus(
        'Parsed ' + parsedInvoices.length + ' of ' + files.length + ' file(s).' +
        (failed ? ' ' + failed + ' need manual entry.' : ''),
        failed ? null : 'ok'
      );
      toast('Extraction complete');
    }).catch(function () {
      setImportStatus('Extraction failed. Please try again.', 'error');
    });
  }

  function saveImportedInvoices() {
    if (!parsedInvoices.length) {
      toast('Nothing to import.', true);
      return;
    }

    var savedCount = 0;
    var jobs = [];

    parsedInvoices.forEach(function (row) {
      var total = (row.total === null || row.total === undefined) ? 0 : Number(row.total);

      var invoice = {
        id: uid('inv'),
        source: 'imported',
        clientId: null,
        clientName: row.vendor || '',
        clientEmail: '',
        clientAddress: '',
        number: row.invoiceNumber || nextInvoiceNumber(),
        date: row.date || new Date().toISOString().slice(0, 10),
        currency: state.currency,
        subtotal: total,
        taxAmount: 0,
        total: total,
        taxId: row.gstin || '',
        status: row.status || 'Pending',
        items: [],
        importedFileName: row.fileName || '',
        createdAt: new Date().toISOString()
      };

      state.invoices.push(invoice);
      savedCount += 1;

      if (row.file) {
        jobs.push(savePdfBlob(invoice.id, row.file).catch(function () {
          return false;
        }));
      }
    });

    Promise.all(jobs).then(function () {
      saveInvoices();
      parsedInvoices = [];
      renderImportReview();
      if (pdfFileInput) pdfFileInput.value = '';
      setImportStatus('Imported ' + savedCount + ' invoice(s).', 'ok');
      renderClients();
      renderPortal();
      renderHistory();
      toast(savedCount + ' invoices imported');
    }).catch(function () {
      toast('Some PDFs could not be stored in the local database.', true);
    });
  }

  function downloadOriginalPdf(invoiceId) {
    getPdfBlob(invoiceId).then(function (record) {
      if (!record || !record.blob) {
        toast('Original PDF not found for this invoice.', true);
        return;
      }

      var url = URL.createObjectURL(record.blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = record.name || ('Invoice_' + invoiceId + '.pdf');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    }).catch(function () {
      toast('Could not open the original PDF.', true);
    });
  }

  /* =========================================================
     Event wiring
     ========================================================= */
  function wireEvents() {
    // Tabs
    var tabs = document.getElementById('main-tabs');
    if (tabs) {
      tabs.addEventListener('click', function (event) {
        var btn = event.target.closest('.tab-btn');
        if (btn) switchTab(btn.getAttribute('data-tab'));
      });
    }

    // Items
    if (addItemBtn) addItemBtn.addEventListener('click', function () { addItem(); });

    itemsBody.addEventListener('input', recalcInvoice);
    itemsBody.addEventListener('change', recalcInvoice);

    itemsBody.addEventListener('click', function (event) {
      if (event.target.classList.contains('remove-item')) {
        var row = event.target.closest('tr');
        if (row) removeItem(row);
      }
    });

    // Currency / status
    if (currencySelect) {
      currencySelect.addEventListener('change', function () {
        state.currency = currencySelect.value || 'USD';
        saveSettings();
        recalcInvoice();
      });
    }

    if (statusSelect) {
      statusSelect.addEventListener('change', function () {
        state.status = statusSelect.value || 'Draft';
        saveSettings();
        renderStamp();
      });
    }

    // Client select in create tab
    if (clientSelect) {
      clientSelect.addEventListener('change', function () {
        state.selectedClientId = clientSelect.value || null;
        var client = getClient(state.selectedClientId);
        if (client) {
          if (toName) toName.value = client.name || '';
          if (toEmail) toEmail.value = client.email || '';
          if (toAddress) toAddress.value = client.address || '';
          saveForm();
        }
      });
    }

    // Form persistence (from/to + logo)
    if (fromLogoInput) {
      fromLogoInput.addEventListener('change', function (event) {
        var file = event.target.files && event.target.files[0];
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function (e) {
          if (headerLogo && e.target && e.target.result) {
            headerLogo.src = e.target.result;
            headerLogo.classList.remove('hidden');
            saveForm();
          }
        };
        reader.readAsDataURL(file);
      });
    }

    [fromName, fromEmail, fromAddress, toName, toEmail, toAddress].forEach(function (el) {
      if (!el) return;
      el.addEventListener('input', saveForm);
      el.addEventListener('change', saveForm);
    });

    // Save invoice
    if (saveInvoiceBtn) saveInvoiceBtn.addEventListener('click', saveInvoice);
    if (printBtn) printBtn.addEventListener('click', function () { window.print(); });
    if (downloadPdfBtn) downloadPdfBtn.addEventListener('click', downloadCurrentInvoicePdf);

    // Client form
    if (clientForm) {
      clientForm.addEventListener('submit', function (event) {
        event.preventDefault();

        var name = clientName.value.trim();
        if (!name) {
          toast('Client name is required.', true);
          return;
        }

        var email = clientEmail.value.trim();
        var existing = findClientByEmail(email) || findClientByName(name);

        if (existing) {
          existing.name = name;
          existing.email = email;
          existing.address = clientAddress.value.trim();
          existing.taxId = clientTaxId.value.trim();
          existing.updatedAt = new Date().toISOString();
          saveClients();
          toast('Client updated: ' + existing.name);
        } else {
          var client = {
            id: uid('cli'),
            name: name,
            email: email,
            address: clientAddress.value.trim(),
            taxId: clientTaxId.value.trim(),
            createdAt: new Date().toISOString()
          };
          state.clients.push(client);
          saveClients();
          toast('Client saved: ' + client.name);
        }

        clientForm.reset();
        renderClients();
        renderClientSelects();
      });
    }

    // Client list interactions
    if (clientsBody) {
      clientsBody.addEventListener('click', function (event) {
        var statement = event.target.closest('.statement-btn');
        if (statement) {
          event.stopPropagation();
          generateStatement(statement.getAttribute('data-id'));
          return;
        }
        var row = event.target.closest('tr[data-client-id]');
        if (row) selectHistoryClient(row.getAttribute('data-client-id'));
      });
    }

    if (statementBtn) {
      statementBtn.addEventListener('click', function () {
        generateStatement(state.historyClientId);
      });
    }

    // Portal
    if (portalClientSelect) {
      portalClientSelect.addEventListener('change', function () {
        state.portalClientId = portalClientSelect.value || null;
        renderPortal();
      });
    }

    if (portalInvoices) {
      portalInvoices.addEventListener('click', function (event) {
        var btn = event.target.closest('[data-portal-action]');
        if (!btn) return;
        var action = btn.getAttribute('data-portal-action');
        var id = btn.getAttribute('data-id');

        if (action === 'pay') {
          toast('Payment integration coming soon');
          return;
        }
        if (action === 'original') {
          downloadOriginalPdf(id);
          return;
        }
        if (action === 'download') {
          for (var i = 0; i < state.invoices.length; i++) {
            if (state.invoices[i].id === id) {
              downloadInvoicePdf(state.invoices[i]);
              return;
            }
          }
        }
      });
    }

    // History: view original PDF
    if (historyBody) {
      historyBody.addEventListener('click', function (event) {
        var btn = event.target.closest('.view-original');
        if (!btn) return;
        downloadOriginalPdf(btn.getAttribute('data-id'));
      });
    }

    // Import tab
    if (parsePdfsBtn) parsePdfsBtn.addEventListener('click', handleParsePdfs);
    if (saveImportedBtn) saveImportedBtn.addEventListener('click', saveImportedInvoices);

    if (importReviewBody) {
      importReviewBody.addEventListener('input', handleReviewChange);
      importReviewBody.addEventListener('change', handleReviewChange);

      importReviewBody.addEventListener('click', function (event) {
        var removeBtn = event.target.closest('[data-remove]');
        if (!removeBtn) return;
        var index = Number(removeBtn.getAttribute('data-remove'));
        if (isNaN(index)) return;
        parsedInvoices.splice(index, 1);
        renderImportReview();
      });
    }
  }

  /* =========================================================
     Init
     ========================================================= */
  function syncControlsFromState() {
    if (currencySelect) currencySelect.value = state.currency;
    if (statusSelect) statusSelect.value = state.status;
    renderStamp();
  }

  function init() {
    // Point pdf.js at the bundled local worker so the app works fully offline
    if (window.pdfjsLib && window.pdfjsLib.GlobalWorkerOptions) {
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'libs/pdf.worker.min.js';
    }

    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    loadSettings();
    loadData();
    loadForm();

    syncControlsFromState();
    wireEvents();

    resetRows();

    if (state.clients.length) {
      state.historyClientId = state.clients[0].id;
      state.portalClientId = state.clients[0].id;
    }

    if (clientSelect) clientSelect.value = state.selectedClientId || '';
    if (portalClientSelect) portalClientSelect.value = state.portalClientId || '';

    recalcInvoice();
    renderClientSelects();
    renderClients();
    renderPortal();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();