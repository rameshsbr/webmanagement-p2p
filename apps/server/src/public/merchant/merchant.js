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
  const tz = document.getElementById('pref-tz');
  if (!tz || tz.dataset.filled) return;
  let zones = [];
  try { if (Intl.supportedValuesOf) zones = Intl.supportedValuesOf('timeZone'); } catch {}
  if (!zones.length) zones = ['UTC','Asia/Kuala_Lumpur','Asia/Jakarta','Asia/Singapore','Asia/Bangkok','Europe/London','America/New_York','Australia/Sydney'];
  zones.sort((a,b)=>a.localeCompare(b));
  zones.forEach(z => { const o=document.createElement('option'); o.value=o.textContent=z; tz.appendChild(o); });
  tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  tz.dataset.filled = '1';
})();

// Save/Cancel prefs (keep, but also mirror theme on body/html)
(() => {
  const SAVE_KEY = 'merchant.prefs';
  const read = () => JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
  const write = (obj) => localStorage.setItem(SAVE_KEY, JSON.stringify(obj));

  const el = id => document.getElementById(id);
  const fields = {
    email:    () => el('pref-email')?.value || '',
    currency: () => el('pref-currency')?.value || '',
    tz:       () => el('pref-tz')?.value || '',
    theme:    () => (el('pref-dark')?.checked ? 'dark' : 'light'),
  };
  const apply = p => {
    if (el('pref-email')) el('pref-email').value = p.email || el('pref-email').value || '';
    if (el('pref-currency')) el('pref-currency').value = p.currency || '';
    if (el('pref-tz')) el('pref-tz').value = p.tz || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    if (el('pref-dark')) {
      const dark = (p.theme || 'light') === 'dark';
      el('pref-dark').checked = dark;
      document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.documentElement.classList.toggle('dark', dark);
      document.body?.setAttribute('data-theme', dark ? 'dark' : 'light');
      document.body?.classList.toggle('dark', dark);
    }
  };

  apply(read());

  const saveBtn = el('prefs-save');
  const cancelBtn = el('prefs-cancel');
  saveBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const next = Object.fromEntries(Object.entries(fields).map(([k,f]) => [k, f()]));
    write(next);
    alert('Preferences saved');
  });
  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    apply(read());
    alert('Changes discarded');
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