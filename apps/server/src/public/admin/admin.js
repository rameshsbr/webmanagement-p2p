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

// Pending deposit actions (approve/reject with confirmation dialogs)
(() => {
  const table = document.querySelector('[data-pending-actions]');
  if (!table) return;

  const postJson = async (url, payload) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      credentials: 'same-origin',
      body: JSON.stringify(payload || {})
    });
    let data = null;
    try { data = await res.json(); } catch {}
    if (!res.ok || !data?.ok) {
      throw new Error((data && data.error) || 'Request failed');
    }
    return data;
  };

  const openModal = ({ title, submitLabel, contentBuilder, onSubmit }) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h3 id="modal-title">${title}</h3>
        </div>
        <div class="modal-body"></div>
        <div class="modal-footer">
          <button type="button" class="btn small" data-cancel>Cancel</button>
          <button type="button" class="btn small primary" data-submit>${submitLabel}</button>
        </div>
      </div>`;
    const card = overlay.querySelector('.modal-card');
    const body = overlay.querySelector('.modal-body');
    const errorBox = document.createElement('div');
    errorBox.className = 'modal-error';
    body.appendChild(errorBox);
    const content = contentBuilder();
    if (content) body.appendChild(content);

    const cancelBtn = overlay.querySelector('[data-cancel]');
    const submitBtn = overlay.querySelector('[data-submit]');

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', escHandler);
    };

    const setError = (msg) => {
      errorBox.textContent = msg || '';
      errorBox.style.display = msg ? 'block' : 'none';
    };

    const setLoading = (v) => {
      if (v) submitBtn.dataset.originalLabel = submitBtn.textContent;
      submitBtn.textContent = v ? 'Processing…' : (submitBtn.dataset.originalLabel || submitBtn.textContent);
      submitBtn.disabled = cancelBtn.disabled = !!v;
    };

    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);
    document.addEventListener('keydown', escHandler);

    submitBtn.addEventListener('click', async () => {
      setError('');
      try {
        setLoading(true);
        await onSubmit({ close, setError, setLoading, overlay, card });
      } catch (err) {
        setError(err?.message || 'Something went wrong');
        setLoading(false);
      }
    });

    document.body.appendChild(overlay);
    submitBtn.focus();
  };

  const openApprove = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const currency = btn.getAttribute('data-currency') || '';
    const originalAmount = Number(btn.getAttribute('data-amount') || '0');

    const contentBuilder = () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal-fields';
      wrapper.innerHTML = `
        <p>Approve deposit <strong>${reference}</strong>?</p>
        <label class="modal-field">
          <span>Amount (${currency})</span>
          <input type="number" step="1" min="1" value="${originalAmount}" data-amount-input />
        </label>
        <label class="modal-field">
          <span>Comment <small>(required if amount changes)</small></span>
          <textarea rows="3" data-comment-input placeholder="Optional comment"></textarea>
        </label>`;
      return wrapper;
    };

    openModal({
      title: 'Confirm approval',
      submitLabel: 'Approve',
      contentBuilder,
      onSubmit: async ({ close, setError, setLoading, card }) => {
        const amountInput = card.querySelector('[data-amount-input]');
        const commentInput = card.querySelector('[data-comment-input]');
        const raw = (amountInput?.value || '').trim();
        const comment = (commentInput?.value || '').trim();
        if (!raw) {
          throw new Error('Amount is required');
        }
        const nextAmount = Number(raw);
        if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
          throw new Error('Enter a valid amount');
        }
        const rounded = Math.round(nextAmount);
        const amountChanged = rounded !== originalAmount;
        if (amountChanged && !comment) {
          throw new Error('Comment is required when changing the amount');
        }

        await postJson(`/admin/deposits/${encodeURIComponent(id)}/approve`, {
          amountCents: rounded,
          comment
        });
        close();
        toast('Deposit approved');
        window.location.reload();
      }
    });
  };

  const openReject = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const currency = btn.getAttribute('data-currency') || '';
    const amount = btn.getAttribute('data-amount') || '';

    const contentBuilder = () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal-fields';
      wrapper.innerHTML = `
        <p>Reject deposit <strong>${reference}</strong> (${amount} ${currency})?</p>
        <label class="modal-field">
          <span>Comment <small>(required)</small></span>
          <textarea rows="3" data-comment-input placeholder="Reason for rejection"></textarea>
        </label>`;
      return wrapper;
    };

    openModal({
      title: 'Reject deposit',
      submitLabel: 'Reject',
      contentBuilder,
      onSubmit: async ({ close, card }) => {
        const commentInput = card.querySelector('[data-comment-input]');
        const comment = (commentInput?.value || '').trim();
        if (!comment) {
          throw new Error('Comment is required');
        }

        await postJson(`/admin/deposits/${encodeURIComponent(id)}/reject`, { comment });
        close();
        toast('Deposit rejected');
        window.location.reload();
      }
    });
  };

  table.addEventListener('click', (event) => {
    const approveBtn = event.target.closest('[data-approve]');
    if (approveBtn) {
      event.preventDefault();
      openApprove(approveBtn);
      return;
    }
    const rejectBtn = event.target.closest('[data-reject]');
    if (rejectBtn) {
      event.preventDefault();
      openReject(rejectBtn);
    }
  });
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