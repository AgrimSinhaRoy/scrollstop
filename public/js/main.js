// Highlight the current nav link
(function () {
  const links = document.querySelectorAll('.nav-link');
  const path = window.location.pathname;
  links.forEach(link => {
    const href = link.getAttribute('href');
    if (href === path || (href !== '/' && path.startsWith(href))) {
      link.classList.add('active');
    }
  });
})();
