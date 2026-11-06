/*
  IR Capture — record the buttons of your AC remote

  Point the AC remote at the IR receiver and use the Serial Monitor (115200 baud,
  line ending "Newline") to record each button under a name:

      rec power_on      then press the button on the remote -> saved to flash
      list              show every saved code
      export            print all saved codes as C arrays (copy into the controller)
      csv               print all saved codes as CSV (save as .csv, open in Excel)
      del power_on      delete one code
      clear             delete all codes
      cancel            stop waiting for a press
      send power_on     transmit a saved code with the IR LED (point it at the AC)
      repeat power_on 1000   keep sending it every 1000 ms (default 1000, min 200)
      stop              stop repeating
      test              check the IR LED circuit (phone camera + loopback to the receiver)
      help              show these commands

  Presses made without "rec" are only printed, not saved. Saved codes live in
  LittleFS (/codes.txt) and survive reboots and re-uploads of this sketch.

  For each code it keeps the detected protocol (e.g. DAIKIN, VOLTAS, LG2), the
  decoded value/state, and the raw timings so even unknown protocols can be replayed.

  Wiring (VS1838B / TSOP1838 style 3-pin receiver, looking at the dome):
      OUT  -> GPIO 14   (labelled D5 on NodeMCU / Wemos D1 mini)
      GND  -> GND       (G)
      VCC  -> 3V3       (3V3, not 5V: OUT would then swing to 5V on the input pin)
  Many modules on a small PCB label the pins S / - / +  (S = OUT).
  On ESP8266 avoid D3, D4 and D8 for OUT: they decide the boot mode.

  ESP8266: pick a Flash Size with a file system, e.g. Tools > Flash Size >
  "4MB (FS:2MB OTA:~1019KB)", otherwise codes cannot be saved.

  IR LED transmitter (NPN transistor driver, e.g. 2N2222A):
      GPIO 4 (D2) -> 1k -> transistor BASE (middle leg)
      transistor EMITTER -> GND
      transistor COLLECTOR -> IR LED cathode (short leg, flat side)
      IR LED anode (long leg) -> 47-100 ohm -> 5V (VIN / VU)
  The LED resistor limits the current; without it the LED can burn out.

  Needs the "IRremoteESP8266" library (by David Conran, crankyoldgit) from the
  Arduino Library Manager. Works on ESP32 and ESP8266.
*/

#include <Arduino.h>
#include <LittleFS.h>
#include <IRrecv.h>
#include <IRsend.h>
#include <IRremoteESP8266.h>
#include <IRac.h>
#include <IRtext.h>
#include <IRutils.h>

// ======== EDIT THESE ========
const uint16_t RECV_PIN = 14;     // receiver OUT pin (D5 on ESP8266 boards)
const uint16_t SEND_PIN = 4;      // transistor base resistor (D2 on ESP8266 boards)
// ============================

// Sent by "test". Not a valid NEC command (the inverted bytes don't match), so
// TVs and ACs nearby ignore it, but the receiver still decodes it.
const uint64_t TEST_CODE = 0xA1B2C3D4;

// AC remotes send the whole state in one long message (often 100-300 marks/spaces),
// so the buffer and the end-of-message gap are bigger than for TV remotes.
const uint16_t CAPTURE_BUFFER = 1024;
const uint8_t  END_GAP_MS     = 50;   // (TIMEOUT_MS is already a macro in IRrecv.h)
const uint8_t  TOLERANCE_PCT  = 25;   // cheap receivers are a bit sloppy with timing
const uint16_t MIN_UNKNOWN    = 12;   // ignore short noise bursts (sunlight, LED lamps)

// One code per line:  name|protocol|bits|code|raw
//   code = hex state bytes (AC protocols) or hex value (simple protocols)
//   raw  = comma-separated mark/space timings in microseconds
const char* CODES_FILE = "/codes.txt";
const char* TEMP_FILE  = "/codes.tmp";

