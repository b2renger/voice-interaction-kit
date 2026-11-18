/*
  VIK <-> an Arduino with an Ethernet shield: the room's temperature goes to VIK, VIK switches a fan.

  Sends    /arduino/temp <float, degrees C> to VIK twice a second (VIK: Settings > OSC > Listen on port 9000).
  Receives /arduino/fan <0 or 1> on UDP port 8000 and switches pin 3: an LED stands in for the fan
           (a relay or MOSFET module for a real one). Then tells VIK the fan's state: /arduino/fan/state <0 or 1>.

  Hardware : Arduino Uno (or Mega) + Ethernet shield (W5100 / W5500).
             A potentiometer on A0 fakes the temperature, from 15 to 40 C: turn it to "heat" the room.
             Or a TMP36 sensor on A0 (set POTENTIOMETER to false).
             LED + 220 ohm resistor on pin 3 (NOT 10-13: the shield's SPI bus).
  Libraries: Ethernet (built in), OSC by Adrian Freed / CNMAT (Library Manager: "OSC").

  Network  : this board is 192.168.10.177, the computer running VIK 192.168.10.168, as in ArtLux's OSC
             tutorial: give the computer's Ethernet port that FIXED address (Windows: Win+R, ncpa.cpl -> the
             Ethernet adapter -> Properties -> IPv4). Full walkthrough: examples/arduino-osc/README.md.
*/

#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <OSCMessage.h>

byte mac[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0xFE, 0xED };  // must be UNIQUE per board on the network
IPAddress ip(192, 168, 10, 177);                       // this board
IPAddress vik(192, 168, 10, 168);                      // the computer running VIK
const unsigned int VIK_PORT = 9000;                    // = VIK's Settings > OSC > Listen on port
const unsigned int LOCAL_PORT = 8000;                  // = the port in VIK's Settings > OSC > Send to (192.168.10.177:8000)
const int SENSOR_PIN = A0;
const int FAN_PIN = 3;
const bool POTENTIOMETER = true;                       // true: a potentiometer fakes 15-40 C; false: a TMP36

EthernetUDP Udp;
unsigned long lastSend = 0;

void setup() {
  Serial.begin(9600);
  pinMode(4, OUTPUT);
  digitalWrite(4, HIGH);        // deselect the shield's SD card (it shares the SPI bus)
  pinMode(FAN_PIN, OUTPUT);

  Ethernet.begin(mac, ip);
  delay(1000);

  if (Ethernet.hardwareStatus() == EthernetNoHardware) {
    Serial.println("Ethernet shield not found!");
    while (true) delay(1);
  }
  if (Ethernet.linkStatus() == LinkOFF) {
    Serial.println("Cable not connected (link off)");
  }
  Serial.print("Arduino IP: ");
  Serial.println(Ethernet.localIP());

  Udp.begin(LOCAL_PORT);
}

float readTemperature() {
  int raw = analogRead(SENSOR_PIN);                    // 0..1023
  if (POTENTIOMETER) return 15.0 + raw * 25.0 / 1023.0;
  float volts = raw * 5.0 / 1023.0;                    // TMP36: 0.5 V at 0 C, 10 mV per degree
  return (volts - 0.5) * 100.0;
}

void sendToVik(OSCMessage &msg) {
  Udp.beginPacket(vik, VIK_PORT);
  msg.send(Udp);
  Udp.endPacket();
  msg.empty();
}

void loop() {
  // 1. the temperature, twice a second
  if (millis() - lastSend >= 500) {
    lastSend = millis();
    float t = readTemperature();
    OSCMessage msg("/arduino/temp");
    msg.add(t);
    sendToVik(msg);
    Serial.print("temp ");
    Serial.println(t);
  }

  // 2. the fan, when VIK says so
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
