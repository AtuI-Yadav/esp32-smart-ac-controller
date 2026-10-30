/*
 * runner.js — plays a profile: moves through its steps as time passes and
 * sets the requested AC / fan state for each step.
 *
 * It only changes the *requested* state held in the app. Applying that state to
 * real hardware is the ESP32's job later; this runner can move to the device
 * and the UI can then read its status from the local REST API.
 *
 * Playback counts elapsed time (not clock times).
 */
(function (root) {
  'use strict';

  var P = root.SAC.profile;

  function create(opts) {
    var getState = opts.getState;
    var commit = opts.commit;
    var onLive = opts.onLive;

    var rt = {
      acSource: 'manual',   // 'manual' | 'profile'
      fanSource: 'manual',
      run: null             // { profileId, startedAt, elapsedMs, index } while a profile plays
    };
    var lastTick = Date.now();

    function profileOf(id) {
      return getState().profiles.filter(function (p) { return p.id === id; })[0] || null;
    }

    function applyStep(step, state) {
      var m = P.MODES[step.mode];
      state.ac.power = m.ac;
      if (m.ac) {
        state.ac.mode = step.acMode;
        state.ac.fan = step.acFan;
        if (step.acMode !== 'fan') state.ac.temp = step.temp;
      }
      state.fan.power = m.fan;
      rt.acSource = 'profile';
      rt.fanSource = 'profile';
    }

    function release() {
      rt.run = null;
      rt.acSource = 'manual';
      rt.fanSource = 'manual';
    }

    // Move the running profile to the step matching its elapsed time.
    // Returns true when devices or run state changed.
    function evaluate() {
      var run = rt.run;
      if (!run) return false;
      var state = getState(), p = profileOf(run.profileId);
      if (!p || !p.steps.length) { release(); return true; }
      var loc = P.locate(p, run.elapsedMs);
      if (loc.done) {
        state.ac.power = false;
        state.fan.power = false;
        release();
        return true;
      }
      if (loc.index === run.index) return false;
      run.index = loc.index;
      applyStep(p.steps[loc.index], state);
      return true;
    }

    function tick() {
      var t = Date.now(), dt = Math.min(t - lastTick, 5000); // ignore long gaps (sleeping tab)
      lastTick = t;
      if (rt.run) rt.run.elapsedMs += dt;
      if (evaluate()) commit(); // full re-render only when something really changed
      onLive();
    }

    function runInfo() {
      var run = rt.run;
      if (!run) return null;
      var p = profileOf(run.profileId);
      if (!p || !p.steps.length || run.index < 0) return null;
      var loc = P.locate(p, run.elapsedMs);
      if (loc.done) return null;
      var total = P.totalMinutes(p) * P.MS;
      return {
        profile: p, index: loc.index, step: p.steps[loc.index],
        next: p.steps[loc.index + 1] || null,
        remainingMs: loc.remainingMs, totalRemainingMs: loc.totalRemainingMs,
        progress: Math.min(1, run.elapsedMs / total)
      };
    }

    return {
      runtime: rt,
      now: function () { return new Date(); },
      tick: tick,
      runInfo: runInfo,
      // Manual control of a device takes it back from the running profile.
      manual: function (device) {
        if (device === 'ac') rt.acSource = 'manual';
        if (device === 'fan') rt.fanSource = 'manual';
      },
      start: function (id) {
        var p = profileOf(id);
        if (!p || !p.steps.length) return false;
        rt.run = { profileId: id, elapsedMs: 0, index: -1 };
        lastTick = Date.now();
        evaluate();
        commit();
        return true;
      },
      stop: function () {
        if (!rt.run) return;
        release();
        commit();
      },
      // Call after steps or the profile itself were edited/deleted while it may be running.
      profileEdited: function () {
        if (rt.run) {
          rt.run.index = -1; // re-apply the step that now applies
          evaluate();
        }
      }
    };
  }

  root.SAC.runner = { create: create };
})(window);
