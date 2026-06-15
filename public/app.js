'use strict';

// Shared fetch helpers + tiny DOM utilities used across all pages.

async function apiGet(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.json();
}

async function apiPost(url, body) {
  // Only send a JSON content-type when there's actually a body — otherwise
  // Fastify rejects an empty body declared as application/json with a 400
  // (this is what broke bodyless POSTs like "Brew this").
  const opts = { method: 'POST' };
  if (body !== undefined) {
    opts.headers = { 'Content-Type': 'application/json' };
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || `POST ${url} failed: ${res.status}`;
    const err = new Error(msg);
    err.data = data;
    throw err;
  }
  return data;
}

// Escape user-provided strings before inserting into HTML.
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[c]));
}

function qs(sel) {
  return document.querySelector(sel);
}

// Read a query-string param (used by recipe.html for ?id=).
function param(name) {
  return new URLSearchParams(window.location.search).get(name);
}

// Format a quantity with its unit, e.g. "4500 g" or "1 packet".
function fmtQty(amount, unit) {
  return `${amount} ${unit}`;
}

// Make a table's non-empty header cells clickable for column sorting.
// Stock tables pair a display row (data-item-id) with a hidden edit row
// (data-edit-row); both are moved together so the pairing is preserved.
// Simple tables (no data-item-id) sort individual rows.
function makeSortable(table) {
  const ths = [...table.querySelectorAll('thead th')];
  let sortCol = -1, sortDir = 1;

  function cellVal(tr, col) {
    const td = tr.cells[col];
    if (!td) return '';
    return td.dataset.sortVal !== undefined ? td.dataset.sortVal : td.textContent.trim();
  }

  function doSort(colIdx) {
    sortDir = sortCol === colIdx ? -sortDir : 1;
    sortCol = colIdx;
    ths.forEach((th, i) => {
      delete th.dataset.sortDir;
      if (i === colIdx) th.dataset.sortDir = sortDir > 0 ? 'asc' : 'desc';
    });

    const tbody = table.querySelector('tbody');
    const hasGroups = !!tbody.querySelector('tr[data-item-id]');

    const cmp = (av, bv) => {
      const an = parseFloat(av), bn = parseFloat(bv);
      return (!isNaN(an) && !isNaN(bn)) ? (an - bn) * sortDir : av.localeCompare(bv) * sortDir;
    };

    if (hasGroups) {
      const displayRows = [...tbody.querySelectorAll('tr[data-item-id]')];
      displayRows.sort((a, b) => cmp(cellVal(a, colIdx), cellVal(b, colIdx)));
      displayRows.forEach(row => {
        const editRow = tbody.querySelector(`tr[data-edit-row="${row.dataset.itemId}"]`);
        tbody.appendChild(row);
        if (editRow) tbody.appendChild(editRow);
      });
    } else {
      const rows = [...tbody.querySelectorAll('tr')];
      rows.sort((a, b) => cmp(cellVal(a, colIdx), cellVal(b, colIdx)));
      rows.forEach(r => tbody.appendChild(r));
    }
  }

  ths.forEach((th, i) => {
    if (!th.textContent.trim()) return;
    th.classList.add('sortable');
    th.addEventListener('click', () => doSort(i));
  });
}

// Promise-based confirmation modal (replaces window.confirm). Uses a native
// <dialog> styled by Pico. Resolves true on confirm, false on cancel/Esc.
function confirmDialog({
  title = 'Confirm',
  message = '',
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.innerHTML = `
      <article>
        <header><strong>${esc(title)}</strong></header>
        <p>${esc(message)}</p>
        <footer>
          <button class="secondary" data-result="cancel">${esc(cancelText)}</button>
          <button class="${danger ? 'contrast' : ''}" data-result="ok">${esc(confirmText)}</button>
        </footer>
      </article>`;
    document.body.appendChild(dlg);

    const done = (result) => {
      dlg.close();
      dlg.remove();
      resolve(result);
    };
    dlg.querySelector('[data-result="cancel"]').addEventListener('click', () => done(false));
    dlg.querySelector('[data-result="ok"]').addEventListener('click', () => done(true));
    // Esc key / backdrop dismiss.
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); done(false); });
    dlg.showModal();
  });
}
