// apps/server/src/public/superadmin/superadmin.js

function toast(msg) {
  if (!msg) return;
  const t = document.createElement('div');
  t.className = 'toast toast-top-right';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => {
    t.classList.remove('show');
    setTimeout(() => t.remove(), 250);
  }, 2000);
}

function confirmDialog({
  title = 'Confirm',
  message = 'Are you sure?',
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
}) {
  return new Promise((resolve) => {
    let settled = false;
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="sa-confirm-title" aria-describedby="sa-confirm-message">
        <div class="modal-header">
          <h3 id="sa-confirm-title" class="modal-title"></h3>
        </div>
        <div class="modal-body">
          <p class="modal-message" id="sa-confirm-message"></p>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn small" data-cancel></button>
          <button type="button" class="btn small primary" data-confirm></button>
        </div>
      </div>`;

    const card = overlay.querySelector('.modal-card');
    const titleEl = overlay.querySelector('.modal-title');
    const messageEl = overlay.querySelector('.modal-message');
    const cancelBtn = overlay.querySelector('[data-cancel]');
    const confirmBtn = overlay.querySelector('[data-confirm]');

    if (!card || !titleEl || !messageEl || !cancelBtn || !confirmBtn) {
      resolve(false);
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    cancelBtn.textContent = cancelLabel;
    confirmBtn.textContent = confirmLabel;

    const close = (result) => {
      if (settled) return;
      settled = true;
      overlay.classList.remove('is-visible');
      document.removeEventListener('keydown', onKeyDown, true);
      setTimeout(() => overlay.remove(), 180);
      resolve(!!result);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
      }
    };

    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close(false);
    });

    document.addEventListener('keydown', onKeyDown, true);
    document.body.appendChild(overlay);
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      confirmBtn.focus();
    });
  });
}

// Sidebar collapse/expand
(function () {
  const shell = document.querySelector('[data-shell]');
  const btn = document.querySelector('.sb-toggle');
  if (shell && btn) btn.addEventListener('click', () => {
    shell.setAttribute('data-collapsed', shell.getAttribute('data-collapsed') === '1' ? '0' : '1');
  });
})();

// Shared collapsible cards (persisted locally)
document.querySelectorAll('[data-collapsible]').forEach((box) => {
  const btn = box.querySelector('[data-toggle-collapse]');
  if (!btn) return;

  const storageKey = (box.getAttribute('data-storage-key') || 'sa.collapsible') + '::collapsed';
  const setCollapsed = (v) => box.classList.toggle('is-collapsed', !!v);

  const saved = (() => {
    try { return localStorage.getItem(storageKey); } catch { return null; }
  })();
  if (saved !== null) setCollapsed(saved === '1');

  btn.addEventListener('click', () => {
    const next = !box.classList.contains('is-collapsed');
    setCollapsed(next);
    try { localStorage.setItem(storageKey, next ? '1' : '0'); } catch {}
  });
});

// Column visibility toggles (persisted per storage key)
(() => {
  const toggles = document.querySelectorAll('[data-col-toggle]');
  if (!toggles.length) return;

  toggles.forEach((cb) => {
    const container = cb.closest('[data-collapsible]');
    const storageKey = container?.getAttribute('data-storage-key') || 'sa.columns';

    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}

    const col = cb.getAttribute('data-col-toggle');
    if (Object.prototype.hasOwnProperty.call(saved, col)) cb.checked = !!saved[col];

    const apply = () => {
      document.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        el.style.display = cb.checked ? '' : 'none';
      });

      let next = {};
      try { next = JSON.parse(localStorage.getItem(storageKey) || '{}') || {}; } catch {}
      next[col] = cb.checked;
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch {}
    };

    cb.addEventListener('change', apply);
    apply();
  });
})();

(function () {
  const controls = document.querySelectorAll('[data-export-control]');
  if (!controls.length) return;

  const notify = (message) => {
    if (typeof toast === 'function') toast(message);
    else if (message) window.alert(message);
  };

  controls.forEach((control) => {
    const mainBtn = control.querySelector('[data-export-main]');
    const toggleBtn = control.querySelector('[data-export-toggle]');
    const menu = control.querySelector('[data-export-menu]');
    const label = control.querySelector('[data-export-label]');
    if (!mainBtn || !toggleBtn || !menu || !label) return;

    const endpoint = control.getAttribute('data-export-endpoint');
    if (!endpoint) return;

    const tableSelector = control.getAttribute('data-export-table') || '';
    const columnsRootSelector = control.getAttribute('data-export-columns-root') || '';
    const storageKey = control.getAttribute('data-export-storage') || 'superadmin.export.default';

    const readStoredType = () => {
      try { return localStorage.getItem(storageKey) || 'csv'; } catch { return 'csv'; }
    };
    const storeType = (type) => {
      try { localStorage.setItem(storageKey, type); } catch {}
    };

    let currentType = readStoredType();

    const updateLabel = () => {
      label.textContent = currentType ? `${currentType.toUpperCase()} Export` : 'Export';
    };

    updateLabel();

    const closeMenu = () => {
      menu.hidden = true;
      control.removeAttribute('data-open');
      document.removeEventListener('click', onDocClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };

    const openMenu = () => {
      if (!menu.hidden) return;
      menu.hidden = false;
      control.setAttribute('data-open', '1');
      document.addEventListener('click', onDocClick, true);
      document.addEventListener('keydown', onKeyDown, true);
    };

    const onDocClick = (event) => {
      if (!control.contains(event.target)) closeMenu();
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMenu();
      }
    };

    toggleBtn.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (menu.hidden) openMenu();
      else closeMenu();
    });

    menu.querySelectorAll('[data-export-option]').forEach((optionBtn) => {
      optionBtn.addEventListener('click', (event) => {
        event.preventDefault();
        const next = (optionBtn.getAttribute('data-export-option') || '').toLowerCase();
        if (!next) return;
        currentType = next;
        storeType(currentType);
        updateLabel();
        closeMenu();
      });
    });

    const collectColumns = () => {
      const table = tableSelector ? document.querySelector(tableSelector) : null;
      if (!table) return [];

      const headerCells = Array.from(table.querySelectorAll('thead th[data-col]'));
      const toggleMap = new Map();
      if (columnsRootSelector) {
        const root = document.querySelector(columnsRootSelector);
        if (root) {
          root.querySelectorAll('[data-col-toggle]').forEach((cb) => {
            const col = cb.getAttribute('data-col-toggle');
            if (col) toggleMap.set(col, cb.checked);
          });
          root.querySelectorAll('.col-toggle').forEach((cb) => {
            const col = cb.getAttribute('data-col');
            if (col) toggleMap.set(col, cb.checked);
          });
        }
      }

      const columns = headerCells
        .map((th) => {
          const key = th.getAttribute('data-col');
          if (!key) return null;
          const isVisible = toggleMap.has(key) ? toggleMap.get(key) : th.offsetParent !== null;
          if (!isVisible) return null;
          const text = th.textContent ? th.textContent.replace(/\s+/g, ' ').trim() : '';
          return { key, label: text || key };
        })
        .filter(Boolean);

      if (columns.length) return columns;
      return headerCells
        .map((th) => {
          const key = th.getAttribute('data-col');
          if (!key) return null;
          const text = th.textContent ? th.textContent.replace(/\s+/g, ' ').trim() : '';
          return { key, label: text || key };
        })
        .filter(Boolean);
    };

    const buildFilters = () => {
      const filters = {};
      const params = new URLSearchParams(window.location.search || '');
      params.forEach((value, key) => {
        filters[key] = value;
      });
      return filters;
    };

    const parseFilename = (disposition, fallback) => {
      if (!disposition) return fallback;
      const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
      if (match) {
        return decodeURIComponent(match[1] || match[2]);
      }
      return fallback;
    };

    const triggerExport = async () => {
      if (control.dataset.exporting === '1') return;
      control.dataset.exporting = '1';
      const columns = collectColumns();
      const filters = buildFilters();
      try {
        const res = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/octet-stream' },
          credentials: 'same-origin',
          body: JSON.stringify({ type: currentType, columns, filters }),
        });
        if (!res.ok) {
          let message = 'Export failed';
          const ct = res.headers.get('Content-Type') || '';
          if (ct.includes('application/json')) {
            try {
              const data = await res.json();
              if (data && data.error) message = data.error;
            } catch {}
          }
          throw new Error(message);
        }

        const blob = await res.blob();
        const fallbackName = `export.${currentType}`;
        const filename = parseFilename(res.headers.get('Content-Disposition'), fallbackName);
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = filename;
        document.body.appendChild(anchor);
        anchor.click();
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1500);
      } catch (err) {
        notify((err && err.message) || 'Unable to export');
      } finally {
        control.dataset.exporting = '0';
      }
    };

    mainBtn.addEventListener('click', (event) => {
      event.preventDefault();
      triggerExport();
    });
  });
})();

// Sidebar sections, theme toggle, timezone list, prefs UX
(function () {
  // ──────────────────────────────────────────────────────────
  // Section toggles: show/hide .sidebar-section by data-section
  // ──────────────────────────────────────────────────────────
  const btns = document.querySelectorAll('.sb-top-buttons .icon-btn[data-show]');
  const sections = document.querySelectorAll('.sidebar-section');

  function show(name) {
    sections.forEach(s => s.style.display = (s.getAttribute('data-section') === name ? '' : 'none'));
    btns.forEach(b => b.classList.toggle('active', b.dataset.show === name));
  }
  if (btns.length && sections.length) {
    show('reports');
    btns.forEach(b => b.addEventListener('click', () => show(b.dataset.show)));
  }

  // ──────────────────────────────────────────────────────────
  // Theme cookie — reuse the same cookie server reads for SSR
  // ──────────────────────────────────────────────────────────
  const DARK_COOKIE = 'merchant_theme';
  function readCookie(name) {
    const m = (document.cookie || '').match(new RegExp('(?:^|;\\s*)' + name.replace(/[-/\\^$*+?.()|[\\]{}]/g,'\\$&') + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  }
  function writeCookie(name, value) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + encodeURIComponent(value) + '; Max-Age=' + (60*60*24*365) + '; Path=/; SameSite=Lax' + secure;
  }

  const darkInput = document.getElementById('pref-dark');
  const currentTheme = readCookie(DARK_COOKIE) || 'light';
  if (darkInput) {
    darkInput.checked = currentTheme === 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    darkInput.addEventListener('change', function () {
      const mode = this.checked ? 'dark' : 'light';
      writeCookie(DARK_COOKIE, mode);
      document.documentElement.setAttribute('data-theme', mode);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Timezones — full world list (matches admin/merchant)
  // ──────────────────────────────────────────────────────────
  const tzSel = document.getElementById('pref-tz');
  if (tzSel) {
    tzSel.innerHTML = '';

    let zones = [];
    if (typeof Intl.supportedValuesOf === 'function') {
      try { zones = Intl.supportedValuesOf('timeZone') || []; } catch {}
    }
    if (!zones.length) {
      zones = [
        'UTC',
        'Africa/Abidjan','Africa/Accra','Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi',
        'America/Argentina/Buenos_Aires','America/Bogota','America/Chicago','America/Denver','America/Los_Angeles','America/Mexico_City','America/New_York','America/Santiago','America/Sao_Paulo','America/Toronto','America/Vancouver',
        'Asia/Bangkok','Asia/Dhaka','Asia/Dubai','Asia/Ho_Chi_Minh','Asia/Hong_Kong','Asia/Jakarta','Asia/Kolkata','Asia/Kuala_Lumpur','Asia/Manila','Asia/Riyadh','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Taipei','Asia/Tokyo',
        'Australia/Perth','Australia/Adelaide','Australia/Brisbane','Australia/Sydney',
        'Europe/Amsterdam','Europe/Athens','Europe/Berlin','Europe/Brussels','Europe/Bucharest','Europe/Budapest','Europe/Copenhagen','Europe/Dublin','Europe/Helsinki','Europe/Istanbul','Europe/Kyiv','Europe/Lisbon','Europe/London','Europe/Madrid','Europe/Oslo','Europe/Paris','Europe/Prague','Europe/Rome','Europe/Stockholm','Europe/Vienna','Europe/Warsaw','Europe/Zurich',
        'Pacific/Auckland','Pacific/Fiji','Pacific/Honolulu'
      ];
    }
    try { zones.sort(); } catch {}

    const saved = localStorage.getItem('pref_tz') || '';
    const detected = (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const chosen = zones.includes(saved) ? saved : (zones.includes(detected) ? detected : 'UTC');

    const frag = document.createDocumentFragment();
    for (const z of zones) {
      const o = document.createElement('option');
      o.value = z;
      o.textContent = z;
      frag.appendChild(o);
    }
    tzSel.appendChild(frag);
    tzSel.value = chosen;

    tzSel.addEventListener('change', () => {
      localStorage.setItem('pref_tz', tzSel.value);
    });
  }

  // ──────────────────────────────────────────────────────────
  // Save/Cancel — UX sugar (like other portals)
  // ──────────────────────────────────────────────────────────
  document.getElementById('prefs-save')?.addEventListener('click', () => show('reports'));
  document.getElementById('prefs-cancel')?.addEventListener('click', () => show('reports'));
})();

/* ─────────────────────────────────────────────────────────────
   Payments: Column settings controller (Deposits/Withdrawals)
   - Collapsible panel <details data-cols> with checkboxes .col-toggle
   - Persists per type: sa_pay_cols_DEPOSIT / sa_pay_cols_WITHDRAWAL
   - Updates <th>/<td> with matching [data-col] instantly
   - Remembers open/closed state per type
   ───────────────────────────────────────────────────────────── */
(function () {
  const colsRoot = document.querySelector('[data-cols]');
  const table = document.querySelector('table[data-table]');
  if (!colsRoot || !table) return;

  // Figure out the page type from the URL
  const path = location.pathname.toLowerCase();
  const type = path.includes('/withdrawal') ? 'WITHDRAWAL' : 'DEPOSIT';
  const storageKey = 'sa_pay_cols_' + type;
  const openKey = storageKey + '_open';

  const toggles = Array.from(colsRoot.querySelectorAll('.col-toggle'));
  const allBtn = document.getElementById('cols-all');
  const noneBtn = document.getElementById('cols-none');
  const summaryHint = colsRoot.querySelector('[data-cols-summary]');

  // Load saved checks
  let savedMap = {};
  try { savedMap = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}

  toggles.forEach(cb => {
    if (savedMap.hasOwnProperty(cb.dataset.col)) cb.checked = !!savedMap[cb.dataset.col];
  });

  function apply() {
    const map = {};
    toggles.forEach(cb => { map[cb.dataset.col] = cb.checked; });

    table.querySelectorAll('[data-col]').forEach(el => {
      const id = el.getAttribute('data-col');
      el.style.display = (map[id] !== false) ? '' : 'none';
    });

    // Update tiny summary (e.g., "9 shown")
    if (summaryHint) {
      const shown = Object.values(map).filter(Boolean).length;
      summaryHint.textContent = `${shown} shown`;
    }

    try { localStorage.setItem(storageKey, JSON.stringify(map)); } catch {}
  }

  // Wire events
  toggles.forEach(cb => cb.addEventListener('change', apply));
  allBtn?.addEventListener('click', e => {
    e.preventDefault();
    toggles.forEach(cb => cb.checked = true);
    apply();
  });
  noneBtn?.addEventListener('click', e => {
    e.preventDefault();
    toggles.forEach(cb => cb.checked = false);
    apply();
  });

  // Remember open/closed state of the <details>
  try { colsRoot.open = (localStorage.getItem(openKey) || '0') === '1'; } catch {}
  colsRoot.addEventListener('toggle', () => {
    try { localStorage.setItem(openKey, colsRoot.open ? '1' : '0'); } catch {}
  });

  // Initial render
  apply();
})();

const RECEIPT_TOAST_KEY = 'sa.receipt.uploaded';

(() => {
  const uploadForms = document.querySelectorAll('[data-receipt-upload-form]');
  uploadForms.forEach((form) => {
    const trigger = form.querySelector('[data-receipt-trigger]');
    const input = form.querySelector('[data-receipt-input]');
    if (!trigger || !input) return;

    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      input.click();
    });

    input.addEventListener('change', () => {
      if (!input.files || !input.files.length) return;
      try { sessionStorage.setItem(RECEIPT_TOAST_KEY, '1'); } catch {}
      form.submit();
    });
  });

  document.querySelectorAll('[data-receipt-remove]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const label = btn.getAttribute('data-receipt-label') || 'this receipt';
      confirmDialog({
        title: 'Remove receipt',
        message: `Are you sure you want to remove ${label}?`,
        confirmLabel: 'Remove',
      }).then((ok) => {
        if (ok) btn.closest('form')?.submit();
      });
    });
  });

  let shouldToast = false;
  try {
    shouldToast = sessionStorage.getItem(RECEIPT_TOAST_KEY) === '1';
    if (shouldToast) sessionStorage.removeItem(RECEIPT_TOAST_KEY);
  } catch {}

  if (shouldToast) toast('Receipt uploaded successfully.');
})();
