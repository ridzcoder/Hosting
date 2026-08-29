(function () {
  var id = window.DEPLOYMENT_ID;
  var consoleEl = document.getElementById('console');
  var heading = document.getElementById('statusHeading');
  var sub = document.getElementById('statusSub');
  var spinner = document.getElementById('statusSpinner');
  var actions = document.getElementById('statusActions');

  var startedAt = Date.now();
  var pollHandle = null;
  var pollCount = 0;

  function elapsed() {
    var s = Math.floor((Date.now() - startedAt) / 1000);
    var mm = String(Math.floor(s / 60)).padStart(2, '0');
    var ss = String(s % 60).padStart(2, '0');
    return '[' + mm + ':' + ss + ']';
  }

  function addLine(msg, kind) {
    var row = document.createElement('div');
    row.className = 'console-line' + (kind ? ' ' + kind : '');
    row.innerHTML = '<span class="t">' + elapsed() + '</span><span class="msg">' + msg + '</span>';
    consoleEl.appendChild(row);
    consoleEl.scrollTop = consoleEl.scrollHeight;
  }

  function finish(kind, headingText, subHtml) {
    clearInterval(pollHandle);
    spinner.style.display = 'none';
    heading.textContent = headingText;
    sub.innerHTML = subHtml;
  }

  function poll() {
    pollCount += 1;
    fetch('/api/deploy/status/' + id)
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (data.status === 'succeeded') {
          addLine('Build succeeded', 'ok');
          finish('ok', 'Deployed', 'Your bot is live.');
          actions.style.display = 'flex';
          actions.innerHTML =
            (data.appUrl ? '<a class="btn btn-primary" href="' + data.appUrl + '" target="_blank" rel="noopener">Open app</a>' : '') +
            '<a class="btn btn-secondary" href="/dashboard">Back to dashboard</a>';
        } else if (data.status === 'failed') {
          addLine(data.failureMessage || 'Build failed on Heroku.', 'err');
          finish('err', 'Deploy failed', 'See the message above for details.');
          actions.style.display = 'flex';
          actions.innerHTML = '<a class="btn btn-primary" href="/dashboard">Back to dashboard</a>';
        } else if (pollCount % 4 === 0) {
          // Occasional heartbeat so the console doesn't look stalled on long builds.
          addLine('Still building on Heroku…');
        }
      })
      .catch(function () {
        // Transient network hiccup — next poll will retry.
      });
  }

  poll();
  pollHandle = setInterval(poll, 2500);
})();
