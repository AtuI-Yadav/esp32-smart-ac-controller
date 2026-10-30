# Smart AC & Fan Controller — Website (demo phase)

Plain HTML/CSS/vanilla JS. No build step, no dependencies, no network calls.
The page shows the *requested* AC and fan state only; it does not talk to hardware yet, so it displays no sensor readings or device feedback.

## Run locally

Easiest: double-click `index.html` (works from `file://` — scripts are classic, not ES modules).

Or serve it, which is closer to how the ESP32 will deliver it:

```
cd web
python -m http.server 8080      # then open http://localhost:8080
```

## Structure

```
web/
  index.html
  css/styles.css
  js/
    storage.js      persistence (localStorage) — the only file to swap for ESP32 REST/NVS
    profile.js      pure profile logic: step validation, timing, "which step are we in"
    runner.js       plays a profile: moves through its steps and sets the requested AC/fan state
    app.js          routing, rendering, events
  assets/           (empty; for future images)
```

Scripts share one `window.SAC` namespace and load in the order shown in `index.html`.

## Profiles

A **profile** is a named, ordered list of **steps**. Each step is:

- a duration (default 60 min, 5–720 min, adjustable),
- what runs: AC only / Fan only / AC + Fan / Everything OFF,
- for AC: temperature (16–30 °C), AC mode (Cool/Dry/Fan/Auto) and AC fan speed.

You can create, rename, duplicate and delete profiles, and add, edit, reorder and delete steps.
On the Dashboard, **Start a profile** opens the **Select a profile** page (one card per profile); pressing Start on a card plays its steps back to back from step 1 and returns to the Dashboard. The Profiles page also has a Start button.

- Playback is based on **elapsed time**, not clock times or weekdays.
- When a step starts it sets the AC and fan. When the last step ends, **AC and fan switch OFF** and the profile finishes.
- **Stop** ends the profile and leaves the AC and fan as they are.
- A manual change on the dashboard takes over that device until the next step begins.
- Editing a running profile applies the step that now matches the elapsed time.
- Only one profile runs at a time; starting another replaces it.
- The running state is not saved: after a page reload the profile is not running (profiles themselves are saved).

## Persistence

`localStorage` key `smartAcController.v2` stores profiles and steps, the selected profile, and the AC/fan state and preferences. To reset: clear site data, or run `localStorage.removeItem('smartAcController.v2')` in the console.

## Moving to the ESP32 later

Replace `load()`, `save()` and `reset()` in `storage.js` with `fetch()` calls to a local REST API; their signatures are already Promise-based. The profile runner in `runner.js` would then run on the device.
