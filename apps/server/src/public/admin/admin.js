// ───────────────── Sidebar collapse (persisted) ─────────────────
(() => {
  const KEY = 'admin.sidebar.collapsed';
  const shell = document.querySelector('[data-shell]');
  const btn = document.querySelector('.sb-toggle');
  if (!shell || !btn) return;
  const apply = (v) => shell.setAttribute('data-collapsed', v ? '1' : '0');
  const init = localStorage.getItem(KEY) === '1';
  apply(init);
  btn.addEventListener('click', () => {
    const next = shell.getAttribute('data-collapsed') !== '1';
    apply(next);
    localStorage.setItem(KEY, next ? '1' : '0');
  });
})();

// Collapsible with persistence
document.querySelectorAll('[data-collapsible]').forEach((box) => {
  const btn = box.querySelector('[data-toggle-collapse]');
  const key = (box.getAttribute('data-storage-key') || 'collapsible') + '::collapsed';
  const set = (v) => box.classList.toggle('is-collapsed', !!v);
  const saved = localStorage.getItem(key);
  if (saved !== null) set(saved === '1');
  btn?.addEventListener('click', () => {
    const next = !box.classList.contains('is-collapsed');
    set(next);
    localStorage.setItem(key, next ? '1' : '0');
  });
});

// Column visibility
(() => {
  const KEY = 'admin.columns';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');
  document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
    const col = cb.getAttribute('data-col-toggle');
    if (Object.prototype.hasOwnProperty.call(saved, col)) cb.checked = !!saved[col];
    const apply = () => {
      document.querySelectorAll(`[data-col="${col}"]`).forEach((el) => {
        el.style.display = cb.checked ? '' : 'none';
      });
      const next = JSON.parse(localStorage.getItem(KEY) || '{}');
      next[col] = cb.checked;
      localStorage.setItem(KEY, JSON.stringify(next));
    };
    cb.addEventListener('change', apply);
    apply();
  });
})();

// Sidebar section toggle (Processing vs Settings)
(() => {
  const show = (section) => {
    document.querySelectorAll('[data-section="reports"]').forEach(el => el.style.display = section === 'reports' ? '' : 'none');
    document.querySelectorAll('[data-section="prefs"]').forEach(el => el.style.display = section === 'prefs' ? '' : 'none');
    document.querySelectorAll('.sb-top-buttons .icon-btn').forEach(b => b.classList.remove('active'));
    document.querySelector(`.sb-top-buttons [data-show="${section}"]`)?.classList.add('active');
  };
  show('reports');
  document.querySelectorAll('[data-show]').forEach((btn) => {
    btn.addEventListener('click', (e) => { e.preventDefault(); show(btn.getAttribute('data-show')); });
  });
})();

// Toast helper
function toast(msg) {
  let t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 250); }, 1400);
}

// Theme switch + persist (no DOM injection; uses the iOS switch in markup)
(() => {
  const key = 'admin.theme';
  const root = document.documentElement;
  const dark = document.getElementById('pref-dark');
  const applyTheme = (mode) => root.setAttribute('data-theme', mode);

  const saved = localStorage.getItem(key) || 'light';
  applyTheme(saved);
  if (dark) {
    dark.checked = saved === 'dark';
    dark.addEventListener('change', () => {
      const next = dark.checked ? 'dark' : 'light';
      applyTheme(next);
      localStorage.setItem(key, next);
    });
  }
})();

// Time zones list
(() => {
  const tz = document.getElementById('pref-tz');
  if (!tz || tz.dataset.filled) return;
  let zones = [];
  try { if (Intl.supportedValuesOf) zones = Intl.supportedValuesOf('timeZone'); } catch {}
  if (!zones.length) zones = ['UTC','Asia/Kuala_Lumpur','Asia/Jakarta','Asia/Singapore','Asia/Bangkok','Europe/London','America/New_York','Australia/Sydney'];
  zones.sort((a,b) => a.localeCompare(b));
  zones.forEach(z => { const o=document.createElement('option'); o.value=o.textContent=z; tz.appendChild(o); });
  tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  tz.dataset.filled = '1';
})();

