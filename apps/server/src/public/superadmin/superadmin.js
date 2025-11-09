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
      if (confirm(`Remove ${label}?`)) {
        btn.closest('form')?.submit();
      }
    });
  });

  let shouldToast = false;
  try {
    shouldToast = sessionStorage.getItem(RECEIPT_TOAST_KEY) === '1';
    if (shouldToast) sessionStorage.removeItem(RECEIPT_TOAST_KEY);
  } catch {}

  if (shouldToast) toast('Receipt uploaded successfully.');
})();
