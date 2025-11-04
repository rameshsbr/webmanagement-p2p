// /static/auth/login.js
(function () {
  // ───────────────── Cloudflare Turnstile helpers ─────────────────
  function setCfToken(value) {
    var el = document.getElementById('cfToken');
    if (el) el.value = value || '';
  }

  // Called by Turnstile's data-callback (if present)
  window.__cfOk = function (token) { setCfToken(token); };

  // Also support the default Turnstile global callbacks
  window.onTurnstile = function (token) { setCfToken(token); };
  window.onTurnstileExpired = function () { setCfToken(''); };
  window.onTurnstileError = function () { setCfToken(''); };

  function copyWidgetTokenIntoCanonical() {
    var form = document.getElementById('loginForm');
    if (!form) return false;
    var ours = document.getElementById('cfToken');
    var cfs = form.querySelectorAll(
      'input[name="cf-turnstile-response"], input[name="cf-turnstile"], input[name="cf-turnstile-token"]'
    );
    var val = '';
    for (var i = 0; i < cfs.length; i++) {
      if (cfs[i].value) { val = cfs[i].value; break; }
    }
    if (ours) ours.value = val;
    return !!val;
  }

  // ───────────────── Password Show/Hide helpers ─────────────────
  function flipType(input, toType) {
    // Try native flip first
    try {
      input.type = toType;
      if (input.type === toType) return input; // success
    } catch (_) {}
    // Fallback: clone & replace (fixes WebKit/Safari quirks)
    var clone = input.cloneNode(true);
    clone.setAttribute('type', toType);
    clone.value = input.value;

    // Preserve selection/caret if possible
    try {
      var end = clone.value.length;
      clone.setSelectionRange(end, end);
    } catch (_) {}

    // Replace in DOM
    var parent = input.parentNode;
    if (parent) parent.replaceChild(clone, input);
    return clone;
  }

  function ensureToggleForInput(input) {
    // If a toggle already exists adjacent/in wrapper, do nothing
    var wrap = input.closest('.password-wrap');
    var existing = (wrap && wrap.querySelector('.toggle-pass')) ||
                   (input.parentElement && input.parentElement.querySelector('.toggle-pass'));
    if (existing) return existing;

    // Create a per-input toggle button that targets THIS input only
    if (!input.id) {
      // Give it a stable ID so the toggle can reference it
      input.id = 'pw-' + Math.random().toString(36).slice(2, 9);
    }
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn small toggle-pass';
    btn.textContent = 'Show';
    btn.setAttribute('data-target', input.id);

    var parent = wrap || input.parentElement || document.body;
    try {
      if (parent && getComputedStyle(parent).position === 'static') {
        parent.style.position = 'relative';
      }
    } catch (_) {}
    btn.style.position = 'absolute';
    btn.style.right = '6px';
    btn.style.top = '50%';
    btn.style.transform = 'translateY(-50%)';

    parent.appendChild(btn);
    return btn;
  }

  function resolveTargetInputFor(btn) {
    // 1) Explicit data-target
    var id = btn.getAttribute('data-target');
    if (id) {
      var el = document.getElementById(id);
      if (el) return el;
    }
    // 2) aria-controls
    var ac = btn.getAttribute('aria-controls');
    if (ac) {
      var el2 = document.getElementById(ac);
      if (el2) return el2;
    }
    // 3) within a .password-wrap
    var wrap = btn.closest('.password-wrap');
    if (wrap) {
      var inWrap = wrap.querySelector('input[type="password"], input[type="text"]');
      if (inWrap) return inWrap;
    }
    // 4) nearest input sibling
    var sib =
      btn.previousElementSibling && /^(input)$/i.test(btn.previousElementSibling.tagName) ? btn.previousElementSibling :
      btn.nextElementSibling && /^(input)$/i.test(btn.nextElementSibling.tagName) ? btn.nextElementSibling :
      null;
    if (sib) return sib;

    // 5) last resort: first password input on page (fallback only)
    return document.querySelector('input[type="password"]');
  }

  function wireToggle(btn) {
    if (btn.__wired) return;
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      var input = resolveTargetInputFor(btn);
      if (!input) return;
      var showing = input.type === 'text';
      input = flipType(input, showing ? 'password' : 'text'); // may replace node
      btn.textContent = showing ? 'Show' : 'Hide';
      btn.setAttribute('aria-pressed', String(!showing));
      try { input.focus({ preventScroll: true }); } catch (_) {}
    });
    btn.__wired = true;
  }

  document.addEventListener('DOMContentLoaded', function () {
    // ───────── Ensure Turnstile token is present on submit ─────────
    var form = document.getElementById('loginForm');
    if (form) {
      form.addEventListener('submit', function (e) {
        var needsCf = !!document.querySelector('.cf-turnstile');
        if (!needsCf) return;
        copyWidgetTokenIntoCanonical();
        var tokenEl = document.getElementById('cfToken');
        if (!tokenEl || !tokenEl.value) {
          e.preventDefault();
          alert('Please complete the Cloudflare verification before signing in.');
        }
      });
    }

    // Auto-add toggles for every password input that doesn't have one
    var pwInputs = document.querySelectorAll('input[type="password"]');
    for (var i = 0; i < pwInputs.length; i++) {
      var btn = ensureToggleForInput(pwInputs[i]);
      if (btn) wireToggle(btn);
    }

    // Also wire any existing .toggle-pass buttons (with or without data-target)
    var toggles = document.querySelectorAll('.toggle-pass');
    for (var j = 0; j < toggles.length; j++) {
      wireToggle(toggles[j]);
    }
  });
})();