# Test checklist

Open `index.html`. Profile steps run in real time, so for a quick test use short steps (minimum 5 minutes) or watch the countdown tick.

## Dashboard
- [ ] The dashboard shows only requested state; no sensor readings are displayed.
- [ ] AC switch toggles ON/OFF; "Requested state" updates.
- [ ] − / + change temperature and stop at 16 and 30. In Fan mode the temperature shows "—" and the buttons are disabled.
- [ ] Mode (Cool/Dry/Fan/Auto) and Fan speed (Auto/Low/Medium/High) update immediately.
- [ ] Fan switch toggles; the icon spins while ON; "Controlled by" shows Manual.

## Creating a profile
- [ ] Profiles page with no profiles shows an empty state with "New profile".
- [ ] New profile: empty name → error; duplicate name (case-insensitive) → error; valid name creates it and selects it.
- [ ] A profile with no steps shows an empty state with "Add first step" and "Add 4 example hours"; Start is disabled.
- [ ] Add step: defaults to 60 min and copies the previous step's settings. Quick buttons set 30 min / 1 h / 2 h / 3 h.
- [ ] "Fan only" and "Everything OFF" hide the AC fields; AC mode "Fan" disables the temperature field.
- [ ] Validation: duration 4 or 721 or empty → error; temperature 15, 31 or empty (when AC uses a temperature) → error; save is refused until fixed.
- [ ] Steps list shows step number, duration, start→end offsets, mode badge and settings; colour bar shows relative lengths.

## Editing
- [ ] Edit opens with the current values; Cancel / ✕ / Esc discards changes.
- [ ] Save updates the list; toast "Step saved."
- [ ] ↑ / ↓ reorder steps (disabled at the ends).
- [ ] Delete step asks for confirmation; Cancel keeps it, Delete removes it.
- [ ] Rename, Duplicate (name "… copy"), Delete profile (with confirmation) work; deleting the last profile shows the empty state.

## Running a profile
Use a profile with 5-minute steps (or the 4 example hours and wait):
- [ ] Dashboard → "Start a profile" opens the Select page with one card per profile; a profile without steps shows "Add steps" instead of Start; Start returns to the dashboard.
- [ ] Step 1 applies at once (AC ON 24°C, Fan ON); status card shows "Step 1 of 4", time left, next step, progress bar.
- [ ] When step 1 ends, step 2 applies automatically, and so on through the last step (check AC/Fan switches and "Controlled by").
- [ ] After step 4 ends the profile shows "Not running", AC and Fan are OFF, 
- [ ] Manual toggle mid-step → "Controlled by: Manual"; the next step takes control back.
- [ ] Stop: profile ends, AC/fan keep their state.
- [ ] Edit or delete steps while running: current step re-applies / profile stops if it has no steps left.

## Persistence
- [ ] Reload: profiles, steps, selected profile, AC temp/mode/fan speed and AC/fan state are unchanged (a running profile stops).
- [ ] Close and reopen the browser: same.
- [ ] Clear site data: starts with one empty "Profile 1", no errors.
- [ ] Corrupt the stored JSON in DevTools → page loads with defaults.

## Responsive & accessibility
- [ ] 360 px wide: no horizontal scroll; bottom nav; step cards stack; dialogs scroll inside the screen.
- [ ] ~768 px: two-column dashboard. ≥1000 px: three columns.
- [ ] Keyboard only: everything reachable with a visible focus ring; switches work with Space/Enter; dialogs trap focus; Esc closes.
- [ ] Dark mode (OS setting) readable everywhere.

## Phone interactions
- [ ] Buttons shrink slightly when pressed; on Android, taps give a short vibration (iOS Safari does not support vibration).
- [ ] Dashboard: press and hold − or + to run the temperature up or down quickly; the value is saved when you let go. Dragging the temperature bar previews live and saves on release.
- [ ] Step editor opens as a bottom sheet; swipe its header down to dismiss (a short swipe snaps back). − / + beside Duration change it by 15 minutes.
- [ ] While a profile runs, a floating bar with the step, countdown and Stop appears on every page except the Dashboard; tapping its name opens the Dashboard.
- [ ] Inputs do not zoom the page when focused (iOS).
- [ ] Add to Home Screen: opens full-screen with the blue theme colour.
