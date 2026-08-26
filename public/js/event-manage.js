(function() {
  var Msg = (window.app && window.app.pageData()) || {};

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
    var fc = document.getElementById('filterCount');
    if (fc) fc.textContent = count + ' ' + (Msg.of || 'of') + ' ' + rows.length;
  }

  var input = document.getElementById('searchInput');
  if (input) input.addEventListener('input', filterTable);
  var ft = document.getElementById('filterType');
  if (ft) ft.addEventListener('change', filterTable);
  var fs = document.getElementById('filterStatus');
  if (fs) fs.addEventListener('change', filterTable);
})();
