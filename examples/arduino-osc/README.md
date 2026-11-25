# A conversation with the room: an Arduino talks to VIK

The room's temperature passes 28 °C. The agent says so, at a pause in the conversation, and asks whether to turn on the fan. "Yes, please": VIK sends `/arduino/fan 1`, and the fan starts. Ask "is it warm in here?" at any moment: the agent knows the temperature.

Two directions of OSC, in VIK (3.5 or later):

- **In:** the Arduino sends `/arduino/temp 29.3` to VIK twice a second. The agent knows the latest value, and the pattern **Too warm** (*When an OSC message arrives at `/arduino/temp`, the value goes above 28*) makes it speak. A button sends `/arduino/button 1` when pressed: the pattern **Button pressed** makes the agent greet whoever pressed it.
- **Out:** the patterns **Yes, the fan**, **Fan on** and **Fan off** send `/arduino/fan 1` or `0` back to the board.

| File | What it is |
|---|---|
| `room-climate.vik.json` | the agent **Room climate**: its persona says what the addresses mean, its patterns react to the temperature and switch the fan |
| `fake-arduino.mjs` | plays the Arduino on this computer, when you have none: the room warms up by itself, and cools down while the fan is on; Enter presses its button |
| [`vik_osc_room/vik_osc_room.ino`](vik_osc_room/vik_osc_room.ino) | the sketch for an Arduino Uno with an Ethernet shield: a potentiometer (or a TMP36) for the temperature, an LED for the fan |
| [`vik_osc_esp32/vik_osc_esp32.ino`](vik_osc_esp32/vik_osc_esp32.ino) | the same board on an ESP32, over WiFi, with a button: nothing to wire to try it (its BOOT button, its blue LED) |

## 1. Without an Arduino

**VIK.** Choose **Manage ▸ Import a file…** and pick `room-climate.vik.json`. In **Settings ▸ OSC**:

- **Send to:** `127.0.0.1:8000` (the fake board, on this computer). Add it after ArtLux's address if you use both: `127.0.0.1:10000, 127.0.0.1:8000`.
- **Listen on port:** `9000`.

**The fake board.** In a terminal, in this folder (Node.js 18 or later):

```
node fake-arduino.mjs
```

It prints the temperature it sends. It starts at 24 °C and gains about one degree every three seconds. Press **Enter** in its terminal to press the board's button.

**Talk.** Click **Start**. **Settings ▸ OSC** now lists `/arduino/temp` and its value. Then, in **Talk**:

| When | What happens |
|---|---|
| you ask "is it warm in here?" | the agent answers with the temperature it has just read |
| the temperature passes 28 °C | at the next pause, the agent says the room is warm and asks about the fan. "Why it answered" shows `OSC /arduino/temp 28.1` and the pattern **Too warm** |
| you answer "yes, please" | `/arduino/fan 1` goes to the board: the fake board prints `fan ON`, and the room cools down |
| "turn off the fan", "I'm cold now" | `/arduino/fan 0` |
| you press Enter in the fake board's terminal | `/arduino/button 1`, then `0`: at the next pause, the agent greets you and says the temperature (the pattern **Button pressed**) |

The agent never interrupts you: if you are talking, or it is, it waits until the conversation has paused for a second and a half. It speaks once when the temperature crosses 28 °C, and again only once it has gone back under about 27.4 °C, so a temperature hovering around 28 does not make it repeat itself.

## 2. With an Arduino

The same setup as ArtLux's OSC tutorial: an **Arduino Uno + Ethernet shield** (W5100 or W5500), plugged into the computer's Ethernet port with a cable.

**Wiring.** A potentiometer on **A0** (its ends on 5V and GND): turning it "heats" the room, from 15 to 40 °C. Or a TMP36 sensor on A0, with `POTENTIOMETER` set to `false` in the sketch. An LED and a 220 Ω resistor on **pin 3** stand in for the fan; a relay or MOSFET module drives a real one. Not pins 10 to 13: the shield uses them.

**The sketch.** In the Arduino IDE, install the **OSC** library by Adrian Freed (CNMAT) from the Library Manager, then upload `vik_osc_room/vik_osc_room.ino`. The board is `192.168.10.177`, and it sends to the computer at `192.168.10.168`, port `9000`: change these lines at the top of the sketch for another network.

**The network.** Give the computer's Ethernet port the fixed address `192.168.10.168`, mask `255.255.255.0` (Windows: Win+R, `ncpa.cpl`, the Ethernet adapter, Properties, IPv4).

