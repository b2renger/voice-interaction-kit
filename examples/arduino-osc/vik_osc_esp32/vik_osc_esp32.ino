/*
  VIK <-> an ESP32 over WiFi: the board of vik_osc_room.ino (the room's temperature, the fan), without a cable,
  and a button that makes the agent speak.

  Sends    /arduino/button <1 pressed, 0 released> to VIK: the agent's pattern "Button pressed" greets whoever
           pressed it, at the next pause (VIK: Settings > OSC > Listen on port 9000).
           /arduino/temp <float, degrees C> twice a second.
  Receives /arduino/fan <0 or 1> on UDP port 8000 and switches the LED (a relay or MOSFET module for a real fan).
           Then tells VIK the fan's state: /arduino/fan/state <0 or 1>.

  Hardware : an ESP32 DevKit (the classic ESP32). Nothing to wire to try it: the button is the board's BOOT
             button (GPIO 0), the "fan" its blue LED (GPIO 2).
             Optional: a potentiometer on GPIO 34 (its ends on 3V3 and GND, never 5V) fakes the temperature, from
             15 to 40 C: turn it to "heat" the room. Or a TMP36 on GPIO 34, powered from 3V3 (POTENTIOMETER false).
             Unwired, GPIO 34 floats: the temperature wanders, and may cross 28 C.
             Another ESP32 (S3, C3...): change the three pins below to those of your board (BOOT is GPIO 9 on a C3;
             the analog pin must be an ADC1 pin: ADC2 pins do not read while the WiFi is on).
  Libraries: WiFi (comes with the ESP32 boards), OSC by Adrian Freed / CNMAT (Library Manager: "OSC").

  Network  : the ESP32 and the computer running VIK on the same WiFi network, a 2.4 GHz one (the ESP32 has no
             5 GHz). Fill WIFI_NAME, WIFI_PASSWORD and VIK_HOST below. The serial monitor (115200 baud) prints
             this board's address: put it in VIK's Settings > OSC > Send to, with port 8000.
             Full walkthrough: examples/arduino-osc/README.md.
*/

#include <WiFi.h>
#include <WiFiUdp.h>
#include <OSCMessage.h>

const char *WIFI_NAME = "your-wifi";                   // the network's name (2.4 GHz)
const char *WIFI_PASSWORD = "your-password";
IPAddress VIK_HOST(192, 168, 1, 20);                   // the computer running VIK, on this network ("ipconfig": IPv4)
const unsigned int VIK_PORT = 9000;                    // = VIK's Settings > OSC > Listen on port
const unsigned int LOCAL_PORT = 8000;                  // = the port in VIK's Settings > OSC > Send to (<this board>:8000)
const int BUTTON_PIN = 0;                              // the BOOT button (or a push button between this pin and GND)
const int SENSOR_PIN = 34;                             // an ADC1 pin
const int FAN_PIN = 2;                                 // the blue LED of the DevKit (or an LED + 220 ohm resistor)
const bool POTENTIOMETER = true;                       // true: a potentiometer fakes 15-40 C; false: a TMP36

WiFiUDP Udp;
unsigned long lastSend = 0;
int buttonWas = HIGH;                                  // INPUT_PULLUP: HIGH released, LOW pressed
unsigned long buttonAt = 0;

void setup() {
  Serial.begin(115200);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(BUTTON_PIN, INPUT_PULLUP);

  Serial.print("WiFi: connecting to ");
  Serial.println(WIFI_NAME);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_NAME, WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");                                 // dots forever: the name or the password, or a 5 GHz network
  }
  Serial.println();
  Serial.print("ESP32 IP: ");
  Serial.print(WiFi.localIP());
  Serial.println("  (in VIK, Settings > OSC > Send to: this address, port 8000)");

  Udp.begin(LOCAL_PORT);
}

float readTemperature() {
  if (POTENTIOMETER) return 15.0 + analogRead(SENSOR_PIN) * 25.0 / 4095.0;   // 12 bits: 0..4095
  return ((int) analogReadMilliVolts(SENSOR_PIN) - 500) / 10.0;               // TMP36: 500 mV at 0 C, 10 mV per degree
}

void sendToVik(OSCMessage &msg) {
  Udp.beginPacket(VIK_HOST, VIK_PORT);
  msg.send(Udp);
  Udp.endPacket();
  msg.empty();
}

void loop() {
  // the WiFi dropped (the router restarting): the ESP32 reconnects by itself, nothing is sent meanwhile
  if (WiFi.status() != WL_CONNECTED) {
    delay(100);
    return;
  }

  // 1. the button: 1 when it is pressed, 0 when it is released (VIK's pattern fires once per press)
  int button = digitalRead(BUTTON_PIN);
  if (button != buttonWas && millis() - buttonAt > 30) {   // a button bounces: a change within 30 ms is ignored
    buttonWas = button;
    buttonAt = millis();
    OSCMessage msg("/arduino/button");
    msg.add((int32_t) (button == LOW ? 1 : 0));
    sendToVik(msg);
    Serial.println(button == LOW ? "button pressed" : "button released");
  }

  // 2. the temperature, twice a second
  if (millis() - lastSend >= 500) {
    lastSend = millis();
    float t = readTemperature();
    OSCMessage msg("/arduino/temp");
    msg.add(t);
    sendToVik(msg);
  }

  // 3. the fan, when VIK says so
  int size = Udp.parsePacket();
  if (size > 0) {
    OSCMessage msg;
    while (size--) msg.fill(Udp.read());
    if (!msg.hasError()) {
      msg.dispatch("/arduino/fan", fanCallback);
    } else {
      Serial.print("OSC error: ");
      Serial.println(msg.getError());
    }
  }
}

void fanCallback(OSCMessage &msg) {
  int on = 0;
  if (msg.isInt(0))          on = msg.getInt(0);
  else if (msg.isFloat(0))   on = msg.getFloat(0) > 0.5;
  else if (msg.isBoolean(0)) on = msg.getBoolean(0);

  digitalWrite(FAN_PIN, on ? HIGH : LOW);
  Serial.print("fan ");
  Serial.println(on);

  // the agent knows the fan's state from now on ("is the fan on?")
  OSCMessage state("/arduino/fan/state");
  state.add((int32_t) on);
  sendToVik(state);
}
