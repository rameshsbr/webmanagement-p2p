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

// Column visibility (per widget key)
(() => {
  document.querySelectorAll('[data-col-toggle]').forEach((cb) => {
    const container = cb.closest('[data-collapsible]');
    const storageKey = container?.getAttribute('data-storage-key') || 'admin.columns';
    let saved: Record<string, boolean>;
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
      let next: Record<string, boolean>;
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

const purgeModals = () => {
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
};
purgeModals();
window.addEventListener('pageshow', purgeModals);

// Pending deposit actions (approve/reject with confirmation dialogs)
(() => {
  const table = document.querySelector('[data-pending-actions]');
  if (!table) return;

  purgeModals();

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
      overlay.classList.remove('is-visible');
      document.removeEventListener('keydown', escHandler);
      window.setTimeout(() => overlay.remove(), 180);
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
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    submitBtn.focus();
  };

  const openApprove = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const currency = btn.getAttribute('data-currency') || '';
    const originalCents = Number(btn.getAttribute('data-amount') || '0');
    const originalAmount = originalCents / 100;
    const originalDisplay = (originalCents % 100 === 0) ? originalAmount.toFixed(0) : originalAmount.toFixed(2);

    const contentBuilder = () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal-fields';
      wrapper.innerHTML = `
        <p>Approve deposit <strong>${reference}</strong> (${currency} ${originalDisplay})?</p>
        <label class="modal-field">
          <span>Amount (${currency})</span>
          <input type="number" step="0.01" min="0.01" value="${originalDisplay}" data-amount-input />
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
        const roundedCents = Math.round(nextAmount * 100);
        const originalRounded = Math.round(originalAmount * 100);
        const amountChanged = roundedCents !== originalRounded;
        if (amountChanged && !comment) {
          throw new Error('Comment is required when changing the amount');
        }

        await postJson(`/admin/deposits/${encodeURIComponent(id)}/approve`, {
          amount: Number(nextAmount.toFixed(2)),
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
    const amountCents = Number(btn.getAttribute('data-amount') || '0');
    const amountDisplay = (amountCents % 100 === 0)
      ? (amountCents / 100).toFixed(0)
      : (amountCents / 100).toFixed(2);

    const contentBuilder = () => {
      const wrapper = document.createElement('div');
      wrapper.className = 'modal-fields';
      wrapper.innerHTML = `
        <p>Reject deposit <strong>${reference}</strong> (${currency} ${amountDisplay})?</p>
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

// Pending withdrawal actions
(() => {
  const table = document.querySelector('[data-withdraw-actions]');
  if (!table) return;

  purgeModals();

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

  const openModal = ({ title, submitLabel, message, requireComment, onSubmit }) => {
    const overlay = document.createElement('div');
    overlay.className = 'modal-backdrop';
    overlay.innerHTML = `
      <div class="modal-card" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal-header">
          <h3 id="modal-title">${title}</h3>
        </div>
        <div class="modal-body">
          <p>${message}</p>
          <label class="modal-field">
            <span>Comment${requireComment ? ' <small>(required)</small>' : ''}</span>
            <textarea rows="3" data-comment-input placeholder="${requireComment ? 'Enter a comment' : 'Optional comment'}"></textarea>
          </label>
          <div class="modal-error" style="display:none"></div>
        </div>
        <div class="modal-footer">
          <button type="button" class="btn small" data-cancel>Cancel</button>
          <button type="button" class="btn small primary" data-submit>${submitLabel}</button>
        </div>
      </div>`;

    const cancelBtn = overlay.querySelector('[data-cancel]');
    const submitBtn = overlay.querySelector('[data-submit]');
    const card = overlay.querySelector('.modal-card');
    const errorBox = overlay.querySelector('.modal-error');
    const commentInput = overlay.querySelector('[data-comment-input]');

    const close = () => {
      overlay.classList.remove('is-visible');
      document.removeEventListener('keydown', escHandler);
      window.setTimeout(() => overlay.remove(), 180);
    };
    const escHandler = (e) => { if (e.key === 'Escape') close(); };
    const setError = (msg) => {
      errorBox.textContent = msg || '';
      errorBox.style.display = msg ? 'block' : 'none';
    };
    const setLoading = (v) => {
      if (v) submitBtn.dataset.originalLabel = submitBtn.textContent;
      submitBtn.textContent = v ? 'Processing…' : (submitBtn.dataset.originalLabel || submitBtn.textContent);
      submitBtn.disabled = cancelBtn.disabled = !!v;
    };

    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    cancelBtn.addEventListener('click', close);
    document.addEventListener('keydown', escHandler);

    submitBtn.addEventListener('click', async () => {
      const comment = (commentInput?.value || '').trim();
      if (requireComment && !comment) {
        setError('Comment is required');
        return;
      }
      setError('');
      try {
        setLoading(true);
        await onSubmit({ comment, setError, setLoading, close });
      } catch (err) {
        setLoading(false);
        setError(err?.message || 'Request failed');
      }
    });

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('is-visible'));
    submitBtn.focus();
  };

  table.addEventListener('click', (event) => {
    const approveBtn = event.target.closest('[data-withdraw-approve]');
    if (approveBtn) {
      event.preventDefault();
      const id = approveBtn.getAttribute('data-id');
      const reference = approveBtn.getAttribute('data-reference') || '';
      const amountCents = Number(approveBtn.getAttribute('data-amount') || '0');
      const currency = approveBtn.getAttribute('data-currency') || '';
      const display = amountCents % 100 === 0 ? (amountCents / 100).toFixed(0) : (amountCents / 100).toFixed(2);

      openModal({
        title: 'Approve withdrawal',
        submitLabel: 'Approve',
        message: `Approve withdrawal <strong>${reference}</strong> (${currency} ${display})?`,
        requireComment: false,
        onSubmit: async ({ comment, close }) => {
          await postJson(`/admin/withdrawals/${encodeURIComponent(id)}/approve`, { comment });
          close();
          toast('Withdrawal approved');
          window.location.reload();
        }
      });
      return;
    }

    const rejectBtn = event.target.closest('[data-withdraw-reject]');
    if (rejectBtn) {
      event.preventDefault();
      const id = rejectBtn.getAttribute('data-id');
      const reference = rejectBtn.getAttribute('data-reference') || '';
      const amountCents = Number(rejectBtn.getAttribute('data-amount') || '0');
      const currency = rejectBtn.getAttribute('data-currency') || '';
      const display = amountCents % 100 === 0 ? (amountCents / 100).toFixed(0) : (amountCents / 100).toFixed(2);

      openModal({
        title: 'Reject withdrawal',
        submitLabel: 'Reject',
        message: `Reject withdrawal <strong>${reference}</strong> (${currency} ${display})?`,
        requireComment: true,
        onSubmit: async ({ comment, close }) => {
          await postJson(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, { comment });
          close();
          toast('Withdrawal rejected');
          window.location.reload();
        }
      });
    }
  });
})();

// Browser notifications for new queue items
(() => {
  if (typeof window.fetch !== 'function') return;
  const shell = document.querySelector('.shell');
  if (!shell) return;

  const NotificationAPI = 'Notification' in window ? window.Notification : null;
  let lastStamp = Date.now();
  let audioCtx = null;
  let autoReloadScheduled = false;
  let permissionBanner = null;

  const findAutoRefreshContext = () =>
    document.querySelector('[data-auto-refresh="pending-deposits"]') ||
    document.querySelector('[data-auto-refresh="pending-withdrawals"]');

  const scheduleReload = () => {
    if (autoReloadScheduled) return;
    const ctx = findAutoRefreshContext();
    if (!ctx) return;
    autoReloadScheduled = true;
    window.setTimeout(() => window.location.reload(), 1500);
  };

  const ensureAudio = () => {
    if (audioCtx) return audioCtx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    audioCtx = new Ctx();
    return audioCtx;
  };

  const playChime = () => {
    const ctx = ensureAudio();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(880, now);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.1);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 1.2);
  };

  const requestPermission = () => {
    if (!NotificationAPI) return;
    if (NotificationAPI.permission === 'default') {
      NotificationAPI.requestPermission()
        .then(() => ensurePermissionPrompt())
        .catch(() => {});
    }
  };

  const prime = () => {
    requestPermission();
    const ctx = ensureAudio();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
  };

  document.addEventListener('pointerdown', () => {
    prime();
    ensurePermissionPrompt();
  }, { once: true });

  const ensurePermissionPrompt = () => {
    if (!NotificationAPI || NotificationAPI.permission !== 'default') {
      if (permissionBanner) {
        permissionBanner.remove();
        permissionBanner = null;
      }
      return;
    }
    if (permissionBanner) return;
    permissionBanner = document.createElement('div');
    permissionBanner.className = 'notification-permission-banner';
    permissionBanner.innerHTML = `
      <div>
        <strong>Enable browser alerts?</strong>
        <span>Allow notifications to get instant deposit/withdrawal updates.</span>
      </div>
      <button type="button" class="btn small primary">Enable</button>
    `;
    const btn = permissionBanner.querySelector('button');
    btn?.addEventListener('click', () => {
      requestPermission();
    });
    document.body.appendChild(permissionBanner);
  };

  ensurePermissionPrompt();

  const sendNotification = (label, count) => {
    if (count <= 0) return;
    const plural = count > 1 ? 's' : '';
    const message = count > 1 ? `${count} new ${label}${plural}` : `New ${label}`;
    toast(message);
    if (NotificationAPI && NotificationAPI.permission === 'granted') {
      try {
        new NotificationAPI('Payments queue update', { body: message, tag: `queue-${label}` });
      } catch {}
    }
    playChime();
    scheduleReload();
  };

  const poll = async () => {
    const qs = new URLSearchParams({ since: String(lastStamp) });
    try {
      const res = await fetch(`/admin/notifications/queue?${qs.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.ok) return;
      const latest = typeof data.latest === 'string' ? Date.parse(data.latest) : NaN;
      if (!Number.isNaN(latest) && latest >= lastStamp) {
        lastStamp = latest + 1;
      } else {
        lastStamp = Date.now();
      }
      ensurePermissionPrompt();
      sendNotification('deposit request', Number(data.deposits || 0));
      sendNotification('withdrawal request', Number(data.withdrawals || 0));
    } catch {}
  };

  const loop = () => {
    poll().finally(() => {
      window.setTimeout(loop, 5000);
    });
  };

  window.setTimeout(loop, 5000);
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
