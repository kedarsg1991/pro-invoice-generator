(function () {
  const itemsBody = document.getElementById('items-body');
  const addItemBtn = document.getElementById('add-item');
  const printBtn = document.getElementById('print-invoice');
  const subtotalEl = document.getElementById('subtotal');
  const grandTotalEl = document.getElementById('grand-total');
  const dateInput = document.getElementById('invoice-date');

  function formatMoney(value) {
    return Number(value || 0).toFixed(2);
  }

  function calculateRow(row) {
    const quantity = parseFloat(row.querySelector('.item-quantity').value) || 0;
    const rate = parseFloat(row.querySelector('.item-rate').value) || 0;
    const amount = quantity * rate;
    row.querySelector('.item-amount').textContent = formatMoney(amount);
    return amount;
  }

  function calculateTotals() {
    let subtotal = 0;
    const rows = itemsBody.querySelectorAll('tr');
    rows.forEach(function (row) {
      subtotal += calculateRow(row);
    });
    subtotalEl.textContent = formatMoney(subtotal);
    grandTotalEl.textContent = formatMoney(subtotal);
  }

  function createRow() {
    const tr = document.createElement('tr');
    tr.innerHTML =
      '<td><input type="text" class="item-description" placeholder="Service or product"></td>' +
      '<td><input type="number" class="item-quantity" min="0" step="1" value="1"></td>' +
      '<td><input type="number" class="item-rate" min="0" step="0.01" value="0.00"></td>' +
      '<td class="amount-cell">$<span class="item-amount">0.00</span></td>' +
      '<td class="actions-col"><button type="button" class="btn btn-secondary remove-item">Remove</button></td>';
    return tr;
  }

  function addItem() {
    itemsBody.appendChild(createRow());
    calculateTotals();
  }

  function removeItem(row) {
    const rows = itemsBody.querySelectorAll('tr');
    if (rows.length === 1) {
      row.querySelector('.item-description').value = '';
      row.querySelector('.item-quantity').value = '1';
      row.querySelector('.item-rate').value = '0.00';
    } else {
      row.remove();
    }
    calculateTotals();
  }

  addItemBtn.addEventListener('click', addItem);

  printBtn.addEventListener('click', function () {
    window.print();
  });

  itemsBody.addEventListener('input', function (event) {
    if (
      event.target.classList.contains('item-quantity') ||
      event.target.classList.contains('item-rate')
    ) {
      calculateTotals();
    }
  });

  itemsBody.addEventListener('click', function (event) {
    if (event.target.classList.contains('remove-item')) {
      const row = event.target.closest('tr');
      if (row) {
        removeItem(row);
      }
    }
  });

  if (dateInput && !dateInput.value) {
    dateInput.value = new Date().toISOString().split('T')[0];
  }

  calculateTotals();
})();