IRrecv irrecv(RECV_PIN, CAPTURE_BUFFER, END_GAP_MS, true);
IRsend irsend(SEND_PIN);
decode_results results;

String pendingName;   // name waiting for the next button press ("" = not recording)
String inputLine;     // Serial command being typed

String   repeatName;          // code being sent over and over ("" = not repeating)
uint32_t repeatEveryMs = 1000;
uint32_t lastRepeatMs  = 0;

// ---------- helpers ----------

bool validName(const String& name) {
  if (name.length() == 0 || name.length() > 24) return false;
  for (size_t i = 0; i < name.length(); i++) {
    char c = name[i];
    if (!isalnum(c) && c != '_') return false;
  }
  return true;
}

// Returns field number `index` of a "a|b|c" line.
String field(const String& line, int index) {
  int start = 0;
  for (int i = 0; i < index; i++) {
    start = line.indexOf('|', start) + 1;
    if (start == 0) return "";
  }
  int end = line.indexOf('|', start);
  return end < 0 ? line.substring(start) : line.substring(start, end);
}

String encodeCode(const decode_results& r) {
  if (!hasACState(r.decode_type)) return uint64ToString(r.value, 16);
  String hex;
  char byteHex[3];
  for (uint16_t i = 0; i < r.bits / 8; i++) {
    sprintf(byteHex, "%02X", r.state[i]);
    hex += byteHex;
  }
  return hex;
}

String encodeRaw(const decode_results& r) {
  uint16_t len = getCorrectedRawLength(&r);
  uint16_t* raw = resultToRawArray(&r);
  String out;
  out.reserve(len * 6);
  for (uint16_t i = 0; i < len; i++) {
    if (i) out += ',';
    out += raw[i];
  }
  delete[] raw;
  return out;
}

int countTimings(const String& raw) {
  if (raw.length() == 0) return 0;
  int timings = 1;
  for (size_t i = 0; i < raw.length(); i++) if (raw[i] == ',') timings++;
  return timings;
}

// Re-decodes a saved code into "Power: On, Mode: 1 (Cool), Temp: 24C, ..."
// ("" if the protocol is not an AC the library understands).
String describeCode(const String& protocol, const String& bits, const String& code) {
  decode_results r;
  memset(&r, 0, sizeof(r));
  r.decode_type = strToDecodeType(protocol.c_str());
  r.bits = bits.toInt();
  if (hasACState(r.decode_type)) {
    for (size_t i = 0; i + 1 < code.length() && i / 2 < kStateSizeMax; i += 2) {
      r.state[i / 2] = strtoul(code.substring(i, i + 2).c_str(), nullptr, 16);
    }
  } else {
    r.value = strtoull(code.c_str(), nullptr, 16);
  }
  return IRAcUtils::resultAcToString(&r);
}

// ---------- storage ----------

// Rewrites the codes file without `name`. Returns true if it was there.
bool removeCode(const String& name) {
  File in = LittleFS.open(CODES_FILE, "r");
  if (!in) return false;
  File out = LittleFS.open(TEMP_FILE, "w");
  bool found = false;
  while (in.available()) {
    String line = in.readStringUntil('\n');
    if (line.length() == 0) continue;
    if (field(line, 0) == name) found = true;
    else out.println(line);
  }
  in.close();
  out.close();
  LittleFS.remove(CODES_FILE);
  LittleFS.rename(TEMP_FILE, CODES_FILE);
  return found;
}

void saveCode(const String& name, const decode_results& r) {
  bool replaced = removeCode(name);
  File f = LittleFS.open(CODES_FILE, "a");
  if (!f) {
    Serial.println("ERROR: could not open the codes file for writing.");
    return;
  }
  f.print(name);  f.print('|');
  f.print(typeToString(r.decode_type));  f.print('|');
  f.print(r.bits);  f.print('|');
  f.print(encodeCode(r));  f.print('|');
  f.println(encodeRaw(r));
  f.close();
  Serial.printf("Saved \"%s\"%s.\n", name.c_str(), replaced ? " (replaced the old one)" : "");
}

