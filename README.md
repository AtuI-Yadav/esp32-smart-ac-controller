<h1 align="center">🌬️ ESP32 Smart AC Controller</h1>

<p align="center">
  A tiny web app that runs <b>straight from an ESP32's flash</b> to plan and control
  an air conditioner and fan with timed profiles. No cloud, no app, no extra libraries.
</p>

<p align="center">
  <img alt="ESP32" src="https://img.shields.io/badge/ESP32-supported-blue">
  <img alt="ESP8266" src="https://img.shields.io/badge/ESP8266-supported-blue">
  <img alt="Arduino" src="https://img.shields.io/badge/Arduino%20IDE-2.x-00979D">
  <img alt="PlatformIO" src="https://img.shields.io/badge/PlatformIO-ready-orange">
  <img alt="Status" src="https://img.shields.io/badge/status-demo%20phase-yellow">
</p>

---

## ✨ Features

- 📶 **Self-hosted UI**: the ESP32 joins your Wi-Fi and serves the website from flash.
- 🧩 **Profiles**: named, ordered lists of timed steps (5-720 min each).
- ❄️ **Per-step control**: AC only, Fan only, AC + Fan, or everything OFF, with temperature (16-30 °C), mode (Cool / Dry / Fan / Auto) and AC fan speed.
- ▶️ **Playback**: start a profile and it runs step by step, then switches everything OFF.
- 🔁 **Easy editing**: create, rename, duplicate, delete and reorder profiles and steps.
- 🛟 **Fallback hotspot**: if Wi-Fi fails within 15 s, the board starts `SmartAC-Setup`.
- 🌐 **mDNS**: reach it at `http://smart-ac.local/`.
- 🪶 **Zero dependencies**: plain HTML, CSS and vanilla JS. No build step for the web UI.

> ⚠️ **Demo phase:** the page shows the *requested* AC/fan state only. It does not yet talk to AC hardware or read sensors.

## 🗂️ Project structure

```
esp32-smart-ac-controller/
├── platformio.ini                 PlatformIO config (esp32dev)
├── firmware/
│   ├── smart_ac_controller/
│   │   ├── smart_ac_controller.ino   Wi-Fi + web server sketch
│   │   └── web_files.h               website embedded (gzip) - generated
│   ├── build_web_header.py           regenerates web_files.h from web/
│   └── README.md                     detailed flashing guide
└── web/                           the website (HTML / CSS / JS)
    ├── index.html
    ├── css/styles.css
    └── js/  storage.js · profile.js · runner.js · app.js
```

## 🚀 Quick start

### 1. Set your Wi-Fi

Edit the top of [`smart_ac_controller.ino`](firmware/smart_ac_controller/smart_ac_controller.ino):

```cpp
const char* WIFI_SSID = "YOUR_WIFI_NAME";
const char* WIFI_PASS = "YOUR_WIFI_PASSWORD";
```

> 🔒 Don't commit your real credentials.

### 2. Flash it

**Option A: PlatformIO (VS Code)**

```bash
pio run -t upload
pio device monitor        # 115200 baud, prints the IP address
```

**Option B: Arduino IDE 2.x**

1. Install **esp32 by Espressif Systems** in Boards Manager.
2. Open `firmware/smart_ac_controller/smart_ac_controller.ino`.
3. Select **ESP32 Dev Module**, pick the port, click **Upload**.
   If it hangs on "Connecting…", hold the **BOOT** button.

### 3. Open it

On a phone or laptop on the **same Wi-Fi**, visit the IP printed in the Serial Monitor or `http://smart-ac.local/`.

No Wi-Fi? Join **`SmartAC-Setup`** (password `12345678`) and open `http://192.168.4.1/`.

## 🛠️ Editing the website

The site is embedded in `web_files.h`. After changing anything in `web/`:

```bash
python firmware/build_web_header.py
```

then upload the sketch again. To preview without a board, just open `web/index.html` or run:

```bash
cd web && python -m http.server 8080
```

## 🔌 ESP8266 support

The same sketch works on NodeMCU / Wemos D1 mini. Install **esp8266 by ESP8266 Community**, choose your board, and upload as above.

## 🗺️ Roadmap

- [ ] Control the AC via IR / relay hardware
- [ ] Move profile storage and the timer onto the ESP32 (REST API + NVS)
- [ ] Show real device and sensor feedback

Profiles are currently stored in each browser's `localStorage`, and a profile runs only while its page is open.

## 📚 More docs

- [Firmware and flashing guide](firmware/README.md)
- [Web app details](web/README.md)
- [Web testing notes](web/TESTING.md)
