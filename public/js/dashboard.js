(function() {
  var Msg = (window.app && window.app.pageData()) || {};

  function filterByStatus() {
    var val = document.getElementById('statusFilter').value;
    document.querySelectorAll('#eventsTable tbody tr').forEach(function(r) {
      r.style.display = !val || r.getAttribute('data-status') === val ? '' : 'none';
    });
  }

  function deleteEvent(e, el) {
    var id = el.getAttribute('data-id');
    var name = el.getAttribute('data-name') || '';
    var msg = (Msg.confirmDelete || 'Delete {name}?').replace(/{name}/g, name);
    if (confirm(msg)) {
      fetch('/admin/events/' + id + '/delete', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) { window.location.reload(); }
          else { alert((Msg.failed || 'Failed') + ': ' + (d.error || Msg.unknownError || 'Unknown error')); }
        })
        .catch(function() { alert(Msg.failedDeleteEvent || 'Failed to delete event'); });
    }
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('filterByStatus', filterByStatus, ['change']);
    window.app.registerAction('deleteEvent', deleteEvent);
  }
})();