void listCodes() {
  File f = LittleFS.open(CODES_FILE, "r");
  int count = 0;
  while (f && f.available()) {
    String line = f.readStringUntil('\n');
    if (line.length() == 0) continue;
    Serial.printf("  %-24s %-16s %4s bits  %4d timings\n",
                  field(line, 0).c_str(), field(line, 1).c_str(), field(line, 2).c_str(),
                  countTimings(field(line, 4)));
    count++;
  }
  if (f) f.close();
  if (count == 0) Serial.println("  (no codes saved yet - use: rec <name>)");
}

// Prints every saved code as C arrays, ready to paste into a header file.
void exportCodes() {
  File f = LittleFS.open(CODES_FILE, "r");
  if (!f) {
    Serial.println("(no codes saved yet)");
    return;
  }
  Serial.println("// ===== IR codes - copy from here =====");
  while (f.available()) {
    String line = f.readStringUntil('\n');
    if (line.length() == 0) continue;
    String name = field(line, 0);
    String protocol = field(line, 1);
    String code = field(line, 3);
    String id = "IR_" + name;
    id.toUpperCase();

    Serial.printf("\n// %s: %s, %s bits\n", name.c_str(), protocol.c_str(), field(line, 2).c_str());
    if (hasACState(strToDecodeType(protocol.c_str()))) {
      Serial.printf("const uint8_t %s_STATE[] = {", id.c_str());
      for (size_t i = 0; i + 1 < code.length(); i += 2) {
        Serial.printf("%s0x%s", i ? ", " : "", code.substring(i, i + 2).c_str());
      }
      Serial.println("};");
    } else {
      Serial.printf("const uint64_t %s_VALUE = 0x%s;\n", id.c_str(), code.c_str());
    }
    Serial.printf("const uint16_t %s_RAW[] = {%s};\n", id.c_str(), field(line, 4).c_str());
  }
  f.close();
  Serial.println("\n// ===== IR codes - copy until here =====");
}

// Prints every saved code as CSV. The code gets a "0x" prefix so Excel keeps it
// as text (otherwise e.g. "1E40" becomes a number in scientific notation).
void exportCsv() {
  File f = LittleFS.open(CODES_FILE, "r");
  if (!f) {
    Serial.println("(no codes saved yet)");
    return;
  }
  Serial.println("===== CSV - copy from the next line =====");
  Serial.println("name,protocol,bits,code,decoded,timings,raw");
  while (f.available()) {
    String line = f.readStringUntil('\n');
    if (line.length() == 0) continue;
    String protocol = field(line, 1);
    String bits = field(line, 2);
    String code = field(line, 3);
    String raw = field(line, 4);
    Serial.print(field(line, 0));                          Serial.print(',');
    Serial.print(protocol);                                Serial.print(',');
    Serial.print(bits);                                    Serial.print(",0x");
    Serial.print(code);                                    Serial.print(",\"");
    Serial.print(describeCode(protocol, bits, code));      Serial.print("\",");
    Serial.print(countTimings(raw));                       Serial.print(",\"");
    Serial.print(raw);                                     Serial.println('"');
  }
  f.close();
  Serial.println("===== CSV - copy until the line above =====");
}

// ---------- sending ----------

// Finds the saved line for `name`. Returns "" if there is none.
String findCode(const String& name) {
  File f = LittleFS.open(CODES_FILE, "r");
  while (f && f.available()) {
    String line = f.readStringUntil('\n');
    if (line.length() && field(line, 0) == name) {
      f.close();
      return line;
    }
  }
  if (f) f.close();
  return "";
}

