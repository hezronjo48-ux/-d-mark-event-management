(function() {
  function getToken() {
    var el = document.querySelector('meta[name="csrf-token"]');
    if (el && el.content) return el.content;
    var input = document.getElementById('csrf-token');
    if (input) return input.value;
    return null;
  }

  var token = getToken();
  if (!token) return;

  var origFetch = window.fetch;
  window.fetch = function(url, opts) {
    opts = opts || {};
    opts.credentials = opts.credentials || 'same-origin';
    opts.headers = opts.headers || {};
    if (opts.headers instanceof Headers) {
      opts.headers.set('x-csrf-token', token);
    } else {
      opts.headers['x-csrf-token'] = token;
    }
    return origFetch.call(window, url, opts);
  };

  var origOpen = XMLHttpRequest.prototype.open;
  var origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function(method, url) {
    this._csrfMethod = (method || 'GET').toUpperCase();
    return origOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function(body) {
    if (this._csrfMethod !== 'GET' && this._csrfMethod !== 'HEAD' && this._csrfMethod !== 'OPTIONS') {
      this.setRequestHeader('x-csrf-token', token);
    }
    return origSend.apply(this, arguments);
  };
})();
