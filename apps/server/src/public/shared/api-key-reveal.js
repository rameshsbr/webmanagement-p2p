(function () {
  const modal = document.querySelector('[data-api-key-reveal-modal]');
  if (!modal) return;

  const triggers = Array.from(document.querySelectorAll('[data-api-key-reveal-trigger]'));
  if (!triggers.length) return;

  const scope = modal.getAttribute('data-scope') || 'merchant';
  const requireTotp = modal.getAttribute('data-require-totp') === '1';
  const requirePassword = modal.getAttribute('data-require-password') === '1';
  const stepStorage = modal.getAttribute('data-step-storage') || `${scope}.keyReveal.step`;
  const autoHideSeconds = Math.max(5, parseInt(modal.getAttribute('data-auto-hide') || '60', 10) || 60);

  const stepView = modal.querySelector('[data-reveal-view="step"]');
  const resultView = modal.querySelector('[data-reveal-view="result"]');
  const passwordField = modal.querySelector('[data-reveal-password-field]');
  const totpField = modal.querySelector('[data-reveal-totp-field]');
  const passwordInput = modal.querySelector('[data-reveal-password]');
  const totpInput = modal.querySelector('[data-reveal-totp]');
  const errorBox = modal.querySelector('[data-reveal-error]');
  const submitBtn = modal.querySelector('[data-reveal-submit]');
  const cancelBtn = modal.querySelector('[data-reveal-cancel]');
  const closeBtn = modal.querySelector('[data-reveal-close]');
  const doneBtn = modal.querySelector('[data-reveal-done]');
  const secretCode = modal.querySelector('[data-secret-value]');
  const toggleBtn = modal.querySelector('[data-secret-toggle]');
  const copyBtn = modal.querySelector('[data-secret-copy]');
  const countdownEl = modal.querySelector('[data-reveal-countdown]');
  const lastEl = modal.querySelector('[data-reveal-last]');
  const keyLabel = modal.querySelector('[data-reveal-key]');
  const reasonField = modal.querySelector('[data-reveal-reason]');
  const reasonWrap = modal.querySelector('[data-reveal-reason-field]');

  if (!stepView || !resultView || !submitBtn || !cancelBtn || !closeBtn || !doneBtn || !secretCode || !toggleBtn || !copyBtn) {
    return;
  }

  let activeTrigger = null;
  let storedSecret = '';
  let secretVisible = false;
  let countdownTimer = null;
  let hideTimer = null;
  let stepToken = '';

  try {
    stepToken = sessionStorage.getItem(stepStorage) || '';
  } catch { stepToken = ''; }

  function maskSecret(secret) {
    if (!secret) return '••••••';
    if (secret.length <= 6) return '••••••';
    return secret.slice(0, 4) + '••••••••••' + secret.slice(-4);
  }

  function updateSecretDisplay() {
    if (!secretCode) return;
    secretCode.textContent = secretVisible ? storedSecret : maskSecret(storedSecret);
    if (toggleBtn) toggleBtn.textContent = secretVisible ? 'Hide' : 'Show';
  }

  function clearTimers() {
    if (countdownTimer) {
      clearInterval(countdownTimer);
      countdownTimer = null;
    }
    if (hideTimer) {
      clearTimeout(hideTimer);
      hideTimer = null;
    }
  }

  function closeModal() {
    modal.setAttribute('hidden', '');
    modal.classList.remove('open');
    document.body.classList.remove('modal-open');
    clearTimers();
    storedSecret = '';
    secretVisible = false;
    updateSecretDisplay();
    if (passwordInput) passwordInput.value = '';
    if (totpInput) totpInput.value = '';
    if (reasonField) reasonField.value = '';
    if (errorBox) errorBox.textContent = '';
    if (countdownEl) countdownEl.textContent = '';
    if (lastEl) lastEl.textContent = '';
    if (keyLabel) keyLabel.textContent = '';
    showStepView();
  }

  function showStepView() {
    stepView.hidden = false;
    resultView.hidden = true;
    if (errorBox) errorBox.textContent = '';
    if (requireTotp && totpField) totpField.hidden = false;
    if (requirePassword && passwordField) passwordField.hidden = false;
    setTimeout(() => {
      if (requireTotp && totpInput) totpInput.focus();
      else if (passwordInput) passwordInput.focus();
    }, 10);
  }

  function showResultView(opts) {
    stepView.hidden = true;
    resultView.hidden = false;
    storedSecret = opts.secret;
    secretVisible = false;
    updateSecretDisplay();
    if (keyLabel) keyLabel.textContent = opts.label || '';
    if (countdownEl) countdownEl.textContent = '';
    if (lastEl) lastEl.textContent = opts.previous ? `Previous reveal: ${opts.previous}` : '';
    clearTimers();
    let remaining = autoHideSeconds;
    if (countdownEl) countdownEl.textContent = `Auto-hide in ${remaining}s`;
    countdownTimer = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearTimers();
        closeModal();
        return;
      }
      if (countdownEl) countdownEl.textContent = `Auto-hide in ${remaining}s`;
    }, 1000);
    hideTimer = setTimeout(() => {
      closeModal();
    }, autoHideSeconds * 1000);
  }

  function openModal(trigger) {
    activeTrigger = trigger;
    modal.classList.add('open');
    modal.removeAttribute('hidden');
    document.body.classList.add('modal-open');
    showStepView();
  }

  function toast(message, variant) {
    if (typeof window.toast === 'function') {
      window.toast(message, variant ? { variant } : undefined);
    } else if (message) {
      console.log('[toast]', message);
    }
  }

  async function submitReveal() {
    if (!activeTrigger) return;

    const allow = activeTrigger.getAttribute('data-allow') === '1';
    if (!allow) {
      toast(activeTrigger.getAttribute('title') || 'Reveal unavailable', 'error');
      return;
    }

    const endpoint = activeTrigger.getAttribute('data-endpoint') || '';
    if (!endpoint) return;

    const payload = {};
    if (stepToken) payload.stepToken = stepToken;

    if (!payload.stepToken) {
      const pass = passwordInput ? passwordInput.value.trim() : '';
      const totp = totpInput ? totpInput.value.trim() : '';
      const reason = reasonField ? reasonField.value.trim() : '';

      if (requirePassword && !pass) {
        if (errorBox) errorBox.textContent = 'Password is required.';
        if (passwordInput) passwordInput.focus();
        return;
      }
      if (requireTotp && !totp) {
        if (errorBox) errorBox.textContent = 'Authenticator code is required.';
        if (totpInput) totpInput.focus();
        return;
      }
      if (passwordInput && pass) payload.password = pass;
      if (totpInput && totp) payload.totp = totp;
      if (reasonField && reasonWrap && !reasonWrap.hasAttribute('hidden')) {
        if (!reason) {
          if (errorBox) errorBox.textContent = 'Reason is required.';
          reasonField.focus();
          return;
        }
        payload.reason = reason;
      }
    }

    if (errorBox) errorBox.textContent = '';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Verifying…';

    try {
      const resp = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await resp.json().catch(() => ({}));

      if (!resp.ok || !data || data.ok === false) {
        if (data) {
          if (data.needsStepUp) {
            try { sessionStorage.removeItem(stepStorage); } catch {}
            stepToken = '';
          }
          if (data.error === 'disabled') {
            try { sessionStorage.removeItem(stepStorage); } catch {}
            stepToken = '';
          }
        }
        const message = data && data.message ? data.message : 'Unable to reveal API key.';
        if (errorBox) errorBox.textContent = message;
        if (data && data.error === 'rate_limited' && data.retryAt) {
          toast(`Too many reveals. Try again after ${data.retryAt}.`, 'error');
        }
        return;
      }

      const { secret, stepToken: nextStep, previousSuccessAt, prefix } = data;
      if (nextStep) {
        stepToken = nextStep;
        try { sessionStorage.setItem(stepStorage, nextStep); } catch {}
      }
      if (passwordInput) passwordInput.value = '';
      if (totpInput) totpInput.value = '';
      if (reasonField) reasonField.value = '';
      const basePrefix = prefix || (activeTrigger.getAttribute('data-key-prefix') || '');
      const last4 = activeTrigger.getAttribute('data-key-last4') || '';
      const label = last4 ? `${basePrefix}.****${last4}` : basePrefix;
      const prev = previousSuccessAt
        ? new Date(previousSuccessAt).toLocaleString()
        : (activeTrigger.getAttribute('data-last-revealed')
          ? new Date(activeTrigger.getAttribute('data-last-revealed')).toLocaleString()
          : '');
      showResultView({ secret, label, previous: prev });
      const nowIso = new Date().toISOString();
      activeTrigger.setAttribute('data-last-revealed', nowIso);
    } catch (err) {
      console.error('[api-key-reveal] request failed', err);
      if (errorBox) errorBox.textContent = 'Network error. Please try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Continue';
    }
  }

  triggers.forEach((trigger) => {
    trigger.addEventListener('click', (event) => {
      event.preventDefault();
      const allow = trigger.getAttribute('data-allow') === '1';
      if (!allow) {
        toast(trigger.getAttribute('title') || 'Reveal unavailable', 'error');
        return;
      }
      openModal(trigger);
    });
  });

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  }

  submitBtn.addEventListener('click', submitReveal);
  cancelBtn.addEventListener('click', closeModal);
  closeBtn.addEventListener('click', closeModal);
  doneBtn.addEventListener('click', closeModal);
  modal.addEventListener('keydown', onKeydown);

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      if (!storedSecret) return;
      secretVisible = !secretVisible;
      updateSecretDisplay();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!storedSecret) return;
      try {
        await navigator.clipboard.writeText(storedSecret);
        toast('API key copied to clipboard.');
      } catch (err) {
        console.warn('[api-key-reveal] clipboard failed', err);
        toast('Failed to copy. Select and copy manually.', 'error');
      }
    });
  }
})();