// Sends a saved code: with its protocol when known (cleanest signal),
// otherwise by replaying the raw timings at 38 kHz.
void sendCode(const String& name) {
  String line = findCode(name);
  if (line.length() == 0) {
    Serial.println("No code with that name (see: list).");
    return;
  }
  decode_type_t type = strToDecodeType(field(line, 1).c_str());
  uint16_t bits = field(line, 2).toInt();
  String code = field(line, 3);

  irrecv.disableIRIn();   // don't record our own transmission
  bool sent = false;
  if (type != decode_type_t::UNKNOWN) {
    if (hasACState(type)) {
      uint8_t state[kStateSizeMax] = {0};
      for (size_t i = 0; i + 1 < code.length() && i / 2 < kStateSizeMax; i += 2) {
        state[i / 2] = strtoul(code.substring(i, i + 2).c_str(), nullptr, 16);
      }
      sent = irsend.send(type, state, bits / 8);
    } else {
      sent = irsend.send(type, strtoull(code.c_str(), nullptr, 16), bits);
    }
  }
  if (sent) {
    Serial.printf("Sent \"%s\" as %s.\n", name.c_str(), typeToString(type).c_str());
  } else {
    String raw = field(line, 4);
    uint16_t len = countTimings(raw);
    uint16_t* timings = new uint16_t[len];
    int start = 0;
    for (uint16_t i = 0; i < len; i++) {
      int comma = raw.indexOf(',', start);
      timings[i] = (comma < 0 ? raw.substring(start) : raw.substring(start, comma)).toInt();
      start = comma + 1;
    }
    irsend.sendRaw(timings, len, 38);
    delete[] timings;
    Serial.printf("Sent \"%s\" as raw timings (%d).\n", name.c_str(), len);
  }
  irrecv.enableIRIn();
}

// Empties anything the receiver has captured so far.
void flushReceiver() {
  while (irrecv.decode(&results)) yield();
}

// Step 1: flash the LED for a phone camera. Step 2: send a test code and check
// that our own receiver decodes it (LED pointed at the receiver).
void runTest() {
  Serial.println("TEST 1/2 - camera: look at the IR LED through a phone camera");
  Serial.println("  (front camera works best). It should flicker purple/white for 5 s...");
  uint32_t start = millis();
  while (millis() - start < 5000) {
    irsend.sendNEC(TEST_CODE, kNECBits);
    delay(40);
  }
  Serial.println("  Done. Saw the flicker = LED + transistor work. Nothing = check the wiring.");

  Serial.println("TEST 2/2 - loopback: point the IR LED at the receiver, 5-30 cm away.");
  delay(3000);
  int passed = 0;
  for (int attempt = 1; attempt <= 5; attempt++) {
    flushReceiver();
    irsend.sendNEC(TEST_CODE, kNECBits);
    bool got = false;
    uint32_t waitStart = millis();
    while (millis() - waitStart < 300) {
      if (irrecv.decode(&results)) {
        got = results.decode_type == decode_type_t::NEC && results.value == TEST_CODE;
        Serial.printf("  Attempt %d: received %s 0x%s -> %s\n", attempt,
                      typeToString(results.decode_type).c_str(),
                      uint64ToString(results.value, 16).c_str(), got ? "OK" : "garbled");
        break;
      }
      yield();
    }
    if (!got && millis() - waitStart >= 300) Serial.printf("  Attempt %d: nothing received\n", attempt);
    if (got) passed++;
    delay(200);
  }
  flushReceiver();

  if (passed >= 4) {
    Serial.printf("PASS (%d/5): the transmitter works. Try  send power_on  pointed at the AC.\n", passed);
  } else if (passed > 0) {
    Serial.printf("WEAK (%d/5): signal gets through sometimes. Check the LED resistor and aim, "
                  "or move closer.\n", passed);
  } else {
    Serial.println("FAIL (0/5): nothing decoded. If test 1 flickered, check the receiver;");
    Serial.println("  otherwise check the transmitter wiring (see the top of this sketch).");
  }
}

// ---------- commands ----------

void printHelp() {
  Serial.println("Commands:  rec <name> | list | export | csv | del <name> | clear | cancel");
  Serial.println("           send <name> | repeat <name> [ms] | stop | test | help");
  Serial.println("Names: letters, digits and _ only, e.g. power_on, cool_24, fan_high");
}

