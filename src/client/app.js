(function () {
  'use strict';

  var panes = {};
  var activePane = null;
  var startTime = null;
  var ws = null;
  var timerInterval = null;

  var tabBar = document.getElementById('tab-bar');
  var contentArea = document.getElementById('content-area');
  var statusDot = document.getElementById('status-dot');
  var statusText = document.getElementById('status-text');
  var statusTime = document.getElementById('status-time');

  window.addEventListener('hotline-authed', function () {
    connect();
  });

  function connect() {
    var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(proto + '//' + location.host + '/ws');

    ws.addEventListener('open', function () {
      statusDot.classList.add('connected');
      statusText.textContent = 'Connected';
      startTime = Date.now();
      timerInterval = setInterval(updateTime, 1000);
      updateTime();
    });

    ws.addEventListener('message', function (event) {
      var msg;
      try {
        msg = JSON.parse(event.data);
      } catch (e) {
        return;
      }

      if (msg.type === 'pane_update') {
        panes[msg.pane] = msg.content;
        renderTabs();
        renderPane(msg.pane);
        // Auto-select first pane or newly added pane
        if (!activePane || !panes[activePane]) {
          switchTo(msg.pane);
        }
      } else if (msg.type === 'pane_close') {
        delete panes[msg.pane];
        var paneEl = document.getElementById('pane-' + msg.pane);
        if (paneEl) paneEl.remove();
        renderTabs();
        if (activePane === msg.pane) {
          var keys = Object.keys(panes);
          switchTo(keys.length > 0 ? keys[0] : null);
        }
      } else if (msg.type === 'session_end') {
        showEnded();
      }
    });

    ws.addEventListener('close', function () {
      showEnded();
    });

    ws.addEventListener('error', function () {
      statusDot.classList.remove('connected');
      statusText.textContent = 'Connection error';
    });
  }

  function renderTabs() {
    tabBar.innerHTML = '';
    var keys = Object.keys(panes);
    keys.forEach(function (key) {
      var btn = document.createElement('button');
      btn.setAttribute('role', 'tab');
      btn.setAttribute('aria-selected', key === activePane ? 'true' : 'false');
      btn.textContent = panes[key].title || key;
      if (key === activePane) btn.classList.add('active');
      btn.addEventListener('click', function () {
        switchTo(key);
      });
      tabBar.appendChild(btn);
    });
  }

  function renderPane(key) {
    var id = 'pane-' + key;
    var el = document.getElementById(id);
    if (!el) {
      el = document.createElement('div');
      el.id = id;
      el.className = 'content-pane';
      contentArea.appendChild(el);
    }
    el.innerHTML = panes[key].html;

    // Bind action elements
    var actions = el.querySelectorAll('[data-action]');
    actions.forEach(function (actionEl) {
      actionEl.addEventListener('click', function () {
        if (!ws || ws.readyState !== WebSocket.OPEN) return;
        ws.send(JSON.stringify({
          type: 'action',
          action: {
            type: actionEl.getAttribute('data-action'),
            id: actionEl.getAttribute('data-id') || '',
            data: {},
          },
        }));
      });
    });

    if (key === activePane) {
      el.classList.add('active');
    }
  }

  function switchTo(key) {
    activePane = key;
    var allPanes = contentArea.querySelectorAll('.content-pane');
    allPanes.forEach(function (p) { p.classList.remove('active'); });
    if (key) {
      var el = document.getElementById('pane-' + key);
      if (el) el.classList.add('active');
    }
    renderTabs();
  }

  function timeAgo(ts) {
    var diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 5) return 'just now';
    if (diff < 60) return diff + 's ago';
    var mins = Math.floor(diff / 60);
    return mins + 'm ago';
  }

  function updateTime() {
    if (!startTime) return;
    var elapsed = Math.floor((Date.now() - startTime) / 1000);
    var m = Math.floor(elapsed / 60);
    var s = elapsed % 60;
    statusTime.textContent = m + ':' + (s < 10 ? '0' : '') + s;
  }

  function showEnded() {
    if (timerInterval) clearInterval(timerInterval);
    document.getElementById('app-screen').classList.remove('active');
    document.getElementById('ended-screen').classList.add('active');
    if (ws) {
      try { ws.close(); } catch (e) { /* ignore */ }
    }
  }
})();