// Preferences Save / Cancel
(() => {
  const SAVE_KEY = 'admin.prefs';
  const read = () => JSON.parse(localStorage.getItem(SAVE_KEY) || '{}');
  const write = (obj) => localStorage.setItem(SAVE_KEY, JSON.stringify(obj));

  const el = (id) => document.getElementById(id);
  const fields = {
    email: () => el('pref-email')?.value || '',
    currency: () => el('pref-currency')?.value || '',
    tz: () => el('pref-tz')?.value || '',
    theme: () => (el('pref-dark')?.checked ? 'dark' : 'light')
  };
  const apply = (p) => {
    if (el('pref-email')) el('pref-email').value = p.email || '';
    if (el('pref-currency')) el('pref-currency').value = p.currency || '';
    if (el('pref-tz')) el('pref-tz').value = p.tz || (Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    if (el('pref-dark')) {
      el('pref-dark').checked = (p.theme || 'light') === 'dark';
      document.documentElement.setAttribute('data-theme', el('pref-dark').checked ? 'dark' : 'light');
    }
  };

  const init = read();
  if (!init.theme) init.theme = (document.documentElement.getAttribute('data-theme') || 'light');
  apply(init);

  const saveBtn = el('prefs-save');
  const cancelBtn = el('prefs-cancel');
  saveBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const next = Object.fromEntries(Object.entries(fields).map(([k,f]) => [k, f()]));
    write(next);
    toast('Preferences saved');
  });
  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    apply(read());
    toast('Changes discarded');
  });
})();

