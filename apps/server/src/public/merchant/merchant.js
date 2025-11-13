// Minimal sidebar + theme for merchant (separate keys from admin)

// Sidebar collapse (persisted)
(() => {
  const KEY = 'merchant.sidebar.collapsed';
  const shell = document.querySelector('[data-shell]');
  const btn = document.querySelector('.sb-toggle');
  if (!shell || !btn) return;
  const apply = v => shell.setAttribute('data-collapsed', v ? '1' : '0');
  const init = localStorage.getItem(KEY) === '1';
  apply(init);
  btn.addEventListener('click', () => {
    const next = shell.getAttribute('data-collapsed') !== '1';
    apply(next);
    localStorage.setItem(KEY, next ? '1' : '0');
  });
})();

// Collapsible panels (persisted per storage key)
document.querySelectorAll('[data-collapsible]').forEach((box) => {
  const btn = box.querySelector('[data-toggle-collapse]');
  if (!btn) return;
  const key = (box.getAttribute('data-storage-key') || 'merchant.collapsible') + '::collapsed';
  const set = (v) => box.classList.toggle('is-collapsed', !!v);
  const saved = localStorage.getItem(key);
  if (saved !== null) set(saved === '1');
  btn.addEventListener('click', () => {
    const next = !box.classList.contains('is-collapsed');
    set(next);
    localStorage.setItem(key, next ? '1' : '0');
  });
});

// Column visibility (shared with admin tables)
(() => {
  document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
    const container = cb.closest('[data-collapsible]');
    const storageKey = container?.getAttribute('data-storage-key') || 'merchant.columns';
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
    } catch {
      saved = {};
    }
    const col = cb.getAttribute('data-col-toggle');
    if (Object.prototype.hasOwnProperty.call(saved, col)) cb.checked = !!saved[col];

    const apply = () => {
      document.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        el.style.display = cb.checked ? '' : 'none';
      });
      let next;
      try {
        next = JSON.parse(localStorage.getItem(storageKey) || '{}') || {};
      } catch {
        next = {};
      }
      next[col] = cb.checked;
      localStorage.setItem(storageKey, JSON.stringify(next));
    };

    cb.addEventListener('change', apply);
    apply();
  });
})();

(function () {
  const controls = document.querySelectorAll('[data-export-control]');
  if (!controls.length) return;

  const notify = (message, options) => {
    if (typeof window.toast === 'function') window.toast(message, options);
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
    const storageKey = control.getAttribute('data-export-storage') || 'merchant.export.default';

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

// Sidebar section toggle
(() => {
  const show = section => {
    document.querySelectorAll('[data-section="reports"]').forEach(el => el.style.display = section === 'reports' ? '' : 'none');
    document.querySelectorAll('[data-section="prefs"]').forEach(el => el.style.display = section === 'prefs' ? '' : 'none');
    document.querySelectorAll('.sb-top-buttons .icon-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sb-top-buttons [data-show="${section}"]`)?.classList.add('active');
  };
  show('reports');
  document.querySelectorAll('[data-show]').forEach(btn => {
    btn.addEventListener('click', e => { e.preventDefault(); show(btn.getAttribute('data-show')); });
  });
})();

// Merchant payments: trigger test deposit/withdrawal actions
(() => {
  const container = document.querySelector('[data-test-payments]');
  if (!container) return;

  const depositBtn = container.querySelector('[data-action="test-deposit"]');
  const withdrawalBtn = container.querySelector('[data-action="test-withdrawal"]');
  if (!depositBtn && !withdrawalBtn) return;

  const statusEl = container.querySelector('[data-test-status]');
  const subjectEl = container.querySelector('[data-test-subject]');
  const initialSubject = container.getAttribute('data-subject') || '';
  if (!initialSubject && subjectEl) subjectEl.textContent = '—';

  const csrfToken = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';

  const readSubject = () => container.getAttribute('data-subject') || '';
  const setSubject = (value) => {
    container.setAttribute('data-subject', value || '');
    if (subjectEl) subjectEl.textContent = value || '—';
  };

  const setStatus = (message, isError = false) => {
    if (!statusEl) return;
    statusEl.textContent = message || '';
    statusEl.style.opacity = message ? '0.9' : '0.75';
    if (isError) {
      statusEl.dataset.state = 'error';
      statusEl.style.color = 'var(--danger, #c0392b)';
    } else {
      statusEl.dataset.state = 'ok';
      statusEl.style.color = '';
    }
  };

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

  const setLoading = (loading) => {
    container.dataset.loading = loading ? '1' : '0';
    [depositBtn, withdrawalBtn].forEach((btn) => {
      if (btn) btn.disabled = loading;
    });
    if (loading) setStatus('Creating test payment…');
  };

  const updateQuerySubject = (subject) => {
    try {
      const url = new URL(window.location.href);
      if (subject) url.searchParams.set('subject', subject);
      else url.searchParams.delete('subject');
      url.searchParams.delete('diditSubject');
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };

  const postTestPayment = async (kind) => {
    const endpoint = kind === 'deposit'
      ? '/merchant/payments/test-deposit'
      : '/merchant/payments/test-withdrawal';

    const payload = { subject: readSubject() };

    setLoading(true);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
        },
        body: JSON.stringify(payload),
      });

      let data = null;
      try { data = await res.json(); } catch {}

      if (!res.ok || !data?.ok) {
        const message = (data && data.error) || `Failed to create test ${kind}`;
        throw new Error(message);
      }

      const nextSubject = (data && data.subject) || readSubject();
      if (nextSubject) {
        setSubject(nextSubject);
        updateQuerySubject(nextSubject);
      }

      const label = kind === 'deposit' ? 'deposit' : 'withdrawal';
      const code = data && data.referenceCode ? ` ${data.referenceCode}` : '';
      const successMessage = (data && data.message) || `Created test ${label}${code}`.trim();
      setStatus(successMessage);
      showToast((data && data.toast) || `Created test ${label}.`);

      window.setTimeout(() => {
        window.location.reload();
      }, 800);
    } catch (err) {
      const message = (err && err.message) || `Failed to create test ${kind}`;
      setStatus(message, true);
      showErrorToast(message);
    } finally {
      setLoading(false);
    }
  };

  depositBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    postTestPayment('deposit');
  });

  withdrawalBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    postTestPayment('withdrawal');
  });
})();

