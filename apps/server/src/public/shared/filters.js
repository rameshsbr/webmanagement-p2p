(function(){
  'use strict';

  function readPref(key){
    if (!key) return null;
    try {
      return window.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  function writePref(key, value){
    if (!key) return;
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {
      /* ignore */
    }
  }

  function updateHeight(body){
    if (!body) return;
    const previous = body.style.getPropertyValue('--filters-body-max');
    const computed = body.scrollHeight;
    const target = Math.max(computed, 0);
    const value = target ? target + 'px' : '0px';
    if (previous !== value) {
      body.style.setProperty('--filters-body-max', value);
    }
  }

  function setupFilter(form){
    const toggle = form.querySelector('[data-filters-toggle]');
    const body = form.querySelector('[data-filters-body]');
    if (!toggle || !body) return;

    const storageKey = form.dataset.filtersKey || '';
    let collapsed = storageKey && readPref(storageKey) === '1';

    function applyState(next, animate){
      updateHeight(body);
      collapsed = next;
      form.dataset.filtersCollapsed = collapsed ? 'true' : 'false';
      toggle.textContent = collapsed ? '+' : '−';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      toggle.setAttribute('aria-label', collapsed ? 'Expand filters' : 'Collapse filters');
      if (storageKey) {
        if (collapsed) writePref(storageKey, '1'); else writePref(storageKey, '0');
      }
      if (animate) {
        body.classList.add('filters-animating');
        const cleanup = function(){
          body.classList.remove('filters-animating');
        };
        body.addEventListener('transitionend', cleanup, { once: true });
      }
    }

    applyState(collapsed, false);

    toggle.addEventListener('click', function(){
      applyState(!collapsed, true);
    });

    const observer = new MutationObserver(function(){
      updateHeight(body);
    });
    observer.observe(body, { childList: true, subtree: true });

    window.addEventListener('resize', function(){ updateHeight(body); });
  }

  function init(){
    const forms = document.querySelectorAll('[data-filters]');
    forms.forEach(setupFilter);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
