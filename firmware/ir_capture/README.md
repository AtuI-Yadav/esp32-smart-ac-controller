# 📡 IR Capture: record your AC remote

A small standalone sketch that records the buttons of an AC remote with an IR receiver (TSOP / VS1838B), saves them to the board's flash, and exports them as C arrays for the controller firmware.

It runs separately from the web server sketch (`smart_ac_controller.ino`): flash this one, record your codes, then flash the controller again.

## ✨ What it does

- Detects the remote's **protocol** (DAIKIN, VOLTAS, LG2, MITSUBISHI_AC, … 100+ supported).
- Decodes the **AC state** when the protocol is known: power, mode, temperature, fan.
- Saves each button under a **name** you choose, in flash, so codes survive reboots and re-uploads.
- Keeps the **raw timings** too, so even an unknown protocol can be replayed later.
- **Exports** everything as ready-to-paste C arrays.

Works on **ESP8266** (NodeMCU, Wemos D1 mini) and **ESP32**.

## 🧰 What you need

- ESP8266 or ESP32 board + USB cable
- IR receiver: TSOP module, bare TSOP sensor, or VS1838B (38 kHz recommended)
- 3 jumper wires
- Your AC remote

## 🔌 Wiring

### TSOP module (small PCB with labelled pins)

| Module pin | ESP8266 (NodeMCU / D1 mini) | ESP32 |
|---|---|---|
| `S` / `OUT` | **D5** (GPIO 14) | GPIO 14 |
| `−` / `GND` | G | GND |
| `+` / `VCC` | 3V3 (5V for TSOP17xx, see below) | 3V3 |

### Bare TSOP sensor (3 legs)

Hold it with the **dome facing you, legs down**; pins count 1-2-3 from left to right. The order depends on the part number printed on the front:

| Part number | Pin 1 | Pin 2 | Pin 3 | Supply |
|---|---|---|---|---|
| TSOP1738, TSOP1736 (**17xx** series) | GND | VCC | OUT | **5V only** (4.5–5.5 V) |
| TSOP1838, TSOP38238, TSOP4838, VS1838B | OUT | GND | VCC | 3V3 |

> ⚠️ Check the part number before wiring: reversed power can kill the sensor.

**TSOP17xx (5V parts):** power VCC from the board's `VIN` / `VU` 5V pin (USB-powered), and connect OUT directly to D5. The sensor's built-in pull-up resistor keeps the current into the pin tiny, which is harmless in practice. Don't add a voltage divider: combined with that pull-up, it pulls the "high" level too low to read.

**Pins to avoid on ESP8266:** D3, D4, D8. They set the boot mode, and a receiver on them can stop the board from starting.

**Frequency:** the last two digits are the carrier frequency (`…38` = 38 kHz). Nearly all AC remotes use 38 kHz; a 36/40 kHz sensor still works, but only at short range (under about 1 m).

To use a different pin, change `RECV_PIN` at the top of `ir_capture.ino`.

## 🛠️ Setup (Arduino IDE 2.x)

1. **Install the library:** *IRremoteESP8266* by David Conran (crankyoldgit). Use Library Manager, or for the newest fixes clone it into `Documents/Arduino/libraries`:
   ```bash
   git clone --depth 1 https://github.com/crankyoldgit/IRremoteESP8266.git
   ```
   Restart the IDE afterwards.
2. **Open** `firmware/ir_capture/ir_capture.ino`.
3. **Pick the board** under Tools → Board:
   - ESP8266: *NodeMCU 1.0 (ESP-12E Module)* or *LOLIN(WEMOS) D1 mini*
   - ESP32: *ESP32 Dev Module*
4. **ESP8266 only:** Tools → Flash Size → choose one **with a file system**, e.g. `4MB (FS:2MB OTA:~1019KB)`. Without a file system, codes cannot be saved.
5. Select the port and click **Upload**.
6. Open the **Serial Monitor**: `115200` baud, line ending **Newline**.

## ▶️ Recording codes

