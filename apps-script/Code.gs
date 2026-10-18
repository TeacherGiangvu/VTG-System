/**
 * VTG CRM API (Google Apps Script web app)
 * Reads/writes one Google Sheets workbook. Pages call this with fetch POST.
 * Columns are always read by header name, so new columns can be added at the end.
 */

var TABS = {
  Leads: ['id', 'created_at', 'updated_at', 'name', 'phone', 'parent_name', 'source', 'stage', 'owner', 'next_followup', 'lost_reason', 'student_code', 'note'],
  'Follow-ups': ['id', 'lead_id', 'created_at', 'by', 'note', 'due_date', 'done'],
  Config: ['type', 'name', 'value', 'role']
};
var DATE_ONLY = ['next_followup', 'due_date'];
var SESSION_SECONDS = 21600; // 6h, the CacheService maximum

// What each role may call. owner = everything.
var PERMS = {
  owner: '*',
  ta: ['today', 'leads', 'lead', 'saveLead', 'setStage', 'convert', 'addFollowup', 'doneFollowup', 'options'],
  sales: ['leads', 'lead', 'saveLead', 'setStage', 'options']
};

// ---------- entry points ----------

function doGet() {
  return json_({ ok: true, service: 'VTG CRM API' });
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    var req = JSON.parse(e.postData.contents);
    var a = req.action;
    if (a === 'login') return json_(login_(req));
    if (a === 'intake') return json_(intake_(req));

    var user = auth_(req.token);
    if (!user) return json_({ ok: false, error: 'auth' });
    if (!allowed_(user.role, a)) return json_({ ok: false, error: 'forbidden' });

    lock.waitLock(20000);
    var fn = ACTIONS[a];
    if (!fn) return json_({ ok: false, error: 'unknown_action' });
    return json_({ ok: true, data: fn(req, user) });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message || err) });
  } finally {
    try { lock.releaseLock(); } catch (x) {}
  }
}

var ACTIONS = {
  options: function () {
    return { stages: cfgList_('stage'), sources: cfgList_('source'), owners: cfgUsers_().map(function (u) { return u.name; }) };
  },

  leads: function (req, user) {
    return visibleLeads_(user);
  },

  lead: function (req, user) {
    var lead = findLead_(req.id, user);
    var fu = PERMS[user.role] === '*' || PERMS[user.role].indexOf('addFollowup') > -1
      ? readAll_('Follow-ups').filter(function (f) { return f.lead_id === lead.id; })
          .sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; })
      : [];
    return { lead: lead, followups: fu };
  },

  saveLead: function (req, user) {
    var d = req.lead || {};
    var now = now_();
    if (!d.name || !String(d.name).trim()) throw new Error('Name is required');
    var sh = sheet_('Leads');
    if (d.id) {
      var existing = findLead_(d.id, user);
      var patch = pick_(d, ['name', 'phone', 'parent_name', 'source', 'stage', 'owner', 'next_followup', 'lost_reason', 'note']);
      patch.updated_at = now;
      updateRow_(sh, existing._row, patch);
      return findLead_(d.id, user);
    }
    var lead = pick_(d, ['name', 'phone', 'parent_name', 'source', 'stage', 'owner', 'next_followup', 'lost_reason', 'note']);
    lead.id = 'L' + Utilities.getUuid().slice(0, 8);
    lead.created_at = now;
    lead.updated_at = now;
    lead.stage = lead.stage || cfgList_('stage')[0] || 'New';
    if (user.role === 'sales') lead.owner = user.name;
    appendRow_(sh, lead);
    return lead;
  },

  setStage: function (req, user) {
    var lead = findLead_(req.id, user);
    var patch = { stage: req.stage, updated_at: now_() };
    if (req.stage === 'Lost' && req.lost_reason) patch.lost_reason = req.lost_reason;
    updateRow_(sheet_('Leads'), lead._row, patch);
    return findLead_(req.id, user);
  },

  convert: function (req, user) {
    // Marks the lead as Enrolled. Writing into the 02_Hoc_vien sheet is added
    // once its exact column headers are known (see README, "Convert to student").
    var lead = findLead_(req.id, user);
    updateRow_(sheet_('Leads'), lead._row, {
      stage: 'Enrolled',
      student_code: req.student_code || lead.student_code || '',
      updated_at: now_()
    });
    return findLead_(req.id, user);
  },

  addFollowup: function (req, user) {
    var lead = findLead_(req.lead_id, user);
    if (!req.note && !req.due_date) throw new Error('Add a note or a due date');
    var fu = {
      id: 'F' + Utilities.getUuid().slice(0, 8),
      lead_id: lead.id,
      created_at: now_(),
      by: user.name,
      note: req.note || '',
      due_date: req.due_date || '',
      done: ''
    };
    appendRow_(sheet_('Follow-ups'), fu);
    if (req.due_date) updateRow_(sheet_('Leads'), lead._row, { next_followup: req.due_date, updated_at: now_() });
    return fu;
  },

  doneFollowup: function (req, user) {
    var fu = readAll_('Follow-ups').filter(function (f) { return f.id === req.id; })[0];
    if (!fu) throw new Error('Follow-up not found');
    updateRow_(sheet_('Follow-ups'), fu._row, { done: req.done === false ? '' : 'yes' });
    return true;
  },

  today: function (req, user) {
    var today = today_();
    var leads = visibleLeads_(user);
    var byId = {};
    leads.forEach(function (l) { byId[l.id] = l; });
    var due = [], overdue = [];
    readAll_('Follow-ups').forEach(function (f) {
      if (f.done || !f.due_date || !byId[f.lead_id]) return;
      var item = { id: f.id, lead_id: f.lead_id, lead_name: byId[f.lead_id].name, note: f.note, due_date: f.due_date };
      if (f.due_date < today) overdue.push(item);
      else if (f.due_date === today) due.push(item);
    });
    var fresh = leads.filter(function (l) { return l.stage === 'New'; });
    return { today: today, overdue: overdue, due: due, new_leads: fresh };
  }
};

