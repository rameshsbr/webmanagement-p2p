(function () {
  const controllers = new WeakMap();
  const BOUND_ATTR = "data-reveal-bound";

  function toast(message, variant) {
    if (typeof window.toast === 'function') {
      window.toast(message, variant ? { variant } : undefined);
    } else if (message) {
      console.log('[toast]', message);
    }
  }

  function getModal(scope) {
    if (scope) {
      const scoped = document.querySelector(`[data-api-key-reveal-modal][data-scope="${scope}"]`);
      if (scoped) return scoped;
    }
    return document.querySelector('[data-api-key-reveal-modal]');
  }

  class KeyRevealController {
    constructor(modal) {
      this.modal = modal;
      this.scope = modal.getAttribute('data-scope') || 'merchant';
      this.requireTotp = modal.getAttribute('data-require-totp') === '1';
      this.requirePassword = modal.getAttribute('data-require-password') === '1';
      this.stepStorage = modal.getAttribute('data-step-storage') || `${this.scope}.keyReveal.step`;
      this.autoHideSeconds = Math.max(5, parseInt(modal.getAttribute('data-auto-hide') || '60', 10) || 60);
      this.stepView = modal.querySelector('[data-reveal-view="step"]');
      this.resultView = modal.querySelector('[data-reveal-view="result"]');
      this.passwordField = modal.querySelector('[data-reveal-password-field]');
      this.totpField = modal.querySelector('[data-reveal-totp-field]');
      this.passwordInput = modal.querySelector('[data-reveal-password]');
      this.totpInput = modal.querySelector('[data-reveal-totp]');
      this.errorBox = modal.querySelector('[data-reveal-error]');
      this.submitBtn = modal.querySelector('[data-reveal-submit]');
      this.cancelBtn = modal.querySelector('[data-reveal-cancel]');
      this.closeBtn = modal.querySelector('[data-reveal-close]');
      this.doneBtn = modal.querySelector('[data-reveal-done]');
      this.secretCode = modal.querySelector('[data-secret-value]');
      this.toggleBtn = modal.querySelector('[data-secret-toggle]');
      this.copyBtn = modal.querySelector('[data-secret-copy]');
      this.countdownEl = modal.querySelector('[data-reveal-countdown]');
      this.lastEl = modal.querySelector('[data-reveal-last]');
      this.keyLabel = modal.querySelector('[data-reveal-key]');
      this.reasonField = modal.querySelector('[data-reveal-reason]');
      this.reasonWrap = modal.querySelector('[data-reveal-reason-field]');

      if (
        !this.stepView ||
        !this.resultView ||
        !this.submitBtn ||
        !this.cancelBtn ||
        !this.closeBtn ||
        !this.doneBtn ||
        !this.secretCode ||
        !this.toggleBtn ||
        !this.copyBtn
      ) {
        this.ready = false;
        return;
      }

      this.ready = true;
      this.activeTrigger = null;
      this.storedSecret = '';
      this.secretVisible = false;
      this.countdownTimer = null;
      this.hideTimer = null;
      this.stepToken = '';
      try {
        this.stepToken = sessionStorage.getItem(this.stepStorage) || '';
      } catch {
        this.stepToken = '';
      }

      this.onSubmit = this.submitReveal.bind(this);
      this.onClose = this.closeModal.bind(this);
      this.onKeydown = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          this.closeModal();
        }
      };

      this.submitBtn.addEventListener('click', this.onSubmit);
      this.cancelBtn.addEventListener('click', this.onClose);
      this.closeBtn.addEventListener('click', this.onClose);
      this.doneBtn.addEventListener('click', this.onClose);
      this.modal.addEventListener('keydown', this.onKeydown);

      this.toggleBtn.addEventListener('click', () => {
        if (!this.storedSecret) return;
        this.secretVisible = !this.secretVisible;
        this.updateSecretDisplay();
      });

      this.copyBtn.addEventListener('click', async () => {
        if (!this.storedSecret) return;
        try {
          await navigator.clipboard.writeText(this.storedSecret);
          toast('API key copied to clipboard.');
        } catch (err) {
          console.warn('[api-key-reveal] clipboard failed', err);
          toast('Failed to copy. Select and copy manually.', 'error');
        }
      });
    }

    refreshRequirements() {
      this.requireTotp = this.modal.getAttribute('data-require-totp') === '1';
      this.requirePassword = this.modal.getAttribute('data-require-password') === '1';
    }

    maskSecret(secret) {
      if (!secret) return '••••••';
      if (secret.length <= 6) return '••••••';
      return secret.slice(0, 4) + '••••••••••' + secret.slice(-4);
    }

    updateSecretDisplay() {
      this.secretCode.textContent = this.secretVisible ? this.storedSecret : this.maskSecret(this.storedSecret);
      if (this.toggleBtn) this.toggleBtn.textContent = this.secretVisible ? 'Hide' : 'Show';
    }

    clearTimers() {
      if (this.countdownTimer) {
        clearInterval(this.countdownTimer);
        this.countdownTimer = null;
      }
      if (this.hideTimer) {
        clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
    }

    closeModal() {
      this.modal.setAttribute('hidden', '');
      this.modal.classList.remove('open');
      document.body.classList.remove('modal-open');
      this.clearTimers();
      this.storedSecret = '';
      this.secretVisible = false;
      this.updateSecretDisplay();
      if (this.passwordInput) this.passwordInput.value = '';
      if (this.totpInput) this.totpInput.value = '';
      if (this.reasonField) this.reasonField.value = '';
      if (this.errorBox) this.errorBox.textContent = '';
      if (this.countdownEl) this.countdownEl.textContent = '';
      if (this.lastEl) this.lastEl.textContent = '';
      if (this.keyLabel) this.keyLabel.textContent = '';
      this.activeTrigger = null;
      this.showStepView();
    }

    showStepView() {
      this.refreshRequirements();
      this.stepView.hidden = false;
      this.resultView.hidden = true;
      if (this.errorBox) this.errorBox.textContent = '';
      if (this.requireTotp && this.totpField) this.totpField.hidden = false;
      if (this.requirePassword && this.passwordField) this.passwordField.hidden = false;
      setTimeout(() => {
        if (this.requireTotp && this.totpInput) this.totpInput.focus();
        else if (this.passwordInput) this.passwordInput.focus();
      }, 10);
    }

    showResultView(opts) {
      this.stepView.hidden = true;
      this.resultView.hidden = false;
      this.storedSecret = opts.secret;
      this.secretVisible = false;
      this.updateSecretDisplay();
      if (this.keyLabel) this.keyLabel.textContent = opts.label || '';
      if (this.countdownEl) this.countdownEl.textContent = '';
      if (this.lastEl) this.lastEl.textContent = opts.previous ? `Previous reveal: ${opts.previous}` : '';
      this.clearTimers();
      let remaining = this.autoHideSeconds;
      if (this.countdownEl) this.countdownEl.textContent = `Auto-hide in ${remaining}s`;
      this.countdownTimer = setInterval(() => {
        remaining -= 1;
        if (remaining <= 0) {
          this.clearTimers();
          this.closeModal();
          return;
        }
        if (this.countdownEl) this.countdownEl.textContent = `Auto-hide in ${remaining}s`;
      }, 1000);
      this.hideTimer = setTimeout(() => {
        this.closeModal();
      }, this.autoHideSeconds * 1000);
    }

    openModal(trigger) {
      this.activeTrigger = trigger;
      this.modal.classList.add('open');
      this.modal.removeAttribute('hidden');
      document.body.classList.add('modal-open');
      this.showStepView();
    }

    async submitReveal() {
      if (!this.activeTrigger) return;

      const allow = this.activeTrigger.getAttribute('data-allow') === '1';
      if (!allow) {
        toast(this.activeTrigger.getAttribute('title') || 'Reveal unavailable', 'error');
        return;
      }

      const endpoint = this.activeTrigger.getAttribute('data-endpoint') || '';
      if (!endpoint) return;

      const payload = {};
      if (this.stepToken) payload.stepToken = this.stepToken;

      if (!payload.stepToken) {
        const pass = this.passwordInput ? this.passwordInput.value.trim() : '';
        const totp = this.totpInput ? this.totpInput.value.trim() : '';
        const reason = this.reasonField ? this.reasonField.value.trim() : '';

        if (this.requirePassword && !pass) {
          if (this.errorBox) this.errorBox.textContent = 'Password is required.';
          if (this.passwordInput) this.passwordInput.focus();
          return;
        }
        if (this.requireTotp && !totp) {
          if (this.errorBox) this.errorBox.textContent = 'Authenticator code is required.';
          if (this.totpInput) this.totpInput.focus();
          return;
        }
        if (this.passwordInput && pass) payload.password = pass;
        if (this.totpInput && totp) payload.totp = totp;
        if (this.reasonField && this.reasonWrap && !this.reasonWrap.hasAttribute('hidden')) {
          if (!reason) {
            if (this.errorBox) this.errorBox.textContent = 'Reason is required.';
            this.reasonField.focus();
            return;
          }
          payload.reason = reason;
        }
      }

      if (this.errorBox) this.errorBox.textContent = '';
      this.submitBtn.disabled = true;
      const originalLabel = this.submitBtn.getAttribute('data-label') || this.submitBtn.textContent || '';
      if (!this.submitBtn.hasAttribute('data-label')) this.submitBtn.setAttribute('data-label', originalLabel || 'Continue');
      this.submitBtn.textContent = 'Verifying…';

      try {
        const resp = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok || !data || data.ok === false) {
          if (data) {
            if (data.needsStepUp || data.error === 'disabled') {
              try { sessionStorage.removeItem(this.stepStorage); } catch {}
              this.stepToken = '';
            }
          }
          const message = data && data.message ? data.message : 'Unable to reveal API key.';
          if (this.errorBox) this.errorBox.textContent = message;
          if (data && data.error === 'rate_limited' && data.retryAt) {
            toast(`Too many reveals. Try again after ${data.retryAt}.`, 'error');
          }
          return;
        }

        const { secret, stepToken: nextStep, previousSuccessAt, prefix } = data;
        if (nextStep) {
          this.stepToken = nextStep;
          try { sessionStorage.setItem(this.stepStorage, nextStep); } catch {}
        }
        if (this.passwordInput) this.passwordInput.value = '';
        if (this.totpInput) this.totpInput.value = '';
        if (this.reasonField) this.reasonField.value = '';
        const basePrefix = prefix || (this.activeTrigger.getAttribute('data-key-prefix') || '');
        const last4 = this.activeTrigger.getAttribute('data-key-last4') || '';
        const label = last4 ? `${basePrefix}.****${last4}` : basePrefix;
        const prev = previousSuccessAt
          ? new Date(previousSuccessAt).toLocaleString()
          : (this.activeTrigger.getAttribute('data-last-revealed')
            ? new Date(this.activeTrigger.getAttribute('data-last-revealed')).toLocaleString()
            : '');
        this.showResultView({ secret, label, previous: prev });
        const nowIso = new Date().toISOString();
        this.activeTrigger.setAttribute('data-last-revealed', nowIso);
      } catch (err) {
        console.error('[api-key-reveal] request failed', err);
        if (this.errorBox) this.errorBox.textContent = 'Network error. Please try again.';
      } finally {
        this.submitBtn.disabled = false;
        const label = this.submitBtn.getAttribute('data-label') || 'Continue';
        this.submitBtn.textContent = label;
      }
    }

    handleTrigger(trigger) {
      const allow = trigger.getAttribute('data-allow') === '1';
      if (!allow) {
        toast(trigger.getAttribute('title') || 'Reveal unavailable', 'error');
        return;
      }
      this.openModal(trigger);
    }
  }

  function getController(modal) {
    if (!modal) return null;
    const existing = controllers.get(modal);
    if (existing) return existing.ready ? existing : null;
    const controller = new KeyRevealController(modal);
    if (!controller.ready) return null;
    controllers.set(modal, controller);
    return controller;
  }

  function bindTrigger(trigger) {
    if (!(trigger instanceof Element)) return;
    if (trigger.hasAttribute(BOUND_ATTR)) return;
    trigger.setAttribute(BOUND_ATTR, "1");
    const handler = (event) => {
      const scope = trigger.getAttribute("data-reveal-scope") || trigger.getAttribute("data-scope") || "";
      const modal = getModal(scope);
      if (!modal) return;
      const controller = getController(modal);
      if (!controller) return;
      if (event) event.preventDefault();
      controller.handleTrigger(trigger);
    };
    trigger.addEventListener("click", handler, { capture: true });
  }

  function scanTriggers(root = document) {
    if (!root) return;
    const list = root.querySelectorAll
      ? root.querySelectorAll("[data-api-key-reveal-trigger]")
      : [];
    list.forEach((trigger) => bindTrigger(trigger));
    if (root instanceof Element && root.matches("[data-api-key-reveal-trigger]")) {
      bindTrigger(root);
    }
  }

  function init() {
    if (!document.querySelector("[data-api-key-reveal-modal]")) return;
    scanTriggers();
    if (!("MutationObserver" in window) || !document.body) return;
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (!(node instanceof Element)) continue;
          scanTriggers(node);
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
