/*
 * storage.js — the ONLY module that knows where configuration lives.
 *
 * Today: browser localStorage.
 * Later: replace the bodies of load()/save()/reset() with fetch() calls to the
 * ESP32 local REST API (backed by Preferences/NVS), e.g.
 *     load: GET  /api/config      save: PUT /api/config
 * The API is already Promise-based so the UI does not need to change.
 */
(function (root) {
  'use strict';

  var KEY = 'smartAcController.v2';
  var VERSION = 2;
  var AC_MODES = ['cool', 'dry', 'fan', 'auto'];
  var FAN_SPEEDS = ['auto', 'low', 'medium', 'high'];
  var STEP_MODES = ['ac', 'fan', 'ac_fan', 'off'];

  function defaults() {
    return {
      version: VERSION,
      ac: { power: false, temp: 24, mode: 'cool', fan: 'auto' },
      fan: { power: false },
      profiles: [{ id: 'p1', name: 'Profile 1', steps: [] }],
      ui: { view: 'dashboard', profileId: 'p1' }
    };
  }

  function isObj(v) { return v && typeof v === 'object' && !Array.isArray(v); }
  function oneOf(v, list, fallback) { return list.indexOf(v) !== -1 ? v : fallback; }

  function cleanStep(s) {
    if (!isObj(s) || typeof s.id !== 'string' || STEP_MODES.indexOf(s.mode) === -1) return null;
    var minutes = Math.round(Number(s.minutes));
    if (!(minutes >= 5 && minutes <= 720)) return null;
    return {
      id: s.id, minutes: minutes, mode: s.mode,
      temp: Math.min(30, Math.max(16, Math.round(Number(s.temp)) || 24)),
      acMode: oneOf(s.acMode, AC_MODES, 'cool'),
      acFan: oneOf(s.acFan, FAN_SPEEDS, 'auto')
    };
  }

  // Merge saved data over defaults, discarding anything malformed.
  function sanitize(saved) {
    var d = defaults();
    if (!isObj(saved)) return d;

    if (isObj(saved.ac)) {
      d.ac.power = saved.ac.power === true;
      var t = Number(saved.ac.temp);
      if (t >= 16 && t <= 30) d.ac.temp = Math.round(t);
      d.ac.mode = oneOf(saved.ac.mode, AC_MODES, d.ac.mode);
      d.ac.fan = oneOf(saved.ac.fan, FAN_SPEEDS, d.ac.fan);
    }
    if (isObj(saved.fan)) d.fan.power = saved.fan.power === true;

    if (Array.isArray(saved.profiles)) {
      var ids = {};
      var list = saved.profiles.filter(function (p) {
        if (!isObj(p) || typeof p.id !== 'string' || typeof p.name !== 'string' || !p.name.trim() ||
            !Array.isArray(p.steps) || ids[p.id]) return false;
        ids[p.id] = true;
        return true;
      }).map(function (p) {
        return { id: p.id, name: p.name.trim().slice(0, 40), steps: p.steps.map(cleanStep).filter(Boolean) };
      });
      if (list.length || saved.profiles.length === 0) d.profiles = list; // an empty list is a valid choice
    }

    if (isObj(saved.ui)) {
      d.ui.view = oneOf(saved.ui.view, ['dashboard', 'profiles'], 'dashboard');
      d.ui.profileId = typeof saved.ui.profileId === 'string' ? saved.ui.profileId : '';
    }
    var known = d.profiles.some(function (p) { return p.id === d.ui.profileId; });
    if (!known) d.ui.profileId = d.profiles.length ? d.profiles[0].id : '';
    return d;
  }

  function load() {
    return new Promise(function (resolve) {
      try {
        var raw = root.localStorage.getItem(KEY);
        resolve(raw ? sanitize(JSON.parse(raw)) : defaults());
      } catch (e) {
        resolve(defaults()); // storage blocked or corrupt JSON
      }
    });
  }

  function save(state) {
    return new Promise(function (resolve) {
      try {
        root.localStorage.setItem(KEY, JSON.stringify(state));
        resolve(true);
      } catch (e) {
        resolve(false);
      }
    });
  }

  function reset() {
    return new Promise(function (resolve) {
      try { root.localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
      resolve(defaults());
    });
  }

  root.SAC = root.SAC || {};
  root.SAC.storage = { load: load, save: save, reset: reset, defaults: defaults, KEY: KEY };
})(window);