// ---------- auth ----------

function login_(req) {
  var code = String(req.code || '').trim();
  if (!code) return { ok: false, error: 'bad_code' };
  var cache = CacheService.getScriptCache();
  var tries = Number(cache.get('tries') || 0);
  if (tries > 30) return { ok: false, error: 'locked' }; // crude brake on guessing, resets in 10 min
  var h = hash_(code);
  var user = cfgUsers_().filter(function (u) { return u.value === h; })[0];
  if (!user) {
    cache.put('tries', String(tries + 1), 600);
    return { ok: false, error: 'bad_code' };
  }
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('sess_' + token, JSON.stringify({ name: user.name, role: user.role }), SESSION_SECONDS);
  return { ok: true, data: { token: token, name: user.name, role: user.role } };
}

function auth_(token) {
  if (!token) return null;
  var raw = CacheService.getScriptCache().get('sess_' + token);
  return raw ? JSON.parse(raw) : null;
}

function allowed_(role, action) {
  var p = PERMS[role];
  return p === '*' || (p && p.indexOf(action) > -1);
}

function hash_(code) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + code);
  return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

// Public intake for the placement test / web forms. No login, so keep it narrow.
function intake_(req) {
  var cache = CacheService.getScriptCache();
  var n = Number(cache.get('intake') || 0);
  if (n > 60) return { ok: false, error: 'busy' };
  cache.put('intake', String(n + 1), 3600);
  if (req.website) return { ok: true }; // honeypot field: bots fill it, humans do not
  var d = req.lead || {};
  if (!d.name || !d.phone) return { ok: false, error: 'name_and_phone_required' };
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var now = now_();
    appendRow_(sheet_('Leads'), {
      id: 'L' + Utilities.getUuid().slice(0, 8),
      created_at: now,
      updated_at: now,
      name: clip_(d.name, 100),
      phone: clip_(d.phone, 30),
      parent_name: clip_(d.parent_name, 100),
      source: clip_(d.source, 40) || 'placement test',
      stage: 'New',
      note: clip_(d.note, 500)
    });
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

// ---------- sheet helpers ----------

function getSS_() {
  var active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('Set the SHEET_ID script property');
  return SpreadsheetApp.openById(id);
}

function sheet_(name) {
  var sh = getSS_().getSheetByName(name);
  if (!sh) throw new Error('Missing tab: ' + name + ' (run setup)');
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function readAll_(name) {
  var sh = typeof name === 'string' ? sheet_(name) : name;
  var last = sh.getLastRow();
  if (last < 2) return [];
  var h = headers_(sh);
  var tz = getSS_().getSpreadsheetTimeZone();
  return sh.getRange(2, 1, last - 1, h.length).getValues().map(function (row, i) {
    var o = { _row: i + 2 };
    h.forEach(function (key, c) {
      var v = row[c];
      if (v instanceof Date) {
        v = Utilities.formatDate(v, tz, DATE_ONLY.indexOf(key) > -1 ? 'yyyy-MM-dd' : 'yyyy-MM-dd HH:mm:ss');
      }
      o[key] = v === null || v === undefined ? '' : (typeof v === 'number' ? v : String(v));
    });
    return o;
  }).filter(function (o) { return o.id !== '' || o.type !== undefined; });
}

function appendRow_(sh, obj) {
  var h = headers_(sh);
  var row = h.map(function (k) { return obj[k] === undefined ? '' : obj[k]; });
  sh.appendRow(row);
}

function updateRow_(sh, rowNum, patch) {
  var h = headers_(sh);
  Object.keys(patch).forEach(function (k) {
    var c = h.indexOf(k);
    if (c > -1) sh.getRange(rowNum, c + 1).setValue(patch[k]);
  });
}

function pick_(obj, keys) {
  var out = {};
  keys.forEach(function (k) { if (obj[k] !== undefined) out[k] = obj[k]; });
  return out;
}

function clip_(v, n) { return String(v || '').slice(0, n); }

function visibleLeads_(user) {
  var all = readAll_('Leads');
  return user.role === 'sales' ? all.filter(function (l) { return l.owner === user.name; }) : all;
}

function findLead_(id, user) {
  var lead = visibleLeads_(user).filter(function (l) { return l.id === id; })[0];
  if (!lead) throw new Error('Lead not found');
  return lead;
}

function cfgRows_() { return readAll_('Config'); }
function cfgList_(type) {
  return cfgRows_().filter(function (r) { return r.type === type; }).map(function (r) { return r.value; });
}
function cfgUsers_() {
  return cfgRows_().filter(function (r) { return r.type === 'user'; });
}

function now_() { return Utilities.formatDate(new Date(), getSS_().getSpreadsheetTimeZone(), 'yyyy-MM-dd HH:mm:ss'); }
function today_() { return Utilities.formatDate(new Date(), getSS_().getSpreadsheetTimeZone(), 'yyyy-MM-dd'); }
function json_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }

// ---------- one-time setup (run from the Apps Script editor) ----------

/**
 * Creates the Leads, Follow-ups and Config tabs (if missing), seeds stages and
 * sources, and creates the owner account with a random access code.
 * The code is shown ONCE in a dialog / the execution log. Only its hash is stored.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());

  var ss = getSS_();
  Object.keys(TABS).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, TABS[name].length).setValues([TABS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  var leads = ss.getSheetByName('Leads');
  var phoneCol = TABS.Leads.indexOf('phone') + 1;
  leads.getRange(2, phoneCol, leads.getMaxRows() - 1, 1).setNumberFormat('@'); // keep leading zero

  var cfg = ss.getSheetByName('Config');
  var message = 'Setup done. Config already had data, so no new account was created.';
  if (cfg.getLastRow() < 2) {
    var rows = [];
    ['New', 'Contacted', 'Placement test', 'Trial', 'Enrolled', 'Lost'].forEach(function (s) { rows.push(['stage', '', s, '']); });
    ['Facebook group', 'TikTok', 'Referral', 'Placement test', 'Free funnel'].forEach(function (s) { rows.push(['source', '', s, '']); });
    var code = String(Math.floor(10000000 + Math.random() * 90000000));
    rows.push(['user', 'Giang', hash_(code), 'owner']);
    cfg.getRange(2, 1, rows.length, 4).setValues(rows);
    message = 'Setup done. Owner access code (shown once, write it down): ' + code;
  }
  Logger.log(message);
  try { SpreadsheetApp.getUi().alert(message); } catch (e) {}
}

/**
 * Adds a user. Edit the three values below, run once, then change them back.
 * role: owner | ta | sales
 */
function addUser() {
  var NAME = 'Name here', ROLE = 'sales', CODE = 'choose-a-code';
  if (NAME === 'Name here') throw new Error('Edit NAME, ROLE and CODE in addUser() first');
  appendRow_(sheet_('Config'), { type: 'user', name: NAME, value: hash_(CODE), role: ROLE });
  Logger.log('Added ' + NAME + ' (' + ROLE + ')');
}
