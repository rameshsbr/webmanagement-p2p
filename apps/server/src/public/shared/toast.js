(function () {
  if (typeof window === 'undefined') return;
  if (window.toast && window.toast.__shared) return;

  const HOST_CLASS = 'toast-host';
  const BASE_CLASS = 'toast';
  const ERROR_CLASS = 'toast--error';
  const DEFAULT_DURATION = 3200;

  const ensureHost = () => {
    let host = document.querySelector(`.${HOST_CLASS}`);
    if (!host) {
      host = document.createElement('div');
      host.className = HOST_CLASS;
      host.setAttribute('role', 'status');
      host.setAttribute('aria-live', 'polite');
      host.setAttribute('aria-atomic', 'false');
      document.body.appendChild(host);
    }
    return host;
  };

  const hideToast = (node) => {
    if (!node) return;
    node.classList.remove('show');
    window.setTimeout(() => node.remove(), 250);
  };

  const createToast = (message, options = {}) => {
    if (!message) return null;

    const host = ensureHost();
    const toastEl = document.createElement('div');
    toastEl.className = BASE_CLASS;
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    toastEl.setAttribute('aria-atomic', 'true');

    const { variant, duration } = options;
    if (variant === 'error') {
      toastEl.classList.add(ERROR_CLASS);
    }

    toastEl.textContent = message;
    host.appendChild(toastEl);

    requestAnimationFrame(() => {
      toastEl.classList.add('show');
    });

    const ttl = Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION;
    window.setTimeout(() => hideToast(toastEl), ttl);

    return toastEl;
  };

  const sharedToast = (message, options) => {
    return createToast(message, options);
  };

  sharedToast.error = (message, options = {}) => {
    const merged = { ...options, variant: 'error' };
    return sharedToast(message, merged);
  };

  sharedToast.__shared = true;
  window.toast = sharedToast;
})();
