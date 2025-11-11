// apps/server/src/public/shared/timezone.js
(function () {
  const DEFAULT_TIMEZONE = 'UTC';
  const FALLBACK_ZONES = [
    'UTC',
    'Africa/Abidjan','Africa/Accra','Africa/Cairo','Africa/Johannesburg','Africa/Lagos','Africa/Nairobi',
    'America/Argentina/Buenos_Aires','America/Bogota','America/Chicago','America/Denver','America/Los_Angeles','America/Mexico_City','America/New_York','America/Santiago','America/Sao_Paulo','America/Toronto','America/Vancouver',
    'Asia/Bangkok','Asia/Dhaka','Asia/Dubai','Asia/Ho_Chi_Minh','Asia/Hong_Kong','Asia/Jakarta','Asia/Kolkata','Asia/Kuala_Lumpur','Asia/Manila','Asia/Riyadh','Asia/Seoul','Asia/Shanghai','Asia/Singapore','Asia/Taipei','Asia/Tokyo',
    'Australia/Perth','Australia/Adelaide','Australia/Brisbane','Australia/Sydney',
    'Europe/Amsterdam','Europe/Athens','Europe/Berlin','Europe/Brussels','Europe/Bucharest','Europe/Budapest','Europe/Copenhagen','Europe/Dublin','Europe/Helsinki','Europe/Istanbul','Europe/Kyiv','Europe/Lisbon','Europe/London','Europe/Madrid','Europe/Oslo','Europe/Paris','Europe/Prague','Europe/Rome','Europe/Stockholm','Europe/Vienna','Europe/Warsaw','Europe/Zurich',
    'Pacific/Auckland','Pacific/Fiji','Pacific/Honolulu'
  ];

  const formatterCache = new Map();
  let timezoneList = null;

  function normalizeTimezone(value) {
    if (typeof value !== 'string') return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: trimmed }).format(new Date());
      return trimmed;
    } catch {
      return '';
    }
  }

  function resolveTimezone(value) {
    const normalized = normalizeTimezone(value);
    return normalized || DEFAULT_TIMEZONE;
  }

  function detectInitialTimezone() {
    const bodyAttr = document.body?.dataset?.timezone || '';
    let candidate = bodyAttr;
    if (!candidate) {
      try {
        const stored = localStorage.getItem('pref_tz');
        if (stored) candidate = stored;
      } catch {}
    }
    if (!candidate && typeof Intl !== 'undefined' && Intl.DateTimeFormat) {
      try {
        candidate = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      } catch {}
    }
    return resolveTimezone(candidate);
  }

  function getAllTimezones() {
    if (timezoneList) return timezoneList.slice();
    let zones = [];
    if (typeof Intl !== 'undefined' && typeof Intl.supportedValuesOf === 'function') {
      try {
        zones = Intl.supportedValuesOf('timeZone') || [];
      } catch {
        zones = [];
      }
    }
    if (!zones.length) {
      zones = FALLBACK_ZONES.slice();
    }
    try {
      zones.sort();
    } catch {}
    timezoneList = zones;
    return zones.slice();
  }

  function ensureBodyTimezone(value) {
    if (!document.body) return;
    document.body.dataset.timezone = value;
  }

  function getFormatters(tz) {
    const key = tz || DEFAULT_TIMEZONE;
    if (formatterCache.has(key)) return formatterCache.get(key);
    const formatters = {
      date: new Intl.DateTimeFormat('en-AU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: key,
      }),
      time: new Intl.DateTimeFormat('en-AU', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true,
        timeZone: key,
      }),
    };
    formatterCache.set(key, formatters);
    return formatters;
  }

  function parseDate(value) {
    if (!value) return null;
    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatValue(value, tz, parts) {
    const date = parseDate(value);
    if (!date) {
      return parts ? { date: '-', time: '-' } : '-';
    }
    const formatters = getFormatters(tz);
    const result = {
      date: formatters.date.format(date),
      time: formatters.time.format(date),
    };
    return parts ? result : `${result.date} ${result.time}`;
  }

  const state = {
    current: DEFAULT_TIMEZONE,
  };

  state.current = detectInitialTimezone();
  ensureBodyTimezone(state.current);

  function applyTimezone(root) {
    const scope = root && root.nodeType === 1 ? root : document;
    const elements = [];
    if (scope === document) {
      scope.querySelectorAll('[data-dt]').forEach((node) => elements.push(node));
    } else {
      if (scope.hasAttribute && scope.hasAttribute('data-dt')) {
        elements.push(scope);
      }
      scope.querySelectorAll?.('[data-dt]').forEach((node) => elements.push(node));
    }
    if (!elements.length) return;
    elements.forEach((el) => {
      if (!el || typeof el.getAttribute !== 'function') return;
      const iso = el.getAttribute('data-dt');
      if (!iso) return;
      const { date, time } = formatValue(iso, state.current, true);
      if (!date || !time) return;
      if (el.children && el.children.length >= 2) {
        el.children[0].textContent = date;
        el.children[1].textContent = time;
      } else {
        el.textContent = '';
        const dateSpan = document.createElement('span');
        dateSpan.textContent = date;
        const timeSpan = document.createElement('span');
        timeSpan.textContent = time;
        el.appendChild(dateSpan);
        el.appendChild(timeSpan);
      }
      el.setAttribute('data-rendered-tz', state.current);
    });
  }

  const api = {
    get() {
      return state.current;
    },
    set(timezone) {
      const resolved = resolveTimezone(timezone);
      state.current = resolved;
      ensureBodyTimezone(resolved);
      try {
        localStorage.setItem('pref_tz', resolved);
      } catch {}
      applyTimezone(document);
      return resolved;
    },
    format(value, options) {
      return formatValue(value, state.current, options && options.parts);
    },
    apply(root) {
      applyTimezone(root || document);
    },
    populate(select) {
      if (!select) return;
      select.innerHTML = '';
      const zones = getAllTimezones();
      const frag = document.createDocumentFragment();
      zones.forEach((zone) => {
        const option = document.createElement('option');
        option.value = zone;
        option.textContent = zone;
        frag.appendChild(option);
      });
      select.appendChild(frag);
      select.value = state.current;
    },
    list() {
      return getAllTimezones();
    },
  };

  window.timezone = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      applyTimezone(document);
    });
  } else {
    applyTimezone(document);
  }

  const observer = new MutationObserver((mutations) => {
    let needsApply = false;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.attributeName === 'data-dt') {
        needsApply = true;
        break;
      }
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node.nodeType === 1 && ((node).hasAttribute?.('data-dt') || node.querySelector?.('[data-dt]'))) {
            needsApply = true;
          }
        });
        if (needsApply) break;
      }
    }
    if (needsApply) {
      applyTimezone(document);
    }
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dt'] });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      if (document.body) {
        observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-dt'] });
      }
    });
  }
})();
