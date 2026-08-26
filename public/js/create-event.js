(function() {
  var Msg = (window.app && window.app.pageData()) || {};

  function toggleEventType() {
    var type = document.getElementById('event_type').value;
    var weddingFields = document.getElementById('weddingFields');
    var personFields = document.getElementById('personFields');
    var person2Group = document.getElementById('person2Group');
    var personRow = document.getElementById('personRow');
    var person1Label = document.getElementById('person1Label');
    var customField = document.getElementById('customTypeField');
    var customInput = document.getElementById('custom_type');

    if (type === 'Other') {
      customField.style.display = 'block';
      customInput.required = true;
    } else {
      customField.style.display = 'none';
      customInput.required = false;
    }

    if (type === 'Wedding') {
      weddingFields.style.display = 'block';
      personFields.style.display = 'none';
      document.getElementById('groom_name').required = true;
      document.getElementById('bride_name').required = true;
      document.getElementById('person1_name').required = false;
      document.getElementById('person2_name').required = false;
    } else {
      weddingFields.style.display = 'none';
      personFields.style.display = 'block';
      document.getElementById('groom_name').required = false;
      document.getElementById('bride_name').required = false;

      if (type === 'Anniversary') {
        person2Group.style.display = 'block';
        personRow.style.gridTemplateColumns = '1fr 1fr';
        person1Label.textContent = Msg.person1 || 'Person 1';
        document.getElementById('person2_name').required = true;
      } else {
        person2Group.style.display = 'none';
        personRow.style.gridTemplateColumns = '1fr';
        person1Label.textContent = Msg.personName || 'Name';
        document.getElementById('person2_name').required = false;
      }
      document.getElementById('person1_name').required = true;
    }
  }

  if (window.app && window.app.registerAction) {
    window.app.registerAction('toggleEventType', toggleEventType, ['change']);
  }

  document.addEventListener('DOMContentLoaded', toggleEventType);
})();