// Date-range popover
(() => {
  const wrap = document.querySelector('[data-range]');
  if (!wrap) return;

  const pop = wrap.querySelector('[data-range-pop]');
  const openBtn = wrap.querySelector('[data-range-open]');
  const fromInput = wrap.querySelector('[data-range-from]');
  const toInput = wrap.querySelector('[data-range-to]');
  const disp = wrap.querySelector('.range-display');
  const hidFrom = document.querySelector('input[name="from"]');
  const hidTo = document.querySelector('input[name="to"]');

  const pad = (n) => String(n).padStart(2,'0');
  const fmtDisp = (d) => `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  const toLocal = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

  function setDefaultRange() {
    const now = new Date();
    const start = new Date(now); start.setHours(0,0,0,0);
    hidFrom.value = start.toISOString();
    hidTo.value = now.toISOString();
    fromInput.value = toLocal(start);
    toInput.value = toLocal(now);
  }

  if (!hidFrom.value || !hidTo.value) setDefaultRange();
  else {
    const f = new Date(hidFrom.value), t = new Date(hidTo.value);
    if (!isNaN(f)) fromInput.value = toLocal(f);
    if (!isNaN(t)) toInput.value = toLocal(t);
  }

  function render() {
    const f = new Date(hidFrom.value || Date.now());
    const t = new Date(hidTo.value || Date.now());
    disp.textContent = `${fmtDisp(f)} ~ ${fmtDisp(t)}`;
  }
  render();

  const escHandler = (e) => { if (e.key === 'Escape') { wrap.classList.remove('open'); document.removeEventListener('keydown', escHandler); } };

  openBtn.addEventListener('click', () => {
    wrap.classList.toggle('open');
    if (wrap.classList.contains('open')) document.addEventListener('keydown', escHandler);
    else document.removeEventListener('keydown', escHandler);
  });

  pop.querySelector('[data-range-clear]').addEventListener('click', () => {
    setDefaultRange(); render();
  });

  pop.querySelector('[data-range-apply]').addEventListener('click', () => {
    const f = fromInput.value ? new Date(fromInput.value) : null;
    const t = toInput.value ? new Date(toInput.value) : null;
    if (f) hidFrom.value = f.toISOString();
    if (t) hidTo.value = t.toISOString();
    render();
    wrap.classList.remove('open');
    document.removeEventListener('keydown', escHandler);
  });

  pop.querySelector('[data-range-close]').addEventListener('click', () => {
    wrap.classList.remove('open');
    document.removeEventListener('keydown', escHandler);
  });

  fromInput.addEventListener('change', () => {
    const f = new Date(fromInput.value);
    if (!isNaN(f)) hidFrom.value = f.toISOString();
    render();
  });
  toInput.addEventListener('change', () => {
    const t = new Date(toInput.value);
    if (!isNaN(t)) hidTo.value = t.toISOString();
    render();
  });
})();

// Highlight active sidebar link
(() => {
  const here = location.pathname.replace(/\/+$/, '');
  document.querySelectorAll('.nav .nav-link').forEach((a) => {
    const href = (a.getAttribute('href') || '').replace(/\/+$/, '');
    if (href && href === here) a.classList.add('active');
  });
})();

// Optional logout confirm
document.querySelectorAll('a[href="/auth/logout"]').forEach((a) => {
  a.addEventListener('click', (e) => {
    if (!confirm('Log out of the admin session?')) e.preventDefault();
  });
});

// ───────────────── Pending deposit action modal ─────────────────
(() => {
  const root = document.querySelector('[data-modal-root]');
  if (!root) return;

  const form = root.querySelector('[data-modal-form]');
  const amountWrap = root.querySelector('[data-modal-amount-wrap]');
  const amountInput = root.querySelector('[data-modal-amount]');
  const commentInput = root.querySelector('[data-modal-comment]');
  const commentLabel = root.querySelector('[data-modal-comment-label]');
  const title = root.querySelector('[data-modal-title]');
  const note = root.querySelector('[data-modal-note]');
  const reference = root.querySelector('[data-modal-reference]');
  const errorBox = root.querySelector('[data-modal-error]');
  const cancelBtn = root.querySelector('[data-modal-cancel]');
  const submitBtn = root.querySelector('[data-modal-submit]');
  const returnInput = root.querySelector('[data-modal-return]');

  let state = {
    mode: /** @type {'approve'|'reject'|null} */ (null),
    originalAmount: 0,
    currency: '',
    id: ''
  };

  function formatAmount(value, currency) {
    const formatter = new Intl.NumberFormat(undefined, { style: 'currency', currency, minimumFractionDigits: 2 });
    const units = Number.isFinite(value) ? value / 100 : 0;
    try {
      return formatter.format(units);
    } catch {
      return `${value} ${currency}`;
    }
  }

  function openModal(config) {
    state = {
      mode: config.mode,
      originalAmount: config.amount,
      currency: config.currency,
      id: config.id
    };

    form.setAttribute('action', `/admin/deposits/${config.id}/${config.mode}`);
    errorBox.textContent = '';

    reference.textContent = `${config.reference} • ${formatAmount(config.amount, config.currency)}`;

    if (config.mode === 'approve') {
      title.textContent = 'Approve deposit';
      note.textContent = 'Confirm or adjust the amount to credit. Comment is required if the amount changes.';
      amountWrap.hidden = false;
      amountInput.disabled = false;
      amountInput.value = String(config.amount);
      amountInput.name = 'amountCents';
      commentInput.value = '';
      commentInput.name = 'comment';
      commentInput.placeholder = 'Add a note (required if amount changes)';
      commentLabel.textContent = 'Comment (optional unless amount changes)';
      submitBtn.textContent = 'Approve';
    } else {
      title.textContent = 'Reject deposit';
      note.textContent = 'Provide a reason for rejecting this deposit.';
      amountWrap.hidden = true;
      amountInput.disabled = true;
      amountInput.name = '';
      commentInput.value = '';
      commentInput.name = 'reason';
      commentInput.placeholder = 'Reason for rejection (required)';
      commentLabel.textContent = 'Comment (required)';
      submitBtn.textContent = 'Reject';
    }

    if (!returnInput.value || !returnInput.value.startsWith('/admin')) {
      returnInput.value = '/admin/report/deposits/pending';
    }

    root.classList.add('open');
    root.removeAttribute('hidden');
    if (config.mode === 'approve') amountInput.focus();
    else commentInput.focus();
    document.addEventListener('keydown', escHandler);
  }

  function closeModal() {
    root.classList.remove('open');
    root.setAttribute('hidden', '');
    errorBox.textContent = '';
    document.removeEventListener('keydown', escHandler);
  }

  function escHandler(event) {
    if (event.key === 'Escape') {
      closeModal();
    }
  }

  root.addEventListener('click', (event) => {
    if (event.target === root) closeModal();
  });

  cancelBtn?.addEventListener('click', (event) => {
    event.preventDefault();
    closeModal();
  });

  form.addEventListener('submit', (event) => {
    errorBox.textContent = '';

    if (state.mode === 'approve') {
      const value = Number.parseInt(amountInput.value || '', 10);
      if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        event.preventDefault();
        errorBox.textContent = 'Enter a valid amount (in cents).';
        amountInput.focus();
        return;
      }
      if (value !== state.originalAmount && !commentInput.value.trim()) {
        event.preventDefault();
        errorBox.textContent = 'Comment is required when adjusting the amount.';
        commentInput.focus();
        return;
      }
    }

    if (state.mode === 'reject') {
      if (!commentInput.value.trim()) {
        event.preventDefault();
        errorBox.textContent = 'Comment is required to reject.';
        commentInput.focus();
        return;
      }
    }
  });

  document.querySelectorAll('[data-admin-action]').forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('data-admin-action');
      if (mode !== 'approve' && mode !== 'reject') return;
      const amount = Number.parseInt(button.getAttribute('data-amount') || '0', 10);
      const currency = button.getAttribute('data-currency') || 'USD';
      const referenceCode = button.getAttribute('data-reference') || '';
      openModal({
        mode,
        id: button.getAttribute('data-id') || '',
        reference: referenceCode,
        amount: Number.isFinite(amount) ? amount : 0,
        currency
      });
    });
  });
})();
