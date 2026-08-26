(function() {
  var Msg = (window.app && window.app.pageData()) || {};
  var eventId = document.body.getAttribute('data-event-id');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function switchTab(e, el) {
    var tab = el.getAttribute('data-tab');
    document.querySelectorAll('.tab-btn').forEach(function(btn) { btn.classList.remove('active'); });
    document.querySelectorAll('.tab-content').forEach(function(content) { content.classList.remove('active'); });
    if (tab === 'new') {
      document.querySelectorAll('.tab-btn')[0].classList.add('active');
      document.getElementById('tab-new').classList.add('active');
    } else {
      document.querySelectorAll('.tab-btn')[1].classList.add('active');
      document.getElementById('tab-update').classList.add('active');
    }
  }

  function toggleContributionType() {
    var type = document.querySelector('input[name="contribution_type"]:checked').value;
    document.getElementById('promiseFields').style.display = type === 'promise' ? 'block' : 'none';
    document.getElementById('cashFields').style.display = type === 'cash' ? 'block' : 'none';
    if (type === 'promise') {
      document.getElementById('promise_amount').required = true;
      document.getElementById('amount_paid').required = false;
      document.getElementById('payment_method').required = false;
    } else {
      document.getElementById('promise_amount').required = false;
      document.getElementById('amount_paid').required = true;
      document.getElementById('payment_method').required = true;
    }
  }

  document.addEventListener('DOMContentLoaded', toggleContributionType);

  var contributionForm = document.getElementById('contributionForm');
  if (contributionForm) {
    contributionForm.addEventListener('submit', function(e) {
      e.preventDefault();
      var formData = new FormData(this);
      var data = {};
      formData.forEach(function(value, key) { data[key] = value; });
      var resultDiv = document.getElementById('contributionResult');
      resultDiv.className = 'result-message';
      fetch('/api/contribute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      })
      .then(function(response) { return response.json(); })
      .then(function(result) {
        if (result.success) {
          resultDiv.className = 'result-message success';
          resultDiv.innerHTML = esc(result.message) + (result.contributor_id ? '<br><strong>' + esc(Msg.yourContributorId || 'Your Contributor ID') + ' ' + esc(result.contributor_id) + '</strong><br><small style="font-size:0.75rem;">' + esc(Msg.saveThisId || 'Please save this ID') + '</small>' : '');
          document.getElementById('contributionForm').reset();
          toggleContributionType();
        } else {
          resultDiv.className = 'result-message error';
          resultDiv.textContent = result.error || Msg.errorTryAgain;
        }
      })
      .catch(function() {
        resultDiv.className = 'result-message error';
        resultDiv.textContent = Msg.errorTryAgain;
      });
    });
  }

  function buildPromiseCard(p) {
    var card = document.createElement('div');
    card.className = 'match-card';
    card.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:0.5rem;">' +
      '  <div>' +
      '    <strong>' + esc(p.full_name) + '</strong>' +
      '    <span class="contributor-id-badge" style="margin-left:0.5rem;">' + esc(p.contributor_id || '-') + '</span>' +
      '  </div>' +
      '  <span class="badge ' + (p.status === 'Done' ? 'badge-success' : 'badge-warning') + '">' + esc(p.status) + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0.5rem;margin-top:0.5rem;font-size:0.8rem;color:#666;">' +
      '  <div>' + esc(Msg.promise || 'Promise') + ': TZS ' + Number(p.promise_amount).toLocaleString() + '</div>' +
      '  <div>' + esc(Msg.paid || 'Paid') + ': TZS ' + Number(p.paid_amount).toLocaleString() + '</div>' +
      '  <div>' + esc(Msg.balance || 'Balance') + ': TZS ' + Number(p.remaining_balance).toLocaleString() + '</div>' +
      '</div>' +
      '<button data-action="selectPromise" data-id="' + p.id + '" class="btn btn-sm btn-primary" style="margin-top:0.5rem;width:100%;">' + esc(Msg.select || 'Select') + '</button>';
    return card;
  }

  function showPromiseDetails(promise) {
    document.getElementById('displayContributorId').textContent = promise.contributor_id || '-';
    document.getElementById('displayPromiseName').textContent = promise.full_name;
    document.getElementById('displayPromiseAmount').textContent = 'TZS ' + Number(promise.promise_amount).toLocaleString();
    document.getElementById('displayTotalPaid').textContent = 'TZS ' + Number(promise.paid_amount).toLocaleString();
    document.getElementById('displayRemainingBalance').textContent = 'TZS ' + Number(promise.remaining_balance).toLocaleString();
    var statusTag = document.getElementById('displayStatusTag');
    statusTag.textContent = promise.status;
    statusTag.className = 'badge ' + (promise.status === 'Done' ? 'badge-success' : 'badge-warning');
    document.getElementById('promiseContributorId').value = promise.id;
    document.getElementById('searchSection').style.display = 'none';
    document.getElementById('searchResultsList').style.display = 'none';
    document.getElementById('searchResult').style.display = 'none';
    document.getElementById('promiseInfo').style.display = 'block';
    var paymentForm = document.getElementById('paymentFormSection');
    paymentForm.style.display = promise.remaining_balance <= 0 ? 'none' : 'block';
  }

  function selectPromise(e, el) {
    var id = parseInt(el.getAttribute('data-id'), 10);
    var promise = window._promiseMatches.find(function(p) { return p.id === id; });
    if (promise) showPromiseDetails(promise);
  }

  function searchPromise() {
    var input = document.getElementById('search_name').value.trim();
    var resultDiv = document.getElementById('searchResult');
    var promiseInfo = document.getElementById('promiseInfo');
    var searchSection = document.getElementById('searchSection');
    var searchResultsList = document.getElementById('searchResultsList');
    resultDiv.className = 'result-message';
    searchResultsList.style.display = 'none';
    if (!input) {
      resultDiv.className = 'result-message error';
      resultDiv.textContent = Msg.pleaseEnter;
      resultDiv.style.display = 'block';
      return;
    }
    var body = { event_id: eventId };
    var isId = /^CNT-\d+$/i.test(input);
    if (isId) { body.contributor_id = input.toUpperCase(); }
    else { body.full_name = input; }
    fetch('/api/promise/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    .then(function(response) { return response.json(); })
    .then(function(result) {
      if (result.found && result.promises.length > 0) {
        window._promiseMatches = result.promises;
        if (result.promises.length === 1 || isId) { showPromiseDetails(result.promises[0]); }
        else {
          var container = document.getElementById('matchesContainer');
          container.innerHTML = '';
          result.promises.forEach(function(p) {
            container.appendChild(buildPromiseCard(p));
          });
          searchSection.style.display = 'none';
          resultDiv.style.display = 'none';
          searchResultsList.style.display = 'block';
        }
      } else {
        resultDiv.className = 'result-message error';
        resultDiv.textContent = result.message;
        promiseInfo.style.display = 'none';
        searchResultsList.style.display = 'none';
        resultDiv.style.display = 'block';
      }
    })
    .catch(function() {
      resultDiv.className = 'result-message error';
      resultDiv.textContent = Msg.errorTryAgain;
      resultDiv.style.display = 'block';
    });
  }

  function browseAllPromises() {
    var searchSection = document.getElementById('searchSection');
    var searchResultsList = document.getElementById('searchResultsList');
    var resultDiv = document.getElementById('searchResult');
    var container = document.getElementById('matchesContainer');
    resultDiv.className = 'result-message';
    resultDiv.style.display = 'none';
    container.innerHTML = '<p style="text-align:center;color:#888;padding:1rem;">' + esc(Msg.loading || 'Loading...') + '</p>';
    searchResultsList.style.display = 'block';
    fetch('/api/promise/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: eventId })
    })
    .then(function(r) { return r.json(); })
    .then(function(result) {
      container.innerHTML = '';
      if (result.promises && result.promises.length > 0) {
        window._promiseMatches = result.promises;
        result.promises.forEach(function(p) {
          container.appendChild(buildPromiseCard(p));
        });
        searchSection.style.display = 'none';
      } else {
        container.innerHTML = '<p style="text-align:center;color:#888;padding:1rem;">' + esc(Msg.noPromises || 'No promises') + '</p>';
        searchSection.style.display = 'none';
      }
    })
    .catch(function() {
      container.innerHTML = '<p style="text-align:center;color:#c62828;padding:1rem;">' + esc(Msg.failedTryAgain || 'Failed. Please try again.') + '</p>';
    });
  }

  function submitPayment() {
    var contributorId = document.getElementById('promiseContributorId').value;
    var amount = document.getElementById('payment_amount').value;
    var paymentMethod = document.getElementById('payment_method_update').value;
    var senderName = document.getElementById('sender_name_update').value;
    var resultDiv = document.getElementById('paymentResult');
    resultDiv.className = 'result-message';
    if (!amount || parseFloat(amount) <= 0) {
      resultDiv.className = 'result-message error';
      resultDiv.textContent = Msg.invalidAmount;
      return;
    }
    fetch('/api/promise/pay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contributor_id: contributorId, amount: amount, payment_method: paymentMethod, sender_name: senderName })
    })
    .then(function(response) { return response.json(); })
    .then(function(result) {
      if (result.success) {
        resultDiv.className = 'result-message success';
        resultDiv.textContent = result.message;
        document.getElementById('displayTotalPaid').textContent = 'TZS ' + Number(result.data.paid_amount).toLocaleString();
        document.getElementById('displayRemainingBalance').textContent = 'TZS ' + Number(result.data.remaining_balance).toLocaleString();
        var statusTag = document.getElementById('displayStatusTag');
        statusTag.textContent = result.data.status;
        statusTag.className = 'badge ' + (result.data.status === 'Done' ? 'badge-success' : 'badge-warning');
        document.getElementById('payment_amount').value = '';
        document.getElementById('payment_method_update').value = '';
        document.getElementById('sender_name_update').value = '';
        if (result.data.remaining_balance <= 0) { document.getElementById('paymentFormSection').style.display = 'none'; }
      } else {
        resultDiv.className = 'result-message error';
        resultDiv.textContent = result.error || Msg.anError;
      }
    })
    .catch(function() {
      resultDiv.className = 'result-message error';
      resultDiv.textContent = Msg.errorTryAgain;
    });
  }

  function resetSearch() {
    document.getElementById('searchSection').style.display = 'block';
    document.getElementById('promiseInfo').style.display = 'none';
    document.getElementById('searchResultsList').style.display = 'none';
    document.getElementById('search_name').value = '';
    document.getElementById('searchResult').className = 'result-message';
    document.getElementById('paymentResult').className = 'result-message';
    window._promiseMatches = null;
  }

  var nameInput = document.getElementById('full_name');
  var nameDropdown = document.getElementById('autofillDropdown');
  var phoneInput = document.getElementById('phone_number');
  var nameDebounce;
  var selected = false;
  if (nameInput) {
    nameInput.addEventListener('input', function() {
      selected = false;
      var val = this.value.trim();
      if (val.length < 2) { nameDropdown.style.display = 'none'; return; }
      clearTimeout(nameDebounce);
      nameDebounce = setTimeout(function() {
        fetch('/api/contributor/autofill', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: val })
        })
        .then(function(r) { return r.json(); })
        .then(function(data) {
          if (data.matches && data.matches.length > 0 && !selected) {
            nameDropdown.innerHTML = '';
            data.matches.forEach(function(m) {
              var item = document.createElement('div');
              item.className = 'autofill-item';
              item.innerHTML = '<div>' + esc(m.full_name) + '</div>' + (m.phone_number ? '<div class="af-phone">' + esc(m.phone_number) + '</div>' : '');
              item.addEventListener('click', function() {
                nameInput.value = m.full_name;
                if (m.phone_number) phoneInput.value = m.phone_number;
                selected = true;
                nameDropdown.style.display = 'none';
              });
              nameDropdown.appendChild(item);
            });
            nameDropdown.style.display = 'block';
          } else {
            nameDropdown.style.display = 'none';
          }
        })
        .catch(function() { nameDropdown.style.display = 'none'; });
      }, 300);
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.autofill-wrap')) nameDropdown.style.display = 'none';
    });
  }

  var searchInput = document.getElementById('search_name');
  var searchDropdown = document.getElementById('promiseAutofillDropdown');
  var searchDebounce;
  if (searchInput) {
    searchInput.addEventListener('input', function() {
      var val = this.value.trim();
      if (val.length < 2) { searchDropdown.style.display = 'none'; return; }
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function() {
        var body = { event_id: eventId };
        var isId = /^CNT-\d+$/i.test(val);
        if (isId) { body.contributor_id = val.toUpperCase(); }
        else { body.full_name = val; }
        fetch('/api/promise/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
        .then(function(r) { return r.json(); })
        .then(function(result) {
          if (result.found && result.promises && result.promises.length > 0) {
            window._promiseMatches = result.promises;
            searchDropdown.innerHTML = '';
            result.promises.forEach(function(p) {
              var item = document.createElement('div');
              item.className = 'autofill-item';
              item.innerHTML =
                '<div style="display:flex;justify-content:space-between;align-items:center;gap:0.5rem;">' +
                '  <strong>' + esc(p.full_name) + '</strong>' +
                '  <span class="contributor-id-badge">' + esc(p.contributor_id || '-') + '</span>' +
                '</div>' +
                '<div style="font-size:0.75rem;color:#666;">' + esc(Msg.balance || 'Balance') + ': TZS ' + Number(p.remaining_balance).toLocaleString() + '</div>';
              item.addEventListener('click', function() {
                searchInput.value = p.full_name;
                searchDropdown.style.display = 'none';
                showPromiseDetails(p);
              });
              searchDropdown.appendChild(item);
            });
            searchDropdown.style.display = 'block';
          } else {
            searchDropdown.style.display = 'none';
          }
        })
        .catch(function() { searchDropdown.style.display = 'none'; });
      }, 300);
    });
    document.addEventListener('click', function(e) {
      if (!e.target.closest('.autofill-wrap')) searchDropdown.style.display = 'none';
    });
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('switchTab', switchTab);
    window.app.registerAction('toggleContributionType', toggleContributionType, ['change']);
    window.app.registerAction('searchPromise', searchPromise);
    window.app.registerAction('browseAllPromises', browseAllPromises);
    window.app.registerAction('resetSearch', resetSearch);
    window.app.registerAction('submitPayment', submitPayment);
    window.app.registerAction('selectPromise', selectPromise);
  }
})();