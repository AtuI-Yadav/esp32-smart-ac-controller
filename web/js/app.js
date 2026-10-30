/*
 * app.js — UI: routing, rendering, event handling.
 * Logic lives in profile.js / runner.js; persistence in storage.js.
 */
(function () {
  'use strict';

  var SAC = window.SAC;
  var P = SAC.profile;
  var storage = SAC.storage;

  var AC_MODES = { cool: 'Cool', dry: 'Dry', fan: 'Fan', auto: 'Auto' };
  var FAN_SPEEDS = { auto: 'Auto', low: 'Low', medium: 'Medium', high: 'High' };
    var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  var state, sim;
  var view = document.getElementById('view');
  var dialogHandlers = null; // { refresh, submit } of the open editor dialog

  /* ---------- helpers ---------- */

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function fmtClock(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()); }
  function fmtDate(d) { return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear(); }

  function profileById(id) {
    return state.profiles.filter(function (p) { return p.id === id; })[0] || null;
  }
  function selectedProfile() { return profileById(state.ui.profileId); }

  function stepSummary(s) {
    var m = P.MODES[s.mode], parts = [];
    if (m.ac) {
      parts.push(s.acMode === 'fan' ? 'AC fan mode' : 'AC ' + AC_MODES[s.acMode] + ' ' + s.temp + '°C');
      parts.push('AC fan ' + FAN_SPEEDS[s.acFan]);
    }
    if (m.fan) parts.push('Fan ON');
    return parts.length ? parts.join(' · ') : 'AC and Fan OFF';
  }

  function haptic(ms) {
    try { if (navigator.vibrate) navigator.vibrate(ms || 10); } catch (e) { /* unsupported */ }
  }

  var toastTimer;
  function toast(msg, kind) {
    var el = $('#toast');
    el.textContent = msg;
    el.className = 'toast show' + (kind ? ' ' + kind : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.className = 'toast'; }, 3500);
  }

  function confirmDialog(title, text, okLabel) {
    return new Promise(function (resolve) {
      var dlg = $('#confirmDialog');
      $('#confirmTitle').textContent = title;
      $('#confirmText').textContent = text;
      $('button[value=ok]', dlg).textContent = okLabel || 'Delete';
      dlg.returnValue = 'cancel';
      dlg.addEventListener('close', function once() {
        dlg.removeEventListener('close', once);
        resolve(dlg.returnValue === 'ok');
      });
      dlg.showModal();
    });
  }

  /* ---------- state changes ---------- */

  function currentRoute() {
    return /profiles/.test(location.hash) ? 'profiles' : /select/.test(location.hash) ? 'select' : 'dashboard';
  }

  function commit() {
    if (currentRoute() !== 'select') state.ui.view = currentRoute();
    storage.save(state).then(function (ok) {
      if (!ok) toast('Could not save — browser storage is unavailable.', 'error');
    });
    render();
  }

  function change(fn, device) {
    fn(state);
    if (device) sim.manual(device);
        commit();
  }

  function setAc(patch) { change(function (s) { Object.assign(s.ac, patch); }, 'ac'); }

  // After any profile/step edit: let a running profile pick up the change.
  function profilesChanged() {
    sim.profileEdited();
    commit();
  }

  /* ---------- components ---------- */

  function switchBtn(act, on, label) {
    return '<button type="button" role="switch" class="switch" aria-checked="' + on + '" aria-label="' + esc(label) +
      '" data-act="' + act + '" data-key="' + act + '"><span class="switch-text">' + (on ? 'ON' : 'OFF') +
      '</span><span class="knob"></span></button>';
  }

  function segmented(label, act, options, current) {
    var html = '<div class="seg" role="radiogroup" aria-label="' + esc(label) + '">';
    Object.keys(options).forEach(function (k) {
      html += '<button type="button" role="radio" aria-checked="' + (k === String(current)) + '" class="seg-btn' +
        (k === String(current) ? ' on' : '') + '" data-act="' + act + '" data-val="' + k + '" data-key="' + act + k + '">' +
        options[k] + '</button>';
    });
    return html + '</div>';
  }

  function badge(text, cls) { return '<span class="badge ' + (cls || '') + '">' + esc(text) + '</span>'; }

  function sourceLabel(src) {
    var info = sim.runInfo();
    return src === 'profile' && info ? 'Profile “' + info.profile.name + '” · step ' + (info.index + 1) : 'Manual';
  }

  /* ---------- dashboard ---------- */

  function dashboardView() {
    var rt = sim.runtime, ac = state.ac, fan = state.fan, now = sim.now();
    var info = sim.runInfo(), tempOff = ac.mode === 'fan';
    var requested = ac.power
      ? 'ON · ' + AC_MODES[ac.mode] + (tempOff ? '' : ' · ' + ac.temp + '°C') + ' · Fan ' + FAN_SPEEDS[ac.fan]
      : 'OFF';

    var h = '<h1 class="sr">Dashboard</h1><div class="grid">';

    // System status
    h += '<section class="card card-status" aria-labelledby="h-status"><h2 id="h-status">System status</h2>' +
      '<div class="clock-row"><div class="clock" data-live="clock">' + fmtClock(now) + '</div>' +
      '<div class="date" data-live="date">' + fmtDate(now) + '</div></div>' +
      '<dl class="facts">' +
      '<div><dt>Profile</dt><dd>' + (info ? badge('Running', 'on') + ' ' + esc(info.profile.name) : badge('Not running')) + '</dd></div>' +
      '<div><dt>Current step</dt><dd data-live="run-current"></dd></div>' +
      '<div><dt>Time left in step</dt><dd data-live="run-left"></dd></div>' +
      '<div><dt>Next step</dt><dd data-live="run-next"></dd></div>' +
      '</dl>' +
      '<div class="runbar" aria-hidden="true"><i data-live="run-progress"></i></div>' +
      '<div class="muted" data-live="run-total"></div>' + runActions(info) + '</section>';

    // AC card
    h += '<section class="card card-ac' + (ac.power ? ' is-on' : '') + '" aria-labelledby="h-ac">' +
      '<div class="card-head"><h2 id="h-ac"><span aria-hidden="true">❄</span> Air conditioner</h2>' +
      switchBtn('toggle-ac', ac.power, 'AC power') + '</div>' +
      '<div class="temp-ctl" role="group" aria-label="Target temperature">' +
      '<button type="button" class="round" data-act="temp-dec" data-key="temp-dec" aria-label="Decrease temperature"' +
      (ac.temp <= 16 || tempOff ? ' disabled' : '') + '>−</button>' +
      '<div class="temp-val" aria-live="polite">' + (tempOff ? '—' : ac.temp + '<span>°C</span>') + '</div>' +
      '<button type="button" class="round" data-act="temp-inc" data-key="temp-inc" aria-label="Increase temperature"' +
      (ac.temp >= 30 || tempOff ? ' disabled' : '') + '>+</button></div>' +
      '<div class="slider-wrap"><input type="range" class="slider" id="tempRange" min="16" max="30" step="1" value="' + ac.temp +
      '" aria-label="Target temperature" data-key="temp-range"' + (tempOff ? ' disabled' : '') + '>' +
      '<div class="slider-scale" aria-hidden="true"><span>16°</span><span>20°</span><span>25°</span><span>30°</span></div></div>' +
      '<p class="hint">' + (tempOff ? 'Fan mode has no target temperature.' : 'Drag the bar or use − / + (16–30 °C)') + '</p>' +
      '<div class="field"><span class="label">Mode</span>' + segmented('AC mode', 'ac-mode', AC_MODES, ac.mode) + '</div>' +
      '<div class="field"><span class="label">Fan speed</span>' + segmented('AC fan speed', 'ac-fan', FAN_SPEEDS, ac.fan) + '</div>' +
      '<dl class="facts">' +
      '<div><dt>Requested state</dt><dd>' + esc(requested) + '</dd></div>' +
      '<div><dt>Controlled by</dt><dd>' + esc(sourceLabel(rt.acSource)) + '</dd></div>' +
      '</dl></section>';

    // Fan card
    h += '<section class="card card-fan' + (fan.power ? ' is-on' : '') + '" aria-labelledby="h-fan">' +
      '<div class="card-head"><h2 id="h-fan"><span class="fan-icon' + (fan.power ? ' spin' : '') + '" aria-hidden="true">✣</span> Fan</h2>' +
      switchBtn('toggle-fan', fan.power, 'Fan power') + '</div>' +
      '<dl class="facts">' +
      '<div><dt>Requested state</dt><dd>' + (fan.power ? 'ON' : 'OFF') + '</dd></div>' +
      '<div><dt>Controlled by</dt><dd>' + esc(sourceLabel(rt.fanSource)) + '</dd></div>' +
      '</dl>' +
      (info ? '<p class="hint">A manual change takes over until the profile moves to its next step.</p>' : '') +
      '</section>';

    return h + '</div>';
  }

  function runActions(info) {
    if (info) {
      return '<div class="run-actions"><button type="button" class="btn btn-danger" data-act="stop-profile" data-key="stop-profile">■ Stop profile</button></div>';
    }
    if (!state.profiles.length) {
      return '<div class="run-actions"><a class="btn btn-primary" href="#/profiles">Create a profile</a></div>';
    }
    return '<div class="run-actions"><a class="btn btn-primary" href="#/select" data-key="goto-select">▶ Start a profile</a></div>';
  }

  /* ---------- select profile view ---------- */

  function selectView() {
    var info = sim.runInfo();
    var h = '<a class="back" href="#/dashboard">← Dashboard</a>' +
      '<div class="page-head"><div><h1 class="page-title">Select a profile</h1>' +
      '<p class="muted">Tap Start on the profile you want to run.' + (info ? ' Starting another one replaces “' + esc(info.profile.name) + '”.' : '') + '</p></div>' +
      '<a class="btn" href="#/profiles">Manage profiles</a></div>';
    if (!state.profiles.length) {
      return h + '<section class="card empty"><div class="empty-ico" aria-hidden="true">📋</div><h3>No profiles yet</h3>' +
        '<p class="muted">Create a profile and add some steps first.</p>' +
        '<div class="btn-row center"><a class="btn btn-primary" href="#/profiles">Create a profile</a></div></section>';
    }
    return h + '<div class="pcards">' + state.profiles.map(function (p) {
      var total = P.totalMinutes(p), has = p.steps.length > 0, live = info && info.profile.id === p.id;
      return '<div class="pcard' + (live ? ' live' : '') + '"><div class="pcard-top"><strong>' + esc(p.name) + '</strong>' +
        '<span class="muted">' + (has ? p.steps.length + ' step' + (p.steps.length === 1 ? '' : 's') + ' · ' + P.fmtDuration(total) : 'No steps yet') + '</span></div>' +
        (has ? '<div class="pbar pbar-sm" aria-hidden="true">' + p.steps.map(function (s) {
          return '<span class="m-' + s.mode + '" style="flex:' + s.minutes + '"></span>';
        }).join('') + '</div>' : '') +
        (live ? badge('Running now', 'on') : '') +
        (has
          ? '<button type="button" class="btn btn-primary" data-act="start-profile" data-val="' + p.id + '" data-key="start' + p.id + '">' + (live ? '↻ Restart' : '▶ Start') + '</button>'
          : '<a class="btn" href="#/profiles" data-act-link>Add steps</a>') +
        '</div>';
    }).join('') + '</div>';
  }

  /* ---------- profiles view ---------- */

  function profilesView() {
    var info = sim.runInfo();
    var h = '<h1 class="sr">Profiles</h1><div class="page-head"><div><h2 class="page-title">Profiles</h2>' +
      '<p class="muted">A profile is a list of steps. Each step says what the AC and fan do for a while, then the next step begins.</p></div>' +
      '<button type="button" class="btn btn-primary" data-act="new-profile" data-key="new-profile">+ New profile</button></div>';

    if (!state.profiles.length) {
      return h + '<section class="card empty"><div class="empty-ico" aria-hidden="true">📋</div><h3>No profiles yet</h3>' +
        '<p class="muted">Create a profile, then add steps such as “1 hour: AC 24 °C + Fan”.</p>' +
        '<div class="btn-row center"><button type="button" class="btn btn-primary" data-act="new-profile" data-key="new-profile2">+ New profile</button></div></section>';
    }

    var p = selectedProfile(), running = info && info.profile.id === p.id;
    h += '<div class="ptabs" role="tablist" aria-label="Profiles">' + state.profiles.map(function (q) {
      var on = q.id === p.id, live = info && info.profile.id === q.id;
      return '<button type="button" role="tab" aria-selected="' + on + '" class="ptab' + (on ? ' on' : '') +
        '" data-act="select-profile" data-val="' + q.id + '" data-key="tab' + q.id + '">' +
        (live ? '<span class="run-dot" title="Running"></span>' : '') + esc(q.name) + '</button>';
    }).join('') + '</div>';

    var total = P.totalMinutes(p);
    h += '<section class="card" aria-labelledby="h-prof"><div class="prof-head"><div><h3 id="h-prof">' + esc(p.name) + '</h3>' +
      '<span class="muted">' + p.steps.length + ' step' + (p.steps.length === 1 ? '' : 's') +
      (total ? ' · total ' + P.fmtDuration(total) : '') + '</span></div><div class="prof-tools">' +
      (running
        ? '<button type="button" class="btn btn-danger" data-act="stop-profile" data-key="stop-profile">■ Stop</button>'
        : '<button type="button" class="btn btn-primary" data-act="start-profile" data-val="' + p.id + '" data-key="start-profile"' +
          (p.steps.length ? '' : ' disabled') + '>▶ Start</button>') +
      '<button type="button" class="btn" data-act="rename-profile" data-key="rename-profile">Rename</button>' +
      '<button type="button" class="btn" data-act="dup-profile" data-key="dup-profile">Duplicate</button>' +
      '<button type="button" class="btn btn-danger-o" data-act="del-profile" data-key="del-profile">Delete</button></div></div>';

    if (p.steps.length) {
      h += '<div class="pbar" role="img" aria-label="Step lengths">' + p.steps.map(function (s, i) {
        return '<span class="m-' + s.mode + (running && info.index === i ? ' cur' : '') + '" style="flex:' + s.minutes +
          '" title="Step ' + (i + 1) + ': ' + esc(P.MODES[s.mode].label) + ', ' + P.fmtDuration(s.minutes) + '"></span>';
      }).join('') + '</div><ul class="legend">' + Object.keys(P.MODES).map(function (k) {
        return '<li><i class="m-' + k + '"></i>' + P.MODES[k].label + '</li>';
      }).join('') + '</ul>';
    }
    h += '</section>';

    if (!p.steps.length) {
      return h + '<section class="card empty"><div class="empty-ico" aria-hidden="true">⏱</div><h3>This profile has no steps</h3>' +
        '<p class="muted">Add your first hour, for example “AC + Fan at 24 °C for 1 hour”, then add the next one.</p>' +
        '<div class="btn-row center"><button type="button" class="btn btn-primary" data-act="add-step" data-key="add-step">+ Add first step</button>' +
        '<button type="button" class="btn" data-act="add-example" data-key="add-example">Add 4 example hours</button></div></section>';
    }

    var offset = 0;
    h += '<ol class="slots">' + p.steps.map(function (s, i) {
      var from = offset; offset += s.minutes;
      var cur = running && info.index === i;
      return '<li class="slot m-' + s.mode + (cur ? ' active' : '') + '">' +
        '<div class="slot-time"><strong>Step ' + (i + 1) + '</strong><small>' + P.fmtDuration(s.minutes) + '</small>' +
        '<small>' + P.fmtOffset(from) + ' → ' + P.fmtOffset(offset) + '</small></div>' +
        '<div class="slot-body"><div class="slot-title">' + badge(P.MODES[s.mode].label, 'mode m-' + s.mode) +
        (cur ? badge('Running now', 'on') : '') + '</div><div class="slot-sub">' + esc(stepSummary(s)) + '</div></div>' +
        '<div class="slot-actions">' +
        '<button type="button" class="btn btn-sm btn-icon" data-act="move-up" data-val="' + i + '" data-key="up' + s.id + '" aria-label="Move step ' + (i + 1) + ' up"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="btn btn-sm btn-icon" data-act="move-down" data-val="' + i + '" data-key="down' + s.id + '" aria-label="Move step ' + (i + 1) + ' down"' + (i === p.steps.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="btn btn-sm" data-act="edit-step" data-val="' + i + '" data-key="edit' + s.id + '">Edit</button>' +
        '<button type="button" class="btn btn-sm btn-danger-o" data-act="del-step" data-val="' + i + '" data-key="del' + s.id + '">Delete</button>' +
        '</div></li>';
    }).join('') + '</ol>' +
      '<div class="add-row"><button type="button" class="btn" data-act="add-step" data-key="add-step">+ Add step</button></div>';
    return h;
  }

  /* ---------- live (no re-render) updates ---------- */

  function updateLive() {
    var now = sim.now(), info = sim.runInfo();
    var set = function (key, txt) {
      $$('[data-live="' + key + '"]').forEach(function (el) { el.textContent = txt; });
    };
    set('clock', fmtClock(now));
    set('date', fmtDate(now));

    if (info) {
      set('run-current', 'Step ' + (info.index + 1) + ' of ' + info.profile.steps.length + ' · ' + P.MODES[info.step.mode].label);
      set('run-left', P.fmtCountdown(info.remainingMs));
      set('run-next', info.next ? P.MODES[info.next.mode].label + ' · ' + P.fmtDuration(info.next.minutes) : 'Last step');
      set('run-total', 'Whole profile: ' + P.fmtCountdown(info.totalRemainingMs) + ' remaining');
    } else {
      ['run-current', 'run-left', 'run-next'].forEach(function (k) { set(k, '—'); });
      set('run-total', 'No profile is running.');
    }
    var bar = $('[data-live="run-progress"]');
    if (bar) bar.style.width = (info ? info.progress * 100 : 0) + '%';
    var mini = $('[data-live="mini-progress"]');
    if (mini) mini.style.width = (info ? info.progress * 100 : 0) + '%';

    var fi = $('.fan-icon');
    if (fi) fi.classList.toggle('spin', state.fan.power);
  }

  function render() {
    var route = currentRoute();
    $$('[data-nav]').forEach(function (a) {
      if (a.dataset.nav === (route === 'select' ? 'dashboard' : route)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    var focused = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.key : null;
    var y = window.scrollY;
    view.innerHTML = route === 'profiles' ? profilesView() : route === 'select' ? selectView() : dashboardView();
    if (focused) {
      var again = $('[data-key="' + focused + '"]', view);
      if (again && !again.disabled) again.focus({ preventScroll: true });
    }
    window.scrollTo(0, y);
    renderMini(route);
    updateLive();
  }

  // Floating "now playing" bar so a running profile is visible and stoppable from any page.
  function renderMini(route) {
    var box = $('#miniRun'), info = sim.runInfo();
    var show = !!info && route !== 'dashboard';
    box.hidden = !show;
    document.body.classList.toggle('has-mini', show);
    if (!show) { box.innerHTML = ''; return; }
    box.innerHTML = '<a class="mini-info" href="#/dashboard" aria-label="Open dashboard"><strong>' + esc(info.profile.name) + '</strong>' +
      '<span><span data-live="run-current"></span> · <span data-live="run-left"></span> left</span></a>' +
      '<button type="button" class="btn btn-sm btn-danger" data-act="stop-profile" data-key="mini-stop">■ Stop</button>' +
      '<i class="mini-bar"><b data-live="mini-progress"></b></i>';
  }

  /* ---------- editor dialogs (shared shell) ---------- */

  function openDialog(html, handlers) {
    var dlg = $('#editorDialog');
    dlg.innerHTML = html;
    dialogHandlers = handlers;
    dlg.showModal();
    if (handlers.refresh) handlers.refresh();
    var first = $('input:not([type=radio]):not([type=hidden])', dlg);
    if (first) first.focus();
  }

  function closeDialog() { $('#editorDialog').close(); }

  function dialogShell(title, body, submitLabel) {
    return '<form id="dlgForm" novalidate>' +
      '<div class="dialog-head"><span class="sheet-handle" aria-hidden="true"></span><h2 id="editorTitle">' + esc(title) + '</h2>' +
      '<button type="button" class="icon-btn" data-close aria-label="Close">✕</button></div>' +
      '<div class="dialog-body">' + body + '</div>' +
      '<div class="dialog-actions"><button type="button" class="btn" data-close>Cancel</button>' +
      '<button type="submit" class="btn btn-primary">' + esc(submitLabel) + '</button></div></form>';
  }

  /* --- profile name --- */

  function openNameEditor(existing) {
    var body = '<div class="field"><label class="label" for="f-name">Profile name</label>' +
      '<input class="input" id="f-name" name="name" maxlength="40" autocomplete="off" placeholder="e.g. Summer night" value="' +
      esc(existing ? existing.name : 'Profile ' + (state.profiles.length + 1)) + '">' +
      '<p class="field-err" id="e-name" role="alert"></p></div>';

    function check() {
      var msg = P.validateName($('#f-name').value, state.profiles, existing ? existing.id : null);
      $('#e-name').textContent = msg;
      $('#f-name').setAttribute('aria-invalid', msg ? 'true' : 'false');
      return !msg;
    }
    openDialog(dialogShell(existing ? 'Rename profile' : 'New profile', body, existing ? 'Save' : 'Create profile'), {
      refresh: function () { /* validate on submit and on typing */ },
      input: check,
      submit: function () {
        if (!check()) return;
        var name = $('#f-name').value.trim();
        if (existing) {
          existing.name = name;
        } else {
          var p = { id: P.newId('p'), name: name, steps: [] };
          state.profiles.push(p);
          state.ui.profileId = p.id;
        }
        closeDialog();
        profilesChanged();
        toast(existing ? 'Profile renamed.' : 'Profile created. Add its first step.', 'ok');
      }
    });
  }

  /* --- step --- */

  function newStepDraft(p) {
    var last = p.steps[p.steps.length - 1];
    return P.newStep(last ? last : { temp: state.ac.temp, acMode: state.ac.mode, acFan: state.ac.fan });
  }

  function openStepEditor(p, index) {
    var isNew = index === null;
    var d = isNew ? newStepDraft(p) : Object.assign({}, p.steps[index]);
    var n = isNew ? p.steps.length + 1 : index + 1;

    var body = '<div class="field"><label class="label" for="f-min">Duration (minutes)</label>' +
      '<div class="stepper"><button type="button" class="round" data-nudge="-15" aria-label="15 minutes shorter">−</button>' +
      '<input class="input" type="number" id="f-min" name="minutes" min="' + P.MIN_MINUTES + '" max="' + P.MAX_MINUTES +
      '" step="5" inputmode="numeric" value="' + d.minutes + '">' +
      '<button type="button" class="round" data-nudge="15" aria-label="15 minutes longer">+</button></div>' +
      '<div class="btn-row">' + [30, 60, 120, 180].map(function (m) {
        return '<button type="button" class="btn btn-sm" data-dur="' + m + '">' + P.fmtDuration(m) + '</button>';
      }).join('') + '</div><p class="hint" id="f-dur"></p><p class="field-err" id="e-minutes" role="alert"></p></div>' +

      '<fieldset class="field"><legend class="label">What should run?</legend><div class="mode-grid">' +
      Object.keys(P.MODES).map(function (k) {
        return '<label class="mode-opt m-' + k + '"><input type="radio" name="mode" value="' + k + '"' + (d.mode === k ? ' checked' : '') + '>' +
          '<span>' + P.MODES[k].label + '</span></label>';
      }).join('') + '</div></fieldset>' +

      '<div id="acFields" class="subpanel"><div class="row3">' +
      '<div class="field"><label class="label" for="f-temp">AC temperature (°C)</label>' +
      '<input class="input" type="number" id="f-temp" name="temp" min="16" max="30" step="1" inputmode="numeric" value="' + d.temp + '"></div>' +
      '<div class="field"><label class="label" for="f-acmode">AC mode</label><select class="input" id="f-acmode" name="acMode">' +
      Object.keys(AC_MODES).map(function (k) { return '<option value="' + k + '"' + (d.acMode === k ? ' selected' : '') + '>' + AC_MODES[k] + '</option>'; }).join('') +
      '</select></div>' +
      '<div class="field"><label class="label" for="f-acfan">AC fan speed</label><select class="input" id="f-acfan" name="acFan">' +
      Object.keys(FAN_SPEEDS).map(function (k) { return '<option value="' + k + '"' + (d.acFan === k ? ' selected' : '') + '>' + FAN_SPEEDS[k] + '</option>'; }).join('') +
      '</select></div></div>' +
      '<div class="slider-wrap"><input type="range" class="slider" id="f-temprange" min="16" max="30" step="1" value="' +
      Math.min(30, Math.max(16, d.temp || 24)) + '" aria-label="AC temperature slider">' +
      '<div class="slider-scale" aria-hidden="true"><span>16°</span><span>20°</span><span>25°</span><span>30°</span></div></div>' +
      '<p class="field-err" id="e-temp" role="alert"></p><p class="hint" id="f-temp-note"></p></div>';

    function read() {
      var f = $('#dlgForm').elements;
      return {
        id: d.id, minutes: f.minutes.value === '' ? NaN : Number(f.minutes.value), mode: f.mode.value,
        temp: f.temp.value === '' ? NaN : Number(f.temp.value), acMode: f.acMode.value, acFan: f.acFan.value
      };
    }
    function refresh() {
      var s = read(), f = $('#dlgForm').elements, v = P.validateStep(s);
      $('#f-dur').textContent = v.errors.minutes ? '' : 'This step lasts ' + P.fmtDuration(s.minutes) + '.';
      $('#acFields').hidden = !P.usesAc(s);
      f.temp.disabled = s.acMode === 'fan';
      $('#f-temprange').disabled = s.acMode === 'fan';
      if (s.temp >= 16 && s.temp <= 30) $('#f-temprange').value = s.temp;
      $('#f-temp-note').textContent = s.acMode === 'fan' ? 'Fan mode does not use a target temperature.' : '';
      ['minutes', 'temp'].forEach(function (k) {
        $('#e-' + k).textContent = v.errors[k] || '';
        f[k].setAttribute('aria-invalid', v.errors[k] ? 'true' : 'false');
      });
      return v;
    }

    openDialog(dialogShell((isNew ? 'Add' : 'Edit') + ' step ' + n, body, isNew ? 'Add step' : 'Save changes'), {
      refresh: refresh,
      input: refresh,
      dur: function (m) { $('#f-min').value = m; refresh(); },
      nudge: function (n) {
        var cur = Number($('#f-min').value);
        if (!isFinite(cur)) cur = 60;
        $('#f-min').value = Math.min(P.MAX_MINUTES, Math.max(P.MIN_MINUTES, Math.round((cur + n) / 5) * 5));
        refresh();
      },
      submit: function () {
        var s = read(), v = refresh();
        if (!v.ok) { toast('Please fix the highlighted problems.', 'error'); return; }
        if (!P.usesAc(s) || s.acMode === 'fan') { if (!(s.temp >= 16 && s.temp <= 30)) s.temp = state.ac.temp; }
        if (isNew) p.steps.push(s); else p.steps[index] = s;
        closeDialog();
        profilesChanged();
        toast(isNew ? 'Step added.' : 'Step saved.', 'ok');
      }
    });
  }

  /* ---------- actions ---------- */

  function onViewClick(e) {
    var el = e.target.closest('[data-act]');
    if (!el || el.disabled || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    var act = el.dataset.act, val = el.dataset.val, p = selectedProfile();
    if ((act === 'temp-dec' || act === 'temp-inc') && e.detail !== 0) return; // pointer taps are handled by press-and-hold
    haptic(act === 'stop-profile' || act === 'del-step' || act === 'del-profile' ? 25 : 10);

    switch (act) {
      case 'toggle-ac': setAc({ power: !state.ac.power }); break;
      case 'toggle-fan': change(function (s) { s.fan.power = !s.fan.power; }, 'fan'); break;
      case 'temp-dec': setAc({ temp: Math.max(16, state.ac.temp - 1) }); break;
      case 'temp-inc': setAc({ temp: Math.min(30, state.ac.temp + 1) }); break;
      case 'ac-mode': setAc({ mode: val }); break;
      case 'ac-fan': setAc({ fan: val }); break;

      case 'start-profile': startProfile(val); break;
      case 'stop-profile': sim.stop(); toast('Profile stopped.'); break;

      case 'select-profile': state.ui.profileId = val; commit(); break;
      case 'new-profile': openNameEditor(null); break;
      case 'rename-profile': if (p) openNameEditor(p); break;
      case 'dup-profile': if (p) duplicateProfile(p); break;
      case 'del-profile': if (p) deleteProfile(p); break;

      case 'add-step': if (p) openStepEditor(p, null); break;
      case 'edit-step': if (p) openStepEditor(p, +val); break;
      case 'del-step': if (p) deleteStep(p, +val); break;
      case 'move-up': if (p) moveStep(p, +val, -1); break;
      case 'move-down': if (p) moveStep(p, +val, 1); break;
      case 'add-example':
        if (p) { p.steps = p.steps.concat(P.exampleSteps()); profilesChanged(); toast('Example hours added.', 'ok'); }
        break;

    }
  }

  function startProfile(id) {
    var p = profileById(id);
    if (!p) return;
    state.ui.profileId = id;
    if (!sim.start(id)) { toast('Add at least one step before starting this profile.', 'error'); return; }
    toast('Started “' + p.name + '”.', 'ok');
    if (currentRoute() === 'select') location.hash = '#/dashboard';
  }

  function duplicateProfile(p) {
    var names = state.profiles.map(function (q) { return q.name.toLowerCase(); });
    var name = p.name + ' copy', i = 2;
    while (names.indexOf(name.toLowerCase()) !== -1) name = p.name + ' copy ' + i++;
    var copy = P.copyProfile(p, name.slice(0, 40));
    state.profiles.push(copy);
    state.ui.profileId = copy.id;
    commit();
    toast('Profile duplicated.', 'ok');
  }

  function deleteProfile(p) {
    confirmDialog('Delete profile?', '“' + p.name + '” and its ' + p.steps.length + ' step(s) will be removed. This cannot be undone.')
      .then(function (ok) {
        if (!ok) return;
        state.profiles = state.profiles.filter(function (q) { return q.id !== p.id; });
        state.ui.profileId = state.profiles.length ? state.profiles[0].id : '';
        profilesChanged();
        toast('Profile deleted.', 'ok');
      });
  }

  function deleteStep(p, i) {
    var s = p.steps[i];
    if (!s) return;
    confirmDialog('Delete step ' + (i + 1) + '?', P.MODES[s.mode].label + ' · ' + P.fmtDuration(s.minutes) + '. This cannot be undone.')
      .then(function (ok) {
        if (!ok) return;
        p.steps.splice(i, 1);
        profilesChanged();
        toast('Step deleted.', 'ok');
      });
  }

  function moveStep(p, i, dir) {
    var j = i + dir;
    if (j < 0 || j >= p.steps.length) return;
    var t = p.steps[i]; p.steps[i] = p.steps[j]; p.steps[j] = t;
    profilesChanged();
  }

  /* ---------- temperature: live preview + press-and-hold ---------- */

  var lastSliderVal = null, hold = null;

  function previewTemp(v) {
    var el = $('.temp-val', view);
    if (el) {
      el.innerHTML = v + '<span>°C</span>';
      el.classList.remove('bump');
      void el.offsetWidth; // restart the animation
      el.classList.add('bump');
    }
    var r = $('#tempRange');
    if (r) r.value = v;
  }

  function wireTempHold() {
    view.addEventListener('pointerdown', function (e) {
      var b = e.target.closest('[data-act=temp-dec],[data-act=temp-inc]');
      if (!b || b.disabled || e.button > 0) return;
      var dir = b.dataset.act === 'temp-inc' ? 1 : -1, cur = state.ac.temp;
      var step = function () {
        var n = Math.min(30, Math.max(16, cur + dir));
        if (n === cur) return false;
        cur = n; previewTemp(cur); haptic(8);
        return true;
      };
      step();
      hold = { get value() { return cur; }, timer: setTimeout(function rep() {
        if (step()) hold.timer = setTimeout(rep, 110);
      }, 450) };
    });
    var end = function () {
      if (!hold) return;
      clearTimeout(hold.timer);
      var t = hold.value;
      hold = null;
      if (t !== state.ac.temp) setAc({ temp: t });
    };
    document.addEventListener('pointerup', end);
    document.addEventListener('pointercancel', end);
  }

  /* ---------- dialog wiring ---------- */

  function wireDialogs() {
    var dlg = $('#editorDialog');
    dlg.addEventListener('click', function (e) {
      if (e.target.closest('[data-close]') || e.target === dlg) { dlg.close(); return; }
      var dur = e.target.closest('[data-dur]');
      if (dur && dialogHandlers && dialogHandlers.dur) { haptic(8); dialogHandlers.dur(+dur.dataset.dur); }
      var nudge = e.target.closest('[data-nudge]');
      if (nudge && dialogHandlers && dialogHandlers.nudge) { haptic(8); dialogHandlers.nudge(+nudge.dataset.nudge); }
    });
    dlg.addEventListener('input', function (e) {
      if (e.target.id === 'f-temprange') $('#f-temp').value = e.target.value; // slider drives the number box
      if (e.target.type !== 'radio' && dialogHandlers && dialogHandlers.input) dialogHandlers.input();
    });
    dlg.addEventListener('change', function () {
      if (dialogHandlers && dialogHandlers.refresh) dialogHandlers.refresh();
    });
    dlg.addEventListener('submit', function (e) {
      e.preventDefault();
      if (dialogHandlers && dialogHandlers.submit) dialogHandlers.submit();
    });
    dlg.addEventListener('close', function () { dialogHandlers = null; dlg.style.transform = ''; });

    // Swipe the sheet header down to dismiss (phones).
    var drag = null;
    dlg.addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.dialog-head') || e.target.closest('button') || window.innerWidth > 599) return;
      drag = { y: e.clientY, dy: 0 };
      dlg.setPointerCapture(e.pointerId);
      dlg.style.transition = 'none';
    });
    dlg.addEventListener('pointermove', function (e) {
      if (!drag) return;
      drag.dy = Math.max(0, e.clientY - drag.y);
      dlg.style.transform = 'translateY(' + drag.dy + 'px)';
    });
    var release = function () {
      if (!drag) return;
      var close = drag.dy > 110;
      drag = null;
      dlg.style.transition = '';
      if (close) { haptic(8); dlg.close(); } else dlg.style.transform = '';
    };
    dlg.addEventListener('pointerup', release);
    dlg.addEventListener('pointercancel', release);
  }

  /* ---------- boot ---------- */

  storage.load().then(function (loaded) {
    state = loaded;
    sim = SAC.runner.create({ getState: function () { return state; }, commit: commit, onLive: updateLive });
    
    if (!location.hash) location.hash = '#/' + state.ui.view;
    window.addEventListener('hashchange', function () {
      render();
      view.focus({ preventScroll: true });
      window.scrollTo(0, 0);
    });
    view.addEventListener('click', onViewClick);
    $('#miniRun').addEventListener('click', onViewClick);
    wireTempHold();
    view.addEventListener('input', function (e) {
      if (e.target.id !== 'tempRange') return;
      previewTemp(+e.target.value); // live preview while dragging; saved on release
      if (e.target.value !== lastSliderVal) haptic(6);
      lastSliderVal = e.target.value;
    });
    view.addEventListener('change', function (e) {
      if (e.target.id === 'tempRange') setAc({ temp: +e.target.value });
    });
    wireDialogs();

    render();
    storage.save(state);
    setInterval(sim.tick, 1000);
  });
})();
