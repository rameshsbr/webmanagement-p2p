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
    const storageKey = control.getAttribute('data-export-storage') || 'admin.export.default';

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
  const select = document.getElementById('pref-tz');
  if (!select || typeof window.timezone?.populate !== 'function') return;
  window.timezone.populate(select);
})();

const purgeModals = () => {
  document.querySelectorAll('.modal-backdrop').forEach((el) => el.remove());
};
purgeModals();
window.addEventListener('pageshow', purgeModals);

async function postJson(url, payload) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload || {}),
  });
  let data = null;
  try { data = await res.json(); } catch {}
  if (!res.ok || !data?.ok) {
    throw new Error((data && data.error) || 'Request failed');
  }
  return data;
}

function openActionModal({ title, submitLabel, contentBuilder, onSubmit }) {
  purgeModals();
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

  const body = overlay.querySelector('.modal-body');
  const submitBtn = overlay.querySelector('[data-submit]');
  const cancelBtn = overlay.querySelector('[data-cancel]');
  if (!body || !submitBtn || !cancelBtn) return;

  const ctx = contentBuilder(body) || {};

  const close = () => {
    overlay.classList.remove('is-visible');
    setTimeout(() => overlay.remove(), 180);
  };

  cancelBtn.addEventListener('click', () => close());
  overlay.addEventListener('click', (ev) => {
    if (ev.target === overlay) close();
  });

  submitBtn.addEventListener('click', async () => {
    submitBtn.disabled = true;
    submitBtn.textContent = 'Working…';
    try {
      await onSubmit({ ...ctx, close, overlay });
      close();
    } catch (err) {
      submitBtn.disabled = false;
      submitBtn.textContent = submitLabel;
      const msg = (err && err.message) || 'Request failed';
      let errBox = overlay.querySelector('.modal-error');
      if (!errBox) {
        errBox = document.createElement('div');
        errBox.className = 'modal-error';
        overlay.querySelector('.modal-card')?.appendChild(errBox);
      }
      errBox.textContent = msg;
    }
  });

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('is-visible'));
}

