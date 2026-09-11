(function () {
  var sidebar = document.getElementById('sidebar');
  var toggle = document.getElementById('sidebarToggle');
  var pageTitle = document.getElementById('pageTitle');
  var navItems = document.querySelectorAll('.nav-item');
  var sections = document.querySelectorAll('.section');
  var backdrop = document.getElementById('backdrop');
  var mobileQuery = window.matchMedia('(max-width: 640px)');

  function setCollapsed(collapsed) {
    sidebar.classList.toggle('is-collapsed', collapsed);
    toggle.setAttribute('aria-expanded', String(!collapsed));
  }

  toggle.addEventListener('click', function () {
    setCollapsed(!sidebar.classList.contains('is-collapsed'));
  });

  backdrop.addEventListener('click', function () {
    setCollapsed(true);
  });

  // Start hidden on small screens so the content is reachable.
  if (mobileQuery.matches) setCollapsed(true);

  function showSection(id) {
    var found = false;
    sections.forEach(function (section) {
      var match = section.id === id;
      section.classList.toggle('is-visible', match);
      if (match) found = true;
    });
    if (!found) return showSection('overview');

    navItems.forEach(function (item) {
      var active = item.dataset.section === id;
      item.classList.toggle('is-active', active);
      if (active) pageTitle.textContent = item.querySelector('.nav-item__label').textContent;
    });
  }

  navItems.forEach(function (item) {
    item.addEventListener('click', function (event) {
      event.preventDefault();
      history.replaceState(null, '', '#' + item.dataset.section);
      showSection(item.dataset.section);
      if (mobileQuery.matches) setCollapsed(true);
    });
  });

  window.addEventListener('hashchange', function () {
    showSection(location.hash.slice(1) || 'overview');
  });

  showSection(location.hash.slice(1) || 'overview');
})();