void handleCommand(String line) {
  line.trim();
  if (line.length() == 0) return;
  int space = line.indexOf(' ');
  String cmd = space < 0 ? line : line.substring(0, space);
  String arg = space < 0 ? "" : line.substring(space + 1);
  cmd.toLowerCase();
  arg.trim();

  if (cmd == "rec") {
    if (!validName(arg)) {
      Serial.println("Usage: rec <name>   (letters, digits and _ only, max 24 chars)");
      return;
    }
    pendingName = arg;
    Serial.printf("Recording \"%s\": press the button on the remote now...\n", arg.c_str());
  } else if (cmd == "cancel") {
    pendingName = "";
    Serial.println("Recording cancelled.");
  } else if (cmd == "list") {
    listCodes();
  } else if (cmd == "export") {
    exportCodes();
  } else if (cmd == "csv") {
    exportCsv();
  } else if (cmd == "send") {
    sendCode(arg);
  } else if (cmd == "repeat") {
    int split = arg.indexOf(' ');
    String name = split < 0 ? arg : arg.substring(0, split);
    long every = split < 0 ? 1000 : arg.substring(split + 1).toInt();
    if (findCode(name).length() == 0) {
      Serial.println("Usage: repeat <name> [ms]   (name must be saved, see: list)");
      return;
    }
    repeatName = name;
    repeatEveryMs = every < 200 ? 200 : every;   // leave the AC time to read each frame
    lastRepeatMs = millis() - repeatEveryMs;      // send the first one right away
    Serial.printf("Sending \"%s\" every %u ms. Type  stop  to end.\n",
                  name.c_str(), (unsigned)repeatEveryMs);
  } else if (cmd == "stop") {
    repeatName = "";
    Serial.println("Stopped repeating.");
  } else if (cmd == "test") {
    runTest();
  } else if (cmd == "del") {
    if (arg == repeatName) repeatName = "";
    Serial.println(removeCode(arg) ? "Deleted." : "No code with that name.");
  } else if (cmd == "clear") {
    repeatName = "";
    LittleFS.remove(CODES_FILE);
    Serial.println("All codes deleted.");
  } else if (cmd == "help") {
    printHelp();
  } else {
    Serial.println("Unknown command.");
    printHelp();
  }
}

void readSerial() {
  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\r') continue;
    if (c == '\n') {
      handleCommand(inputLine);
      inputLine = "";
    } else if (inputLine.length() < 64) {
      inputLine += c;
    }
  }
}

// ---------- main ----------

void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.printf("IR Capture - receiver on GPIO %d, IR LED on GPIO %d.\n", RECV_PIN, SEND_PIN);

#if defined(ESP8266)
  bool fsOk = LittleFS.begin();
#else
  bool fsOk = LittleFS.begin(true);   // formats the partition on first use
#endif
  if (!fsOk) Serial.println("ERROR: LittleFS failed to start, codes cannot be saved.");

  irrecv.setUnknownThreshold(MIN_UNKNOWN);
  irrecv.setTolerance(TOLERANCE_PCT);
  irrecv.enableIRIn();
  irsend.begin();

  printHelp();
  Serial.println("Saved codes:");
  listCodes();
}

void loop() {
  readSerial();
  if (repeatName.length() && millis() - lastRepeatMs >= repeatEveryMs) {
    lastRepeatMs = millis();
    sendCode(repeatName);
  }
  if (!irrecv.decode(&results)) return;

  Serial.println("--------------------------------------------------");
  Serial.print(resultToHumanReadableBasic(&results));   // protocol + code
  String acState = IRAcUtils::resultAcToString(&results);
  if (acState.length()) Serial.println("Decoded AC state: " + acState);

  if (results.overflow) {
    Serial.printf("WARNING: message longer than the %d-entry buffer, raise CAPTURE_BUFFER. Not saved.\n", CAPTURE_BUFFER);
  } else if (pendingName.length()) {
    saveCode(pendingName, results);
    pendingName = "";
  } else {
    Serial.println("(not saved - type  rec <name>  first)");
  }
  yield();
}