**VIK.** In **Settings ▸ OSC**, **Send to** `192.168.10.177:8000` (the board) and **Listen on port** `9000`. Click **Start**. The first time, Windows asks whether VIK may use the network: allow it on private networks. Turn the potentiometer, and talk.

## 3. With an ESP32 (WiFi)

No cable and no shield: an **ESP32 DevKit** on the same WiFi network as the computer. Its **BOOT** button makes the agent speak and its blue LED stands in for the fan, so there is nothing to wire to try it.

**The sketch.** In the Arduino IDE, add the ESP32 boards (Boards Manager: **esp32** by Espressif) and the **OSC** library by Adrian Freed (CNMAT). Open `vik_osc_esp32/vik_osc_esp32.ino` and fill its first lines:

- `WIFI_NAME` and `WIFI_PASSWORD`: a **2.4 GHz** network (the ESP32 has no 5 GHz).
- `VIK_HOST`: the computer's address on that network. In a terminal, `ipconfig`: the **IPv4 address** of the WiFi adapter, for example `192.168.1.20`.

Choose the board **ESP32 Dev Module**, upload, and open the serial monitor at 115200 baud. It prints the board's address: `ESP32 IP: 192.168.1.42`.

**VIK.** In **Settings ▸ OSC**, **Send to** the board's address with port `8000` (`192.168.1.42:8000`), and **Listen on port** `9000`. Click **Start**, then press **BOOT**: at the next pause, the agent greets you and says the temperature (the pattern **Button pressed**). Ask for the fan: the blue LED lights up.

**Wiring (optional).** A potentiometer on **GPIO 34**, its ends on **3V3** and GND (never 5V): turning it "heats" the room, as on the Uno. Or a TMP36 on GPIO 34, powered from 3V3, with `POTENTIOMETER` set to `false`. Without either, GPIO 34 floats and the temperature wanders: the agent may say the room is warm. A button of your own goes between a pin and GND, with that pin in `BUTTON_PIN`. Another ESP32 (S3, C3…): change the three pins at the top of the sketch.

The router may give the board another address when it reconnects. If the LED stops answering, read the new one in the serial monitor, or give the board a fixed address in the router.

## Your own sensors

- **A sensor:** send its value to VIK's port under an address of your choice (`/plant/moisture`). Say in the persona what it means and its unit: "/plant/moisture is the soil's moisture, from 0 (dry) to 100 (soaked)".
- **A threshold:** a pattern **When an OSC message arrives at** `/plant/moisture`, **the value goes below** `20`, then **Answer** with an instruction such as "The soil is dry ({value}). Say it as the plant would, and ask to be watered."
- **A button:** send `1` when it is pressed, `0` when it is released, and use **the value goes above** `0.5`: one reply per press. **Any message** is right for a board that sends only on presses, never for a sensor that streams.
- **Back to the board:** **Send OSC** in any pattern, with `{value}` if you want to send the value received back.

## When nothing happens

- **Settings ▸ OSC lists nothing.** VIK listens only during a conversation: click **Start**. Check the port, and that the board (or the fake one) sends to this computer's address. With a real board, allow VIK in the Windows firewall (Windows Security, Firewall & network protection, Allow an app through firewall).
- **"OSC: VIK cannot listen (port 9000 is already used by another program)".** Choose another port, in VIK and in the sketch (`VIK_PORT`).
- **The value is listed, but the agent says nothing at 28 °C.** Check in **Interactions** that **Too warm** is on and its address is exactly the one listed (OSC addresses are case-sensitive). It fires only on the crossing: if the room was already above 28 °C at **Start**, it speaks at the first message, then waits for the temperature to go down and up again.
- **The agent offers the fan, but the LED stays off.** "Why it answered" shows where `/arduino/fan` went: if it says "not sent", fill **Send to**. Check the board's address and port in **Send to**, and its serial monitor (9600 baud) for `fan 1`.
- **ESP32: dots forever in the serial monitor.** The network's name or password, or a 5 GHz network: the ESP32 joins only 2.4 GHz ones.
- **ESP32 connected, but Settings ▸ OSC lists nothing.** Check `VIK_HOST` against `ipconfig`. Windows lets VIK receive only on the networks it was allowed on: if the WiFi is a **Public** network, make it **Private** (Windows Settings ▸ Network & internet ▸ Wi-Fi ▸ the network), or allow VIK on public networks too (Windows Security ▸ Firewall & network protection ▸ Allow an app through firewall). A guest or school network may keep its devices from reaching each other: use a phone's hotspot, or a small router of your own.
