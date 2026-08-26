(function() {
  var Msg = (window.app && window.app.pageData()) || {};
  var body = document.body;
  var eventId = body.getAttribute('data-event-id');
  var contributorId = body.getAttribute('data-contributor-id');

  function showEditContributor() {
    document.getElementById('editContributorModal').style.display = 'flex';
  }

  function closeEditContributor() {
    document.getElementById('editContributorModal').style.display = 'none';
    var s = document.getElementById('editConStatus');
    if (s) s.textContent = '';
  }

  function saveNotes() {
    var notes = document.getElementById('notes').value;
    fetch('/admin/events/' + eventId + '/contributors/' + contributorId + '/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ notes: notes })
    })
    .then(function(r) { return r.json(); })
    .then(function(d) {
      var status = document.getElementById('notesStatus');
      status.style.display = 'inline';
      status.textContent = Msg.saved || 'Saved';
      setTimeout(function() { status.style.display = 'none'; }, 2000);
    })
    .catch(function() { alert(Msg.saveFailed || 'Failed to save'); });
  }

  var editForm = document.getElementById('editContributorForm');
  if (editForm) {
    editForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var data = {
        full_name: document.getElementById('edit_con_name').value,
        phone_number: document.getElementById('edit_con_phone').value,
        promise_amount: document.getElementById('edit_con_promise').value,
        paid_amount: document.getElementById('edit_con_paid').value
      };
      var status = document.getElementById('editConStatus');
      status.style.color = '#888';
      status.textContent = (Msg.saved || 'Saved') + '...';
      fetch('/admin/events/' + eventId + '/contributors/' + contributorId + '/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) { window.location.reload(); }
        else { status.style.color = '#c62828'; status.textContent = d.error || (Msg.failed || 'Failed'); }
      })
      .catch(function() { status.style.color = '#c62828'; status.textContent = Msg.failed || 'Failed'; });
    });
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('showEditContributor', showEditContributor);
    window.app.registerAction('closeEditContributor', closeEditContributor);
    window.app.registerAction('saveNotes', saveNotes);
  }
})();
