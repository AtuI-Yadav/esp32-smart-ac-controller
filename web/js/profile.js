/*
 * profile.js — pure profile logic (no DOM, no storage).
 *
 * A profile is an ordered list of steps. Each step says what the AC and fan do
 * for a number of minutes (60 by default). When a profile is started it plays
 * its steps back to back from the first one; it is not tied to clock times.
 */
(function (root) {
  'use strict';

  var MIN_MINUTES = 5;
  var MAX_MINUTES = 720;
  var MS = 60000;
  var MODES = {
    ac_fan: { label: 'AC + Fan', ac: true, fan: true },
    ac: { label: 'AC only', ac: true, fan: false },
    fan: { label: 'Fan only', ac: false, fan: true },
    off: { label: 'Everything OFF', ac: false, fan: false }
  };

  function fmtDuration(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    if (h && m) return h + ' h ' + m + ' min';
    return h ? h + ' h' : m + ' min';
  }

  // 125 -> "2:05"; offsets shown on the step list.
  function fmtOffset(min) {
    var h = Math.floor(min / 60), m = Math.round(min % 60);
    return h + ':' + (m < 10 ? '0' : '') + m;
  }

  // m:ss for countdowns, from milliseconds.
  function fmtCountdown(ms) {
    var s = Math.max(0, Math.ceil(ms / 1000));
    var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return (h ? h + ':' + p(m) : m) + ':' + p(sec);
  }

  function usesAc(step) { return !!(MODES[step.mode] && MODES[step.mode].ac); }

  function totalMinutes(profile) {
    return profile.steps.reduce(function (sum, s) { return sum + s.minutes; }, 0);
  }

  /* Where is a profile after `elapsedMs`? -> { done, index, remainingMs, totalRemainingMs } */
  function locate(profile, elapsedMs) {
    var acc = 0, total = totalMinutes(profile) * MS;
    for (var i = 0; i < profile.steps.length; i++) {
      var end = acc + profile.steps[i].minutes * MS;
      if (elapsedMs < end) {
        return { done: false, index: i, remainingMs: end - elapsedMs, totalRemainingMs: total - elapsedMs };
      }
      acc = end;
    }
    return { done: true, index: profile.steps.length, remainingMs: 0, totalRemainingMs: 0 };
  }

  function validateStep(step) {
    var errors = {};
    var m = Number(step.minutes);
    if (!isFinite(m) || m !== Math.round(m) || m < MIN_MINUTES || m > MAX_MINUTES) {
      errors.minutes = 'Duration must be a whole number of minutes from ' + MIN_MINUTES + ' to ' + MAX_MINUTES + '.';
    }
    if (!MODES[step.mode]) errors.mode = 'Choose what should run.';
    if (usesAc(step) && step.acMode !== 'fan') {
      var t = Number(step.temp);
      if (!isFinite(t) || t !== Math.round(t) || t < 16 || t > 30) {
        errors.temp = 'Temperature must be a whole number from 16 to 30 °C.';
      }
    }
    return { errors: errors, ok: !Object.keys(errors).length };
  }

  function validateName(name, profiles, ownId) {
    var n = (name || '').trim();
    if (!n) return 'Give the profile a name.';
    if (n.length > 40) return 'Use 40 characters or fewer.';
    var dup = profiles.some(function (p) { return p.id !== ownId && p.name.toLowerCase() === n.toLowerCase(); });
    return dup ? 'Another profile already has this name.' : '';
  }

  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function newStep(base) {
    base = base || {};
    return {
      id: newId('s'), minutes: base.minutes || 60, mode: base.mode || 'ac_fan',
      temp: base.temp || 24, acMode: base.acMode || 'cool', acFan: base.acFan || 'auto'
    };
  }

  function exampleSteps() {
    return [
      newStep({ mode: 'ac_fan', temp: 24 }), newStep({ mode: 'ac', temp: 22 }),
      newStep({ mode: 'fan' }), newStep({ mode: 'off' })
    ];
  }

  function copyProfile(p, name) {
    return {
      id: newId('p'), name: name,
      steps: p.steps.map(function (s) { return Object.assign({}, s, { id: newId('s') }); })
    };
  }

  var api = {
    MIN_MINUTES: MIN_MINUTES, MAX_MINUTES: MAX_MINUTES, MS: MS, MODES: MODES,
    fmtDuration: fmtDuration, fmtOffset: fmtOffset, fmtCountdown: fmtCountdown,
    usesAc: usesAc, totalMinutes: totalMinutes, locate: locate,
    validateStep: validateStep, validateName: validateName,
    newId: newId, newStep: newStep, exampleSteps: exampleSteps, copyProfile: copyProfile
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.SAC = root.SAC || {};
  root.SAC.profile = api;
})(typeof window !== 'undefined' ? window : globalThis);
