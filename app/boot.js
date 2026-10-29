// Theme bootstrap (classic script, runs before CSS paints so there is no flash).
(function () {
  var t = null;
  try { t = localStorage.getItem('hub.theme'); } catch (e) {}
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
})();
