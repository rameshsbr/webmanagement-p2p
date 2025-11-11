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
    else if (message) console.warn(message);
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

(function () {
  const triggers = document.querySelectorAll('[data-account-modal-open]');
  if (!triggers.length) return;

  const openModal = (templateId) => {
    if (!templateId) return;
    const tpl = document.getElementById(templateId);
    if (!tpl || !('content' in tpl)) return;

    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';

    const card = document.createElement('div');
    card.className = 'modal-card account-modal-card';

    const fragment = tpl.content.cloneNode(true);
    card.appendChild(fragment);
    overlay.appendChild(card);

    const close = () => {
      overlay.classList.remove('is-visible');
      document.removeEventListener('keydown', onKeyDown, true);
      setTimeout(() => overlay.remove(), 180);
    };

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
      }
    };

    const cancelBtn = card.querySelector('[data-close-modal]');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', (event) => {
        event.preventDefault();
        close();
      });
    }

    overlay.addEventListener('click', (event) => {
      if (event.target === overlay) close();
    });

    const fileInput = card.querySelector('[data-account-file-input]');
    const fileTrigger = card.querySelector('[data-account-file-trigger]');
    const fileName = card.querySelector('[data-account-file-name]');
    if (fileTrigger && fileInput) {
      fileTrigger.addEventListener('click', (event) => {
        event.preventDefault();
        fileInput.click();
      });
      fileInput.addEventListener('change', () => {
        const next = fileInput.files && fileInput.files[0] ? fileInput.files[0].name : 'No file chosen';
        if (fileName) fileName.textContent = next;
      });
    }

    const firstField = card.querySelector('select, input, textarea');

    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKeyDown, true);
    requestAnimationFrame(() => {
      overlay.classList.add('is-visible');
      if (firstField && typeof firstField.focus === 'function') firstField.focus();
    });
  };

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      const tpl = trigger.getAttribute('data-account-modal-open');
      openModal(tpl);
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
  let currentTheme = readCookie(DARK_COOKIE) || 'light';
  if (darkInput) {
    darkInput.checked = currentTheme === 'dark';
    document.documentElement.setAttribute('data-theme', currentTheme);
    document.documentElement.classList.toggle('dark', currentTheme === 'dark');
    document.body?.setAttribute('data-theme', currentTheme);
    document.body?.classList.toggle('dark', currentTheme === 'dark');
    darkInput.addEventListener('change', function () {
      const mode = this.checked ? 'dark' : 'light';
      writeCookie(DARK_COOKIE, mode);
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.classList.toggle('dark', mode === 'dark');
      document.body?.setAttribute('data-theme', mode);
      document.body?.classList.toggle('dark', mode === 'dark');
      currentTheme = mode;
    });
  }

  // ──────────────────────────────────────────────────────────
  // Timezones — full world list (matches admin/merchant)
  // ──────────────────────────────────────────────────────────
  const tzSel = document.getElementById('pref-tz');
  if (tzSel && typeof window.timezone?.populate === 'function') {
    window.timezone.populate(tzSel);
  }

  // ──────────────────────────────────────────────────────────
  // Save/Cancel — align with other portals + toasts
  // ──────────────────────────────────────────────────────────
  const PREF_KEY = 'superadmin.prefs';
  const readPrefs = () => {
    try { return JSON.parse(localStorage.getItem(PREF_KEY) || '{}') || {}; }
    catch { return {}; }
  };
  const writePrefs = (value) => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify(value)); }
    catch {}
  };
  const el = (id) => document.getElementById(id);
  const applyPrefs = (prefs) => {
    const next = prefs && typeof prefs === 'object' ? prefs : {};
    const currency = el('pref-currency');
    if (currency && next.currency) currency.value = next.currency;
    const tzField = el('pref-tz');
    if (tzField) {
      const currentTz = typeof window.timezone?.get === 'function' ? window.timezone.get() : '';
      const desired = next.tz || currentTz;
      if (desired) tzField.value = desired;
    }
    if (darkInput) {
      const mode = (next.theme || currentTheme || 'light');
      darkInput.checked = mode === 'dark';
      document.documentElement.setAttribute('data-theme', mode);
      document.documentElement.classList.toggle('dark', mode === 'dark');
      document.body?.setAttribute('data-theme', mode);
      document.body?.classList.toggle('dark', mode === 'dark');
      writeCookie(DARK_COOKIE, mode);
      currentTheme = mode;
    }
  };

  applyPrefs(readPrefs());

  const showToast = (message) => {
    if (!message) return;
    if (typeof window.toast === 'function') window.toast(message);
    else console.info(message);
  };
  const showErrorToast = (message) => {
    if (!message) return;
    if (typeof window.toast?.error === 'function') window.toast.error(message);
    else if (typeof window.toast === 'function') window.toast(message);
    else console.error(message);
  };

  const saveBtn = el('prefs-save');
  const cancelBtn = el('prefs-cancel');

  saveBtn?.addEventListener('click', async (event) => {
    event.preventDefault();
    const next = {
      currency: el('pref-currency')?.value || '',
      tz: el('pref-tz')?.value || '',
      theme: darkInput?.checked ? 'dark' : 'light',
    };
    try {
      const res = await fetch('/superadmin/prefs/timezone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ timezone: next.tz }),
      });
      let data = null;
      try { data = await res.json(); } catch {}
      if (!res.ok || !data?.ok) {
        throw new Error((data && data.error) || 'Failed to save timezone');
      }
      const resolved = data.timezone || next.tz;
      if (typeof window.timezone?.set === 'function') {
        window.timezone.set(resolved);
      }
      next.tz = resolved;
      writePrefs(next);
      applyPrefs(next);
      show('reports');
      showToast('Preference saved.');
    } catch (err) {
      console.error(err);
      showErrorToast('Failed to save preferences.');
    }
  });

  cancelBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    const current = readPrefs();
    if (typeof window.timezone?.get === 'function') {
      current.tz = window.timezone.get();
    }
    applyPrefs(current);
    show('reports');
    showToast('Changes discarded.');
  });
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
