# Load the website onto the ESP32

Web only — no hardware code. The ESP32 joins your Wi-Fi and serves the website from its flash.

## 1. One-time setup (Arduino IDE)
1. Install **Arduino IDE 2.x**.
2. File → Preferences → *Additional boards manager URLs*, add:
   `https://espressif.github.io/arduino-esp32/package_esp32_index.json`
3. Tools → Board → Boards Manager → install **esp32 by Espressif Systems**.
4. No extra libraries are needed.

## 2. Upload
1. Open `smart_ac_controller/smart_ac_controller.ino`.
2. Set `WIFI_SSID` and `WIFI_PASS` near the top.
3. Tools → Board → **ESP32 Dev Module** (or your board), pick the COM port.
4. Click Upload. If it stays on "Connecting…", hold the **BOOT** button until it starts.
5. Tools → Serial Monitor at **115200 baud**. It prints the address, for example `http://192.168.1.45`.

## 3. Open it
On a phone or laptop on the **same Wi-Fi**, open that address, or `http://smart-ac.local/`.
If the ESP32 cannot join your Wi-Fi it starts a hotspot **SmartAC-Setup** (password `12345678`); join it and open `http://192.168.4.1/`.

## After you change the website
The website is stored inside `smart_ac_controller/web_files.h`. After editing anything in `web/`, run

    python build_web_header.py

then upload the sketch again.

## Notes
- Profiles and settings are saved in each phone's browser (localStorage), not on the ESP32.
- A profile only keeps running while its page is open in a browser, because the timer is still part of the web page.
- Moving storage and the profile timer onto the ESP32 comes later.

## Using PlatformIO instead of Arduino IDE
1. Install **VS Code**, then the **PlatformIO IDE** extension (wait until it finishes installing and restart VS Code).
2. File → Open Folder → open the `esp32-smart-ac-controller` folder (the one containing `platformio.ini`).
3. Set `WIFI_SSID` / `WIFI_PASS` in `firmware/smart_ac_controller/smart_ac_controller.ino`.
4. Connect the ESP32 by USB. In the blue PlatformIO bar at the bottom of VS Code:
   - **✓** Build (first build downloads the ESP32 toolchain, which takes a few minutes)
   - **→** Upload (if it hangs on "Connecting…", hold the board's **BOOT** button)
   - **🔌** Serial Monitor (115200 baud) — it prints the IP address to open.
   Or in the PlatformIO terminal: `pio run -t upload` then `pio device monitor`.
5. Open the printed address on a phone or laptop on the same Wi-Fi.

No library installs and no filesystem-upload step are needed; the website is inside `web_files.h`.
After editing the website, run `python firmware/build_web_header.py` and upload again.

## ESP8266 (NodeMCU, Wemos D1 mini, ...)
The same sketch works on ESP8266. In Arduino IDE:
1. File → Preferences → Additional boards manager URLs, add `http://arduino.esp8266.com/stable/package_esp8266com_index.json`.
2. Boards Manager → install **esp8266 by ESP8266 Community**.
3. Tools → Board → ESP8266 Boards → **NodeMCU 1.0 (ESP-12E Module)** (or **LOLIN(WEMOS) D1 R2 & mini**).
4. Pick the port, then Upload as above. Serial Monitor: 115200 baud.
