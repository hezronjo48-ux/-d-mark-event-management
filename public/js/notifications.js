(function() {
  var shownToastIds = {};
  var toastWrap = document.createElement('div');
  toastWrap.className = 'notif-toast-wrap';
  document.body.appendChild(toastWrap);

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  window.escHTML = esc;

  window.makeNotifClickable = function(item, n) {
    var link = document.createElement('a');
    link.href = '/admin/events/' + n.event_id;
    link.className = 'notif-link';
    while (item.firstChild) link.appendChild(item.firstChild);
    item.appendChild(link);
  };

  window.showNotifToast = function(n) {
    var key = n.id;
    if (shownToastIds[key]) return;
    shownToastIds[key] = true;
    var toast = document.createElement('div');
    toast.className = 'notif-toast';
    toast.innerHTML =
      '<button class="toast-close">&times;</button>' +
      '<div class="toast-title">' + esc(window.NOTIF_TITLE || 'Notification') + '</div>' +
      '<div class="toast-msg">' + esc(n.message) + '</div>';
    toast.querySelector('.toast-close').addEventListener('click', function() {
      toast.remove();
    });
    toast.addEventListener('click', function(e) {
      if (e.target.classList.contains('toast-close')) return;
      window.location.href = '/admin/events/' + n.event_id;
    });
    toastWrap.appendChild(toast);
    setTimeout(function() {
      toast.classList.add('toast-hide');
      setTimeout(function() { toast.remove(); }, 320);
    }, 8000);
  };

  window.pollNotifications = function() {
    if (!window.__notifPollStarted) {
      window.__notifPollStarted = true;
      setInterval(function() {
        fetch('/api/notifications')
          .then(function(r) { return r.json(); })
          .then(function(data) {
            if (!data.notifications) return;
            data.notifications.forEach(function(n) {
              if (!n.is_read) showNotifToast(n);
            });
            var badge = document.getElementById('notifBadge');
            if (badge) {
              if (data.unread > 0) { badge.style.display = 'inline-flex'; badge.textContent = data.unread; }
              else { badge.style.display = 'none'; }
            }
          })
          .catch(function() {});
      }, 20000);
    }
  };

  window.dismissAllToasts = function() {
    while (toastWrap.firstChild) toastWrap.removeChild(toastWrap.firstChild);
  };

  var Msg = (window.app && window.app.pageData()) || {};

  function toggleNotifications() {
    var panel = document.getElementById('notifPanel');
    var overlay = document.getElementById('notifOverlay');
    if (panel.classList.contains('open')) { panel.classList.remove('open'); overlay.style.display = 'none'; }
    else { loadNotifications(); panel.classList.add('open'); overlay.style.display = 'block'; }
  }

  function closeNotifications() {
    var panel = document.getElementById('notifPanel');
    if (panel) panel.classList.remove('open');
    var overlay = document.getElementById('notifOverlay');
    if (overlay) overlay.style.display = 'none';
  }

  function loadNotifications() {
    var list = document.getElementById('notifList');
    list.innerHTML = '<p style="text-align:center;color:#888;padding:1rem;font-size:0.85rem;">' + esc(Msg.loading || 'Loading...') + '</p>';
    fetch('/api/notifications').then(function(r) { return r.json(); }).then(function(data) {
      list.innerHTML = '';
      if (data.notifications.length === 0) {
        list.innerHTML = '<p style="text-align:center;color:#888;padding:2rem;font-size:0.85rem;">' + esc(Msg.noNotifications || 'No notifications') + '</p>';
        return;
      }
      data.notifications.forEach(function(n) {
        var d = new Date(n.created_at);
        var ds = d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        var icon = n.type === 'new_promise' ? 'fa-handshake' : n.type === 'new_cash' ? 'fa-money-bill' : 'fa-check-circle';
        var item = document.createElement('div');
        item.className = 'notif-item' + (n.is_read ? '' : ' unread');
        item.innerHTML = '<div class="notif-icon"><i class="fas ' + icon + '"></i></div><div class="notif-body"><div class="notif-msg">' + esc(n.message) + '</div><div class="notif-time">' + ds + '</div></div>';
        if (window.makeNotifClickable) makeNotifClickable(item, n);
        list.appendChild(item);
      });
      var badge = document.getElementById('notifBadge');
      if (badge) badge.style.display = 'none';
      if (window.dismissAllToasts) dismissAllToasts();
    }).catch(function() {
      list.innerHTML = '<p style="text-align:center;color:#c62828;padding:1rem;font-size:0.85rem;">' + esc(Msg.failedToLoad || 'Failed to load') + '</p>';
    });
  }

  function markAllRead() {
    fetch('/api/notifications/read', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) {
          document.querySelectorAll('#notifList .notif-item').forEach(function(el) { el.classList.remove('unread'); });
        }
      })
      .catch(function() {});
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('toggleNotifications', toggleNotifications);
    window.app.registerAction('closeNotifications', closeNotifications);
    window.app.registerAction('markAllRead', markAllRead);
  }

  window.NOTIF_TITLE = Msg.notifications || 'Notifications';
  if (window.pollNotifications) pollNotifications();
})();