On startup the sketch prints the commands and any codes already saved. To record a button:

```
rec power_on
```

then press the button on the remote, pointed at the receiver from about 30 cm away. You'll see something like:

```
--------------------------------------------------
Protocol  : VOLTAS
Code      : 0x33284F6E3B3B00C000C3 (80 Bits)
Decoded AC state: Model: 1 (122LZF), Power: On, Mode: 8 (Cool), Temp: 24C, Fan: 1 (High), ...
Saved "power_on".
```

Presses made without `rec` are printed but **not saved**, which is handy for checking that the receiver works.

### Commands

| Command | What it does |
|---|---|
| `rec <name>` | Saves the next button press under `<name>` (re-recording a name replaces it) |
| `list` | Lists saved codes: name, protocol, bits, number of timings |
| `export` | Prints every saved code as C arrays |
| `csv` | Prints every saved code as CSV, to open in Excel |
| `del <name>` | Deletes one code |
| `clear` | Deletes all codes |
| `cancel` | Stops waiting for a press |
| `send <name>` | Transmits a saved code with the IR LED (see [Transmitter](#-transmitter-ir-led)) |
| `repeat <name> [ms]` | Keeps sending a saved code every `ms` milliseconds (default 1000, min 200) |
| `stop` | Stops `repeat` |
| `test` | Checks the IR LED circuit: phone-camera flicker + loopback to the receiver |
| `help` | Shows the commands |

Names: letters, digits and `_` only, max 24 characters (e.g. `power_off`, `cool_24_auto`, `fan_high`).

### What to record

Most AC remotes send the **complete state** (power + mode + temperature + fan) on every press, not just "the button that was pressed". So record the **combinations you actually want to use**, e.g.:

```
off
cool_24_auto
cool_26_low
dry_25
fan_only
```

If the protocol is **known** (shown by name, with a "Decoded AC state" line), the library can generate any setting itself, so a few samples are enough. If it's **UNKNOWN**, the raw timings are all we have, so record every combination you need.

## 📤 Exporting

`export` prints something like:

```c
// ===== IR codes - copy from here =====

// power_on: VOLTAS, 80 bits
const uint8_t IR_POWER_ON_STATE[] = {0x33, 0x28, 0x4F, 0x6E, 0x3B, 0x3B, 0x00, 0xC0, 0x00, 0xC3};
const uint16_t IR_POWER_ON_RAW[] = {1002, 584, 1000, 586, ...};

// ===== IR codes - copy until here =====
```

- `_STATE[]`: AC protocols (full state bytes), sendable with the protocol's own send function.
- `_VALUE`: simple protocols (NEC, Samsung, …) that fit in 64 bits.
- `_RAW[]`: mark/space timings in µs, replayable with `IRsend::sendRaw(raw, len, 38)` whatever the protocol.

Copy the block into a header file for the controller firmware.

### To Excel

`csv` prints all codes as CSV, one row per code:

```
name,protocol,bits,code,decoded,timings,raw
power_on,VOLTAS,80,0x33284F6E3B3B00C000C3,"Power: On, Mode: 8 (Cool), Temp: 24C, ...",163,"1002,584,1000,..."
power_off,VOLTAS,80,0x33A84F6E3B3B00C00043,"Power: Off, Mode: 8 (Cool), Temp: 24C, ...",163,"1000,586,998,..."
```

1. Type `csv` in the Serial Monitor.
2. Select the lines **between** the two `===== CSV =====` markers (header row included) and copy them.
3. Paste them into Notepad and save as `ac_codes.csv` (*Save as type: All files*, encoding UTF-8).
4. Double-click the file to open it in Excel.

| Column | Meaning |
|---|---|
| `name` | Name you gave with `rec` |
| `protocol` | Detected protocol (`UNKNOWN` if not recognised) |
| `bits` | Message length in bits |
| `code` | Hex state/value, prefixed `0x` so Excel keeps it as text |
| `decoded` | Power, mode, temperature, fan… (empty if the protocol isn't a known AC) |
| `timings` | Number of raw mark/space timings |
| `raw` | Raw timings in µs (replayable even for `UNKNOWN` protocols) |

Sorting by `decoded` or comparing the `code` column is an easy way to check, for example, whether `power_on` and `power_off` really differ.

### Storage format

Codes are kept in LittleFS at `/codes.txt`, one line per code:

```
name|protocol|bits|code|raw
```

`code` is hex (state bytes or value); `raw` is comma-separated timings. `clear` removes the file.

## 🩺 Troubleshooting

| Symptom | Fix |
|---|---|
| `IRrecv.h: No such file or directory` | Library not installed. See Setup step 1, then restart the IDE. |
| `LittleFS failed to start` (ESP8266) | Choose a Flash Size with FS (Setup step 4) and upload again. |
| Nothing printed when pressing buttons | Check OUT is on D5 / GPIO 14, the sensor's supply voltage (TSOP17xx needs 5V) and pin order; try the remote closer; check the remote's battery with a phone camera (the IR LED blinks purple). |
| Random short `UNKNOWN` codes with no button pressed | Noise from sunlight or LED/CFL lamps. Shade the sensor, or raise `MIN_UNKNOWN`. |
| `WARNING: message longer than the buffer` | Raise `CAPTURE_BUFFER` (e.g. 2048). |
| Same button gives slightly different codes | Normal for some remotes (timer/clock bytes). Record again close to the sensor; if the protocol is known, use the decoded state. |
| Protocol is `UNKNOWN` | Fine: the raw timings still replay. Try raising `TOLERANCE_PCT` to 30–35 to see if it then matches a known protocol. |

## 💡 Transmitter (IR LED)

An ESP8266 pin can only give a few mA, so the IR LED is switched by an NPN transistor (2N2222A).

```
D2 (GPIO 4) ──[ 1kΩ ]── BASE
                         2N2222A
                        EMITTER ── GND
                       COLLECTOR ── IR LED cathode (short leg, flat side)
                                    IR LED anode (long leg) ──[ 47–100Ω ]── 5V (VIN / VU)
```

- **2N2222A pins vary by maker** (flat face towards you, legs down): `PN2222A` = E-B-C, `P2N2222A` = C-B-E. The base is always in the middle; check the datasheet for the marking on yours.
- **Don't skip the LED resistor.** The transistor can pass a few hundred mA and will burn the LED. 47 Ω at 5V ≈ 70 mA pulses, which gives good range.
- The pin is set by `SEND_PIN` at the top of the sketch.

### Testing the circuit

Type `test` in the Serial Monitor:

1. **Camera test (5 s):** look at the LED through a phone camera; the front camera works best, since many rear cameras filter IR. A purple/white flicker means the LED and transistor are switching.
2. **Loopback test:** point the IR LED at your own TSOP receiver, 5–30 cm away. The sketch sends a test code 5 times and checks that the receiver decodes it:
   ```
   Attempt 1: received NEC 0xA1B2C3D4 -> OK
   ...
   PASS (5/5): the transmitter works. Try  send power_on  pointed at the AC.
   ```
   The test code is deliberately not a valid NEC command, so nearby TVs and ACs ignore it.

| Result | Meaning |
|---|---|
| Flicker + PASS | Transmitter works. Try `send power_on` at the AC. |
| Flicker + WEAK / FAIL | LED works but the signal is weak: check the LED resistor, its polarity, the aim and the distance. |
| No flicker + FAIL | Check the transistor pins (E/B/C), the LED polarity, the 1 kΩ on D2, and the common GND. |

### Controlling the AC

```
send power_on
send power_off
```

Point the LED at the AC's receiver window, starting at 1–2 m. Known protocols are re-encoded from the decoded state, which gives the cleanest signal; `UNKNOWN` ones replay the raw timings at 38 kHz.

## ➡️ Next step

Use the exported codes in the controller sketch to switch the AC from the web UI.