// Pending deposit actions (approve/reject with confirmation dialogs)
(() => {
  const table = document.querySelector('[data-pending-actions]');
  if (!table) return;

  const openApprove = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const currency = btn.getAttribute('data-currency') || '';
    const originalCents = Number(btn.getAttribute('data-amount') || '0');
    const originalAmount = originalCents / 100;
    const originalDisplay = originalCents % 100 === 0 ? originalAmount.toFixed(0) : originalAmount.toFixed(2);

    openActionModal({
      title: 'Confirm approval',
      submitLabel: 'Approve',
      contentBuilder: (body) => {
        body.classList.add('modal-fields');
        body.innerHTML = `
          <p>Approve deposit <strong>${reference}</strong> (${currency} ${originalDisplay})?</p>
          <label class="modal-field">
            <span>Amount (${currency})</span>
            <input type="number" step="0.01" min="0.01" value="${originalDisplay}" data-amount-input />
          </label>
          <label class="modal-field">
            <span>Comment <small>(required if amount changes)</small></span>
            <textarea rows="3" data-comment-input placeholder="Optional comment"></textarea>
          </label>`;
        return {
          amountInput: body.querySelector('[data-amount-input]'),
          commentInput: body.querySelector('[data-comment-input]'),
        };
      },
      onSubmit: async ({ amountInput, commentInput, close }) => {
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
        if (roundedCents !== originalRounded && !comment) {
          throw new Error('Comment is required when changing the amount');
        }

        await postJson(`/admin/deposits/${encodeURIComponent(id)}/approve`, {
          amount: Number(nextAmount.toFixed(2)),
          comment,
        });
        close();
        toast('Deposit approved');
        window.location.reload();
      },
    });
  };

  const openReject = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const currency = btn.getAttribute('data-currency') || '';
    const amountCents = Number(btn.getAttribute('data-amount') || '0');
    const amountDisplay = amountCents % 100 === 0 ? (amountCents / 100).toFixed(0) : (amountCents / 100).toFixed(2);

    openActionModal({
      title: 'Reject deposit',
      submitLabel: 'Reject',
      contentBuilder: (body) => {
        body.classList.add('modal-fields');
        body.innerHTML = `
          <p>Reject deposit <strong>${reference}</strong> (${currency} ${amountDisplay})?</p>
          <label class="modal-field">
            <span>Comment <small>(required)</small></span>
            <textarea rows="3" data-comment-input placeholder="Reason for rejection"></textarea>
          </label>`;
        return {
          commentInput: body.querySelector('[data-comment-input]'),
        };
      },
      onSubmit: async ({ commentInput, close }) => {
        const comment = (commentInput?.value || '').trim();
        if (!comment) {
          throw new Error('Comment is required');
        }

        await postJson(`/admin/deposits/${encodeURIComponent(id)}/reject`, { comment });
        close();
        toast('Deposit rejected');
        window.location.reload();
      },
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

  let bankOptions = [];
  const banksScript = document.getElementById('withdraw-bank-options');
  if (banksScript) {
    try {
      bankOptions = JSON.parse(banksScript.textContent || '[]') || [];
    } catch {
      bankOptions = [];
    }
  }

  const tableWrap = table.closest('[data-auto-refresh="pending-withdrawals"]');
  const returnTo = tableWrap?.getAttribute('data-return-to') || '';

  const getBankOptions = (methodRaw) => {
    const method = (methodRaw || '').toUpperCase();
    if (!Array.isArray(bankOptions)) return { list: [], matched: false };
    const matched = bankOptions.filter((bank) => !method || bank.method === method);
    if (matched.length) return { list: matched, matched: true };
    return { list: bankOptions, matched: false };
  };

  const buildBankSelect = (select, banks, preselect) => {
    if (!select) return;
    select.innerHTML = '';
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = banks.length ? 'Select bank' : 'No banks available';
    placeholder.disabled = true;
    placeholder.selected = true;
    placeholder.hidden = true;
    select.appendChild(placeholder);

    banks.forEach((bank) => {
      if (!bank || !bank.id) return;
      const opt = document.createElement('option');
      opt.value = bank.id;
      const method = bank.method ? ` (${bank.method})` : '';
      opt.textContent = `${bank.label || 'Unnamed bank'}${method}`;
      if (preselect && preselect === bank.id) opt.selected = true;
      select.appendChild(opt);
    });
  };

  const openApprove = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const amountDisplay = btn.getAttribute('data-amount-display') || '';
    const method = btn.getAttribute('data-method') || '';
    const existingBankId = btn.getAttribute('data-bank-id') || '';

    const { list: banks, matched } = getBankOptions(method);

    openActionModal({
      title: 'Approve withdrawal',
      submitLabel: 'Approve',
      contentBuilder: (body) => {
        body.classList.add('modal-fields');
        body.innerHTML = `
          <p>Approve withdrawal <strong>${reference}</strong> (${amountDisplay})?</p>
          <label class="modal-field">
            <span>Bank name <small>(required)</small></span>
            <select data-bank-select></select>
          </label>
          <p class="modal-note" data-bank-note></p>`;
        const bankSelect = body.querySelector('[data-bank-select]');
        const note = body.querySelector('[data-bank-note]');
        buildBankSelect(bankSelect, banks, existingBankId);

        if (note) {
          if (!banks.length) {
            note.textContent = 'No active bank accounts available. Add one in Bank Transfer → Banks before approving.';
          } else if (!matched && method) {
            note.textContent = `No banks configured for ${method}. Showing all active banks.`;
          } else {
            note.textContent = '';
          }
        }

        return { bankSelect };
      },
      onSubmit: async ({ bankSelect, close }) => {
        const bankAccountId = (bankSelect?.value || '').trim();
        if (!bankAccountId) {
          throw new Error('Select a bank before approving');
        }
        const payload = { bankAccountId };
        if (returnTo) payload.returnTo = returnTo;
        await postJson(`/admin/withdrawals/${encodeURIComponent(id)}/approve`, payload);
        close();
        toast('Withdrawal approved');
        window.location.reload();
      },
    });
  };

  const openReject = (btn) => {
    const id = btn.getAttribute('data-id');
    const reference = btn.getAttribute('data-reference') || '';
    const amountDisplay = btn.getAttribute('data-amount-display') || '';

    openActionModal({
      title: 'Reject withdrawal',
      submitLabel: 'Reject',
      contentBuilder: (body) => {
        body.classList.add('modal-fields');
        body.innerHTML = `
          <p>Reject withdrawal <strong>${reference}</strong> (${amountDisplay})?</p>
          <label class="modal-field">
            <span>Comment <small>(required)</small></span>
            <textarea rows="3" data-comment-input placeholder="Reason for rejection"></textarea>
          </label>`;
        return {
          commentInput: body.querySelector('[data-comment-input]'),
        };
      },
      onSubmit: async ({ commentInput, close }) => {
        const comment = (commentInput?.value || '').trim();
        if (!comment) {
          throw new Error('Comment is required');
        }
        const payload = { comment };
        if (returnTo) payload.returnTo = returnTo;
        await postJson(`/admin/withdrawals/${encodeURIComponent(id)}/reject`, payload);
        close();
        toast('Withdrawal rejected');
        window.location.reload();
      },
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

// Processed payment status changes (admin tables)
(() => {
  const formatDisplayAmount = (cents) => {
    const num = Number(cents || 0);
    if (!Number.isFinite(num)) return '0';
    return num % 100 === 0 ? (num / 100).toFixed(0) : (num / 100).toFixed(2);
  };

  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-change-status]');
    if (!trigger) return;
    event.preventDefault();

    const id = trigger.getAttribute('data-id');
    const type = trigger.getAttribute('data-type') || 'DEPOSIT';
    const currentStatus = trigger.getAttribute('data-status') || '';
    const reference = trigger.getAttribute('data-reference') || '';
    const amountCents = Number(trigger.getAttribute('data-amount') || '0');
    const currency = trigger.getAttribute('data-currency') || '';
    const amountDisplay = formatDisplayAmount(amountCents);

    const isDeposit = type === 'DEPOSIT';

    openActionModal({
      title: 'Change status',
      submitLabel: 'Update',
      contentBuilder: (body) => {
        body.classList.add('modal-fields');
        body.innerHTML = `
          <p>Update <strong>${reference}</strong> (${currency} ${amountDisplay})?</p>
          <label class="modal-field">
            <span>Next status</span>
            <select data-status-select>
              <option value="APPROVED">Approve</option>
              <option value="REJECTED">Reject</option>
            </select>
          </label>
          <div class="modal-field" data-amount-wrapper>
            <span>Approved amount (${currency})</span>
            <input type="number" step="0.01" min="0.01" value="${amountDisplay}" data-amount-input />
          </div>
          <label class="modal-field">
            <span>Comment <small>(required for rejection)</small></span>
            <textarea rows="3" data-comment-input placeholder="Optional comment"></textarea>
          </label>`;
        const statusSelect = body.querySelector('[data-status-select]');
        const amountWrapper = body.querySelector('[data-amount-wrapper]');
        const amountInput = body.querySelector('[data-amount-input]');
        const commentInput = body.querySelector('[data-comment-input]');

        statusSelect.value = currentStatus === 'REJECTED' ? 'REJECTED' : 'APPROVED';

        const updateVisibility = () => {
          const showAmount = statusSelect.value === 'APPROVED' && isDeposit;
          amountWrapper.style.display = showAmount ? '' : 'none';
        };
        updateVisibility();
        statusSelect.addEventListener('change', updateVisibility);

        return { statusSelect, amountInput, commentInput, amountWrapper };
      },
      onSubmit: async ({ statusSelect, amountInput, commentInput, close }) => {
        const targetStatus = statusSelect?.value === 'REJECTED' ? 'REJECTED' : 'APPROVED';
        const comment = (commentInput?.value || '').trim();
        const payload = { targetStatus };

        if (targetStatus === 'REJECTED' && !comment) {
          throw new Error('Comment is required');
        }

        if (targetStatus === 'APPROVED' && isDeposit) {
          const raw = (amountInput?.value || '').trim();
          if (!raw) throw new Error('Amount is required');
          const nextAmount = Number(raw);
          if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
            throw new Error('Enter a valid amount');
          }
          payload.amount = Number(nextAmount.toFixed(2));
          const originalAmount = amountCents / 100;
          if (Math.round(nextAmount * 100) !== Math.round(originalAmount * 100) && !comment) {
            throw new Error('Comment is required when changing the amount');
          }
        }

        if (comment) payload.comment = comment;

        const endpoint = type === 'WITHDRAWAL'
          ? `/admin/withdrawals/${encodeURIComponent(id)}/status`
          : `/admin/deposits/${encodeURIComponent(id)}/status`;

        await postJson(endpoint, payload);
        close();
        toast('Status updated');
        window.location.reload();
      },
    });
  });
})();
// Browser notifications for new queue items
(() => {
  if (typeof window.fetch !== 'function') return;
  const shell = document.querySelector('.shell');
  if (!shell) return;

  const NotificationAPI = 'Notification' in window ? window.Notification : null;
  const hostName = (window.location.hostname || '').toLowerCase();
  const isLocalHost = hostName === 'localhost' || hostName === '127.0.0.1' || hostName === '::1';
  let lastDepositStamp = Date.now();
  let lastWithdrawalStamp = Date.now();
  let audioCtx = null;
  let autoReloadScheduled = false;
  let permissionBanner = null;
  let swRegistrationPromise = null;
  let notificationWarningShown = false;

  const notifyBlocked = (message) => {
    if (notificationWarningShown) return;
    notificationWarningShown = true;
    toast(message || 'Enable browser notifications in your site settings to receive alerts.');
  };

  const notificationStatus = () => {
    if (!NotificationAPI) return 'unsupported';
    if (!window.isSecureContext && !isLocalHost) return 'insecure';
    return NotificationAPI.permission || 'default';
  };

  const normalizeUrl = (value) => {
    if (!value) return '';
    try {
      return new URL(value, window.location.href).toString();
    } catch {
      return String(value);
    }
  };

  const focusUrl = (value) => {
    const target = normalizeUrl(value);
    if (!target) return;
    const popup = window.open(target, '_blank', 'noopener');
    if (popup && typeof popup.focus === 'function') {
      popup.focus();
      return;
    }
    try {
      window.location.assign(target);
    } catch {
      window.location.href = target;
    }
  };

  const ensureServiceWorker = () => {
    if (!('serviceWorker' in navigator)) return null;
    if (!swRegistrationPromise) {
      swRegistrationPromise = (async () => {
        try {
          const legacy = await navigator.serviceWorker.getRegistration('/static/admin/');
          if (legacy) await legacy.unregister().catch(() => {});
        } catch {}
        try {
          const existing = await navigator.serviceWorker.getRegistration('/admin/');
          if (!existing) {
            await navigator.serviceWorker.register('/admin/queue-sw.js', { scope: '/admin/' });
          }
        } catch (err) {
          console.warn('[admin] failed to register queue service worker', err);
          return null;
        }
        try {
          const ready = await navigator.serviceWorker.ready;
          if (ready && ready.scope && !ready.scope.endsWith('/admin/')) {
            // Scope mismatch, fall back to explicit lookup.
            const registration = await navigator.serviceWorker.getRegistration('/admin/');
            return registration || ready;
          }
          return ready;
        } catch (err) {
          console.warn('[admin] queue service worker not ready', err);
          return navigator.serviceWorker.getRegistration('/admin/').catch(() => null);
        }
      })().catch((err) => {
        console.warn('[admin] queue service worker setup failed', err);
        return null;
      });
    }
    return swRegistrationPromise;
  };

  ensureServiceWorker();

  const findAutoRefreshContext = (queueType) => {
    if (queueType === 'withdrawal') {
      return document.querySelector('[data-auto-refresh="pending-withdrawals"]');
    }
    if (queueType === 'deposit') {
      return document.querySelector('[data-auto-refresh="pending-deposits"]');
    }
    return (
      document.querySelector('[data-auto-refresh="pending-deposits"]') ||
      document.querySelector('[data-auto-refresh="pending-withdrawals"]')
    );
  };

  const scheduleReload = (queueType) => {
    if (autoReloadScheduled) return;
    const ctx = findAutoRefreshContext(queueType);
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
    const status = notificationStatus();
    if (status === 'unsupported') {
      if (!notificationWarningShown) {
        notifyBlocked('Browser notifications are not supported in this browser.');
      }
    }
    if (status === 'insecure') {
      notifyBlocked('Open the admin portal over HTTPS to enable browser notifications.');
    }
    if (!NotificationAPI || status !== 'default') {
      if (permissionBanner) {
        permissionBanner.remove();
        permissionBanner = null;
      }
      if (status === 'denied') {
        notifyBlocked('Browser notifications are blocked. Enable them in your browser site settings.');
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

  const showBrowserNotification = async (title, message, tag, url) => {
    if (!NotificationAPI) return false;
    if (!window.isSecureContext && !isLocalHost) return false;
    if (NotificationAPI.permission === 'default') {
      requestPermission();
      return false;
    }
    if (NotificationAPI.permission !== 'granted') return false;
    const targetUrl = normalizeUrl(url);
    const payload = { title, message, tag, url: targetUrl };
    try {
      const registration = await ensureServiceWorker();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, { body: message, tag, data: { url: targetUrl } });
        return true;
      }
      if (registration?.active && typeof registration.active.postMessage === 'function') {
        registration.active.postMessage({ type: 'show-notification', payload });
        return true;
      }
    } catch {}
    try {
      const note = new Notification(title, { body: message, tag, data: { url: targetUrl } });
      if (targetUrl) {
        note.addEventListener('click', () => {
          try { note.close(); } catch {}
          focusUrl(targetUrl);
        });
      }
      return true;
    } catch {}
    return false;
  };

  const sendNotification = async (queueType, count) => {
    if (count <= 0) return;
    const isWithdrawal = queueType === 'withdrawal';
    const label = isWithdrawal ? 'withdrawal request' : 'deposit request';
    const plural = count > 1 ? 's' : '';
    const message = count > 1 ? `${count} new ${label}${plural}` : `New ${label}`;
    toast(message);
    const targetUrl = isWithdrawal
      ? '/admin/report/withdrawals/pending'
      : '/admin/report/deposits/pending';
    const ok = await showBrowserNotification('Payments queue update', message, `queue-${queueType}`, targetUrl).catch(() => false);
    if (!ok) {
      const status = notificationStatus();
      if (status === 'default') {
        notifyBlocked('Click "Enable" on the notification prompt to receive browser alerts.');
      } else if (status === 'denied') {
        notifyBlocked('Browser notifications are blocked. Enable them in your browser site settings.');
      }
    }
    playChime();
    scheduleReload(queueType);
  };

  const poll = async () => {
    const qs = new URLSearchParams();
    if (Number.isFinite(lastDepositStamp) && lastDepositStamp > 0) {
      qs.set('sinceDeposits', String(Math.floor(lastDepositStamp)));
    }
    if (Number.isFinite(lastWithdrawalStamp) && lastWithdrawalStamp > 0) {
      qs.set('sinceWithdrawals', String(Math.floor(lastWithdrawalStamp)));
    }
    const baseStamp = Math.min(lastDepositStamp || Date.now(), lastWithdrawalStamp || Date.now());
    if (Number.isFinite(baseStamp) && baseStamp > 0) {
      qs.set('since', String(Math.floor(baseStamp)));
    }
    try {
      const res = await fetch(`/admin/notifications/queue?${qs.toString()}`, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return;
      const data = await res.json();
      if (!data?.ok) return;
      const parseStamp = (value) => {
        if (!value) return NaN;
        if (value instanceof Date) return value.getTime();
        if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
        if (typeof value === 'string') {
          const num = Number(value);
          if (Number.isFinite(num)) return num;
          const parsed = Date.parse(value);
          if (!Number.isNaN(parsed)) return parsed;
        }
        return NaN;
      };

      const updateStamp = (current, nextRaw) => {
        const next = parseStamp(nextRaw);
        if (!Number.isFinite(next)) return current;
        if (!Number.isFinite(current) || next >= current) return next + 1;
        return current;
      };

      if (Object.prototype.hasOwnProperty.call(data, 'latestDeposit')) {
        lastDepositStamp = updateStamp(lastDepositStamp, data.latestDeposit);
      }
      if (Object.prototype.hasOwnProperty.call(data, 'latestWithdrawal')) {
        lastWithdrawalStamp = updateStamp(lastWithdrawalStamp, data.latestWithdrawal);
      }
      if (!Object.prototype.hasOwnProperty.call(data, 'latestDeposit')) {
        lastDepositStamp = updateStamp(lastDepositStamp, data.latest);
      }
      if (!Object.prototype.hasOwnProperty.call(data, 'latestWithdrawal')) {
        lastWithdrawalStamp = updateStamp(lastWithdrawalStamp, data.latest);
      }
      ensurePermissionPrompt();
      await Promise.all([
        sendNotification('deposit', Number(data.deposits || 0)),
        sendNotification('withdrawal', Number(data.withdrawals || 0)),
      ]);
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

  const el = (id) => document.getElementById(id);
  const ensureTimezoneOption = (value) => {
    const select = el('pref-tz');
    if (!select || !value) return value;
    const options = Array.from(select.options || []);
    return options.some((opt) => opt.value === value) ? value : '';
  };
  const fields = {
    email: () => el('pref-email')?.value || '',
    currency: () => el('pref-currency')?.value || '',
    tz: () => el('pref-tz')?.value || '',
    theme: () => (el('pref-dark')?.checked ? 'dark' : 'light')
  };
  const apply = (p) => {
    if (el('pref-email')) el('pref-email').value = p.email || '';
    if (el('pref-currency')) el('pref-currency').value = p.currency || '';
    const tzSelect = el('pref-tz');
    if (tzSelect) {
      const currentTz = typeof window.timezone?.get === 'function' ? window.timezone.get() : '';
      const desired = ensureTimezoneOption(p.tz) || currentTz;
      if (desired) tzSelect.value = desired;
    }
    if (el('pref-dark')) {
      el('pref-dark').checked = (p.theme || 'light') === 'dark';
      document.documentElement.setAttribute('data-theme', el('pref-dark').checked ? 'dark' : 'light');
    }
  };

  const init = read();
  if (!init.theme) init.theme = (document.documentElement.getAttribute('data-theme') || 'light');
  if (!init.tz && typeof window.timezone?.get === 'function') init.tz = window.timezone.get();
  apply(init);

  const saveBtn = el('prefs-save');
  const cancelBtn = el('prefs-cancel');
  const showError = (message) => {
    if (!message) return;
    if (typeof toast?.error === 'function') toast.error(message);
    else toast(message);
  };

  saveBtn?.addEventListener('click', async (e) => {
    e.preventDefault();
    const next = Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, f()]));
    try {
      const response = await postJson('/admin/prefs/timezone', { timezone: next.tz });
      const resolved = response?.timezone || next.tz;
      if (typeof window.timezone?.set === 'function') {
        window.timezone.set(resolved);
      }
      next.tz = resolved;
      write(next);
      toast('Preference saved.');
    } catch (err) {
      console.error(err);
      showError('Failed to save preferences.');
    }
  });

  cancelBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    const current = read();
    if (typeof window.timezone?.get === 'function') {
      current.tz = window.timezone.get();
    }
    apply(current);
    toast('Changes discarded.');
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
