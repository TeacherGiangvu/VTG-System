/* Shared layout, login check and API calls for every page. */
(function () {
  var T = {
    en: { today: 'Today', leads: 'Leads', logout: 'Log out', overdue: 'Overdue', dueToday: 'Due today', newLeads: 'New leads',
          nothing: 'Nothing here', addLead: '+ Add lead', save: 'Save', saved: 'Saved', openLead: 'Open' },
    vi: { today: 'Hôm nay', leads: 'Khách tiềm năng', logout: 'Đăng xuất', overdue: 'Quá hạn', dueToday: 'Đến hạn hôm nay', newLeads: 'Khách mới',
          nothing: 'Chưa có gì', addLead: '+ Thêm khách', save: 'Lưu', saved: 'Đã lưu', openLead: 'Mở' }
  };
  var tr = function (k) { return (T[window.VTG_LANG] || T.en)[k] || k; };

  var esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) {} },
    del: function (k) { try { localStorage.removeItem(k); } catch (e) {} }
  };

  function api(action, data) {
    if (!window.VTG_API_URL) return Promise.reject(new Error('Set VTG_API_URL in js/config.js'));
    var body = Object.assign({ action: action, token: store.get('vtg_token') }, data || {});
    // No Content-Type header on purpose: keeps this a "simple" request, so no CORS preflight.
    return fetch(window.VTG_API_URL, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (res) {
        if (!res.ok) {
          if (res.error === 'auth') { logout(); }
          throw new Error(res.error || 'Request failed');
        }
        return res.data;
      });
  }

  function user() {
    var raw = store.get('vtg_user');
    try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }

  function logout() {
    store.del('vtg_token'); store.del('vtg_user');
    location.href = 'login.html';
  }

  function toast(msg, bad) {
    var t = document.createElement('div');
    t.className = 'toast' + (bad ? ' bad' : '');
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(function () { t.remove(); }, 2600);
  }

  // Call at the top of every page except login.
  function boot(active) {
    var u = user();
    if (!store.get('vtg_token') || !u) { location.href = 'login.html'; return null; }
    var links = [];
    if (u.role !== 'sales') links.push(['index.html', 'today']);
    links.push(['leads.html', 'leads']);
    var nav = document.createElement('header');
    nav.className = 'top';
    nav.innerHTML = '<span class="brand">VTG CRM</span>' +
      links.map(function (l) { return '<a href="' + l[0] + '"' + (l[1] === active ? ' class="on"' : '') + '>' + tr(l[1]) + '</a>'; }).join('') +
      '<span class="who">' + esc(u.name) + ' · ' + esc(u.role) + '</span><button id="logout">' + tr('logout') + '</button>';
    document.body.insertBefore(nav, document.body.firstChild);
    document.getElementById('logout').onclick = logout;
    return u;
  }

  window.VTG = { api: api, boot: boot, esc: esc, tr: tr, toast: toast, store: store, user: user };
})();