// ─── THEME: persist via localStorage + cookie, apply to <html> and <body> ───
(() => {
  const KEY = 'merchant.theme';
  const COOKIE = 'merchant_theme';

  const getCookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]+)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  const setCookie = (name, value) => {
    // 1 year, path-wide
    document.cookie = `${name}=${encodeURIComponent(value)}; Max-Age=31536000; Path=/`;
  };
  const persistServer = (mode) => {
    try {
      fetch('/merchant/prefs/theme', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'mode=' + encodeURIComponent(mode),
        credentials: 'same-origin'
      }).catch(() => {});
    } catch {}
  };

  const applyTheme = (mode) => {
    const root = document.documentElement;
    root.setAttribute('data-theme', mode);
    root.classList.toggle('dark', mode === 'dark');
    const setBody = () => {
      document.body?.setAttribute('data-theme', mode);
      document.body?.classList.toggle('dark', mode === 'dark');
    };
    if (document.body) setBody();
    else document.addEventListener('DOMContentLoaded', setBody);
  };

  const detect = () => {
    try {
      return (
        localStorage.getItem(KEY) ||
        getCookie(COOKIE) ||
        (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      );
    } catch { return 'light'; }
  };

  const init = detect();
  applyTheme(init);

  // NEW: on first load, if the cookie doesn't match the chosen theme, fix it and notify the server
  try {
    const currentCookie = getCookie(COOKIE);
    if (currentCookie !== init) {
      setCookie(COOKIE, init);
      persistServer(init);
    }
    if (localStorage.getItem(KEY) !== init) {
      localStorage.setItem(KEY, init);
    }
  } catch {}

  const dark = document.getElementById('pref-dark');
  if (dark) {
    dark.checked = init === 'dark';
    dark.addEventListener('change', () => {
      const next = dark.checked ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(KEY, next); } catch {}
      setCookie(COOKIE, next);
      persistServer(next); // tell server immediately so next navigation renders with the same theme
    });
  }
})();

// Time zones dropdown
(() => {
  const select = document.getElementById('pref-tz');
  if (!select || typeof window.timezone?.populate !== 'function') return;
  window.timezone.populate(select);
})();

// Save/Cancel prefs (keep, but also mirror theme on body/html)
(() => {
  const SAVE_KEY = 'merchant.prefs';
  const read = () => {
    try {
      return JSON.parse(localStorage.getItem(SAVE_KEY) || '{}') || {};
    } catch {
      return {};
    }
  };
  const write = (obj) => {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(obj));
    } catch {}
  };

  const el = id => document.getElementById(id);
  const ensureTimezoneOption = (value) => {
    const select = el('pref-tz');
    if (!select || !value) return value;
    const options = Array.from(select.options || []);
    return options.some((opt) => opt.value === value) ? value : '';
  };
  const fields = {
    email:    () => el('pref-email')?.value || '',
    currency: () => el('pref-currency')?.value || '',
    tz:       () => el('pref-tz')?.value || '',
    theme:    () => (el('pref-dark')?.checked ? 'dark' : 'light'),
  };
  const apply = p => {
    if (el('pref-email')) el('pref-email').value = p.email || el('pref-email').value || '';
    if (el('pref-currency')) el('pref-currency').value = p.currency || '';
    const tzSelect = el('pref-tz');
    if (tzSelect) {
      const currentTz = typeof window.timezone?.get === 'function' ? window.timezone.get() : '';
      const desired = ensureTimezoneOption(p.tz) || currentTz;
      if (desired) tzSelect.value = desired;
    }
    if (el('pref-dark')) {
      const dark = (p.theme || 'light') === 'dark';
      el('pref-dark').checked = dark;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', dark);
      document.body?.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.body?.classList.toggle('dark', dark);
    }
  };

  const initial = read();
  if (!initial.tz && typeof window.timezone?.get === 'function') initial.tz = window.timezone.get();
  apply(initial);

  const saveBtn = el('prefs-save');
  const cancelBtn = el('prefs-cancel');
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
  async function persistTimezone(timezone) {
    const res = await fetch('/merchant/prefs/timezone', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify({ timezone }),
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data?.ok) {
      throw new Error((data && data.error) || 'Failed to save timezone');
    }
    return data.timezone || timezone;
  }

  saveBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const next = Object.fromEntries(Object.entries(fields).map(([k,f]) => [k, f()]));
    try {
      const resolved = await persistTimezone(next.tz);
      if (typeof window.timezone?.set === 'function') window.timezone.set(resolved);
      next.tz = resolved;
      write(next);
      showToast('Preference saved.');
    } catch (err) {
      console.error(err);
      showErrorToast('Failed to save preferences.');
    }
  });
  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const current = read();
    if (typeof window.timezone?.get === 'function') {
      current.tz = window.timezone.get();
    }
    apply(current);
    showToast('Changes discarded.');
  });
})();

// Active nav highlight
(() => {
  const here = location.pathname.replace(/\/+$/, '');
  document.querySelectorAll('.nav .nav-link').forEach((a) => {
    const href = (a.getAttribute('href') || '').replace(/\/+$/, '');
    if (href && href === here) a.classList.add('active');
  });
})();