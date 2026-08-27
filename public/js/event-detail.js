(function() {
  var Msg = (window.app && window.app.pageData()) || {};
  var eventId = document.body.getAttribute('data-event-id');

  function showEditEvent() {
    document.getElementById('editEventModal').style.display = 'flex';
  }

  function closeEditEvent() {
    document.getElementById('editEventModal').style.display = 'none';
    var s = document.getElementById('editEventStatus');
    if (s) s.textContent = '';
  }

  function toggleEditType() {
    var t = document.getElementById('edit_event_type').value;
    document.getElementById('edit_wedding_fields').style.display = t === 'Wedding' ? 'block' : 'none';
    document.getElementById('edit_wedding_fields2').style.display = t === 'Wedding' ? 'block' : 'none';
    document.getElementById('edit_custom_group').style.display = t === 'Other' ? 'block' : 'none';
    var showPerson = t !== 'Wedding';
    document.getElementById('edit_person1_group').style.display = showPerson ? 'block' : 'none';
    var showPerson2 = t === 'Anniversary';
    document.getElementById('edit_person2_group').style.display = showPerson2 ? 'block' : 'none';
    document.getElementById('edit_person1_label').textContent = showPerson2 ? (Msg.person1 || 'Person 1') : (Msg.personName || 'Person name');
  }

  function showEditContributor(e, btn) {
    document.getElementById('edit_contributor_id').value = btn.getAttribute('data-id');
    document.getElementById('edit_con_name').value = btn.getAttribute('data-name');
    document.getElementById('edit_con_phone').value = btn.getAttribute('data-phone');
    var type = btn.getAttribute('data-type');
    var promise = btn.getAttribute('data-promise');
    var paid = btn.getAttribute('data-paid');
    document.getElementById('edit_con_promise').value = promise;
    document.getElementById('edit_con_paid').value = paid;
    document.getElementById('edit_promise_group').style.display = type === 'Cash' ? 'none' : 'block';
    document.getElementById('edit_paid_group').style.display = 'block';
    document.getElementById('editConStatus').textContent = '';
    document.getElementById('editContributorModal').style.display = 'flex';
  }

  function closeEditContributor() {
    document.getElementById('editContributorModal').style.display = 'none';
    var s = document.getElementById('editConStatus');
    if (s) s.textContent = '';
  }

  var editEventForm = document.getElementById('editEventForm');
  if (editEventForm) {
    editEventForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var data = {
        name: document.getElementById('edit_name').value,
        event_type: document.getElementById('edit_event_type').value,
        custom_type: document.getElementById('edit_custom_type').value,
        groom_name: document.getElementById('edit_groom_name').value,
        bride_name: document.getElementById('edit_bride_name').value,
        person1_name: document.getElementById('edit_person1_name').value,
        person2_name: document.getElementById('edit_person2_name').value,
        event_date: document.getElementById('edit_event_date').value,
        venue: document.getElementById('edit_venue').value,
        target_amount: document.getElementById('edit_target_amount').value
      };
      var status = document.getElementById('editEventStatus');
      status.style.color = '#888';
      status.textContent = (Msg.saved || 'Saved') + '...';
      fetch('/admin/events/' + eventId + '/edit', {
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

  var editContributorForm = document.getElementById('editContributorForm');
  if (editContributorForm) {
    editContributorForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var contributorId = document.getElementById('edit_contributor_id').value;
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

  function copyLink(e, el) {
    var input = document.getElementById('contributionLink');
    input.select();
    document.execCommand('copy');
    var orig = el.innerHTML;
    el.innerHTML = '<i class="fas fa-check"></i> ' + (Msg.copied || 'Copied');
    setTimeout(function() { el.innerHTML = orig; }, 2000);
  }

  function copyManageLink(e, el) {
    var input = document.getElementById('manageLink');
    input.select();
    document.execCommand('copy');
    var orig = el.innerHTML;
    el.innerHTML = '<i class="fas fa-check"></i> ' + (Msg.copied || 'Copied');
    setTimeout(function() { el.innerHTML = orig; }, 2000);
  }

  function confirmDelete() {
    if (confirm(Msg.deleteEventConfirm || 'Delete this event?')) {
      fetch('/admin/events/' + eventId + '/delete', { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function(d) {
          if (d.success) { window.location.href = '/admin/dashboard'; }
          else { alert((Msg.failedDelete || 'Delete failed') + ': ' + (d.error || Msg.unknownError || 'Unknown error')); }
        })
        .catch(function() { alert(Msg.failedDeleteEvent || 'Failed to delete event'); });
    }
  }

  function changeStatus() {
    var status = document.getElementById('statusSelect').value;
    fetch('/admin/events/' + eventId + '/status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: status })
    }).then(function(r) { return r.json(); })
    .then(function(d) { if (d.success) { window.location.reload(); } else { alert(Msg.failed || 'Failed'); } })
    .catch(function() { alert(Msg.failed || 'Failed'); });
  }

  function toggleManualEntry() {
    var sec = document.getElementById('manualEntrySection');
    sec.style.display = sec.style.display === 'none' ? 'block' : 'none';
  }

  function toggleManualType() {
    var type = document.getElementById('manual_type').value;
    document.getElementById('manual_promise_group').style.display = type === 'promise' ? 'block' : 'none';
    document.getElementById('manual_cash_group').style.display = type === 'cash' ? 'block' : 'none';
  }

  var manualForm = document.getElementById('manualEntryForm');
  if (manualForm) {
    manualForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var data = {
        full_name: document.getElementById('manual_name').value,
        phone_number: document.getElementById('manual_phone').value,
        contribution_type: document.getElementById('manual_type').value,
        promise_amount: document.getElementById('manual_promise').value,
        amount_paid: document.getElementById('manual_amount').value,
        payment_method: document.getElementById('manual_method').value,
        sender_name: document.getElementById('manual_sender').value
      };
      fetch('/admin/events/' + eventId + '/contributors/manual', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        var status = document.getElementById('manualStatus');
        if (d.success) {
          status.className = 'result-message success';
          status.textContent = Msg.added || 'Added';
          status.style.display = 'inline';
          setTimeout(function() { window.location.reload(); }, 1000);
        } else {
          status.className = 'result-message error';
          status.textContent = d.error || (Msg.failed || 'Failed');
          status.style.display = 'inline';
        }
      })
      .catch(function() {
        var status = document.getElementById('manualStatus');
        status.className = 'result-message error';
        status.textContent = Msg.error || 'Error';
        status.style.display = 'inline';
      });
    });
  }

  function filterTable() {
    var query = document.getElementById('searchInput').value.toLowerCase();
    var typeFilter = document.getElementById('filterType').value;
    var statusFilter = document.getElementById('filterStatus').value;
    var rows = document.querySelectorAll('#contributorsTable tbody tr');
    var count = 0;
    rows.forEach(function(row) {
      var searchText = row.getAttribute('data-search').toLowerCase();
      var type = row.getAttribute('data-type');
      var status = row.getAttribute('data-status');
      var match = (!query || searchText.indexOf(query) !== -1) &&
                   (!typeFilter || type === typeFilter) &&
                   (!statusFilter || status === statusFilter);
      row.style.display = match ? '' : 'none';
      if (match) count++;
    });
    document.getElementById('filterCount').textContent = count + ' ' + (Msg.of || 'of') + ' ' + rows.length;
  }

  var si = document.getElementById('searchInput');
  if (si) si.addEventListener('input', filterTable);
  var ft = document.getElementById('filterType');
  if (ft) ft.addEventListener('change', filterTable);
  var fs = document.getElementById('filterStatus');
  if (fs) fs.addEventListener('change', filterTable);

  document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('manual_type')) toggleManualType();
  });

  function showImportExcel() {
    document.getElementById('importExcelModal').style.display = 'flex';
    var status = document.getElementById('importExcelStatus');
    if (status) status.textContent = '';
    var fileInput = document.getElementById('importExcelFile');
    if (fileInput) fileInput.value = '';
  }

  function closeImportExcel() {
    document.getElementById('importExcelModal').style.display = 'none';
    var status = document.getElementById('importExcelStatus');
    if (status) status.textContent = '';
  }

  var importExcelForm = document.getElementById('importExcelForm');
  if (importExcelForm) {
    importExcelForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var fileInput = document.getElementById('importExcelFile');
      if (!fileInput.files.length) return;
      var status = document.getElementById('importExcelStatus');
      var btn = document.getElementById('importExcelBtn');
      status.style.color = '#888';
      status.textContent = 'Importing...';
      btn.disabled = true;
      var formData = new FormData();
      formData.append('excelFile', fileInput.files[0]);
      var origFetch = window.__origFetch || window.fetch;
      var csrfMeta = document.querySelector('meta[name="csrf-token"]');
      var csrfToken = csrfMeta ? csrfMeta.content : '';
      origFetch('/admin/import/' + eventId, {
        method: 'POST',
        body: formData,
        headers: { 'x-csrf-token': csrfToken }
      }).then(function(r) { return r.json(); })
      .then(function(d) {
        btn.disabled = false;
        if (d.success) {
          status.style.color = '#2e7d32';
          status.textContent = 'Imported ' + d.imported + ' contributors' + (d.skipped > 0 ? ' (' + d.skipped + ' skipped)' : '') + '!';
          setTimeout(function() { window.location.reload(); }, 1500);
        } else {
          status.style.color = '#c62828';
          status.textContent = d.error || (Msg.failed || 'Failed');
        }
      })
      .catch(function() {
        btn.disabled = false;
        status.style.color = '#c62828';
        status.textContent = Msg.failed || 'Failed';
      });
    });
  }

  function deleteContributor(e, btn) {
    var cid = btn.getAttribute('data-id');
    var name = btn.getAttribute('data-name');
    if (!confirm('Delete contributor "' + name + '"? This cannot be undone.')) return;
    fetch('/admin/events/' + eventId + '/contributors/' + cid + '/delete', { method: 'POST' })
      .then(function(r) { return r.json(); })
      .then(function(d) {
        if (d.success) { window.location.reload(); }
        else { alert(d.error || (Msg.failed || 'Failed')); }
      })
      .catch(function() { alert(Msg.failed || 'Failed'); });
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('showEditEvent', showEditEvent);
    window.app.registerAction('closeEditEvent', closeEditEvent);
    window.app.registerAction('toggleEditType', toggleEditType, ['change']);
    window.app.registerAction('copyLink', copyLink);
    window.app.registerAction('copyManageLink', copyManageLink);
    window.app.registerAction('confirmDelete', confirmDelete);
    window.app.registerAction('changeStatus', changeStatus, ['change']);
    window.app.registerAction('toggleManualEntry', toggleManualEntry);
    window.app.registerAction('toggleManualType', toggleManualType, ['change']);
    window.app.registerAction('editContributor', showEditContributor);
    window.app.registerAction('closeEditContributor', closeEditContributor);
    window.app.registerAction('showImportExcel', showImportExcel);
    window.app.registerAction('closeImportExcel', closeImportExcel);
    window.app.registerAction('deleteContributor', deleteContributor);
  }
})();