(function() {
  function currentLang() {
    return document.documentElement.lang || 'en';
  }

  function pageData() {
    var el = document.querySelector('meta[name="page-data"]');
    if (!el) return {};
    try { return JSON.parse(el.content) || {}; } catch (e) { return {}; }
  }

  var actions = {};
  var actionEvents = {};

  function registerAction(name, fn, types) {
    actions[name] = fn;
    actionEvents[name] = types || ['click'];
  }

  function dispatch(type, e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    var name = el.getAttribute('data-action');
    if (!actions[name]) return;
    var types = actionEvents[name] || ['click'];
    if (types.indexOf(type) === -1) return;
    if (type === 'click') e.preventDefault();
    actions[name](e, el);
  }

  document.addEventListener('click', function(e) { dispatch('click', e); });
  document.addEventListener('change', function(e) { dispatch('change', e); });

  function toggleLang() {
    var newLang = currentLang() === 'sw' ? 'en' : 'sw';
    fetch('/lang/' + newLang, { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) { if (d.success) window.location.reload(); })
      .catch(function() {});
  }

  registerAction('toggleLang', toggleLang);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/service-worker.js').catch(function() {});
  }

  window.app = {
    registerAction: registerAction,
    pageData: pageData,
    currentLang: currentLang,
    toggleLang: toggleLang
  };
})();
