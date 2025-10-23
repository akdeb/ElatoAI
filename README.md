<a href="https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices" target="_blank">
 <img src="assets/ks.png" alt="Elato Logo" width="100%">
</a>

<br />

<div align="center">
<h3>

[🚀 Kickstarter](https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices) | [🏠 Homepage](https://elatoai.com/) 

</h3>
</div>

<br />


# 👾 ElatoAI: Realtime Speech AI Agents for ESP32

Realtime AI Speech powered by SoTA AI voice models like **OpenAI Realtime API**, **Eleven Labs AI Agents**, **Gemini Live API**, **Hume AI EVI4**, on ESP32, with Secure WebSockets, and Deno Edge Functions for >15-minute uninterrupted conversations globally.

<div align="center" style="margin: 20px 0;">
  <!-- <a href="https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices" target="_blank">
    <img src="https://img.shields.io/badge/Kickstarter_Pre_Launch-white?style=for-the-badge&logo=kickstarter" alt="Elato Kickstarter Prelaunch" style="margin: 0 10px;">
  </a> -->
    <a href="https://cookbook.openai.com/examples/voice_solutions/running_realtime_api_speech_on_esp32_arduino_edge_runtime_elatoai" target="_blank">
  <img src="https://img.shields.io/badge/OpenAI-Cookbook-violet?style=for-the-badge&logo=openai&logoColor=white&labelColor=black" alt="OpenAI" style="margin: 0 10px;">
</a>
  <a href="https://news.ycombinator.com/item?id=43762409" target="_blank">
    <img src="https://img.shields.io/badge/Hacker_News_Launch-white?style=for-the-badge&logo=ycombinator" alt="Hacker News Launch" style="margin: 0 10px;">
  </a>

  <a href="https://blog.adafruit.com/2025/05/06/elatoai-realtime-speech-ai-agents-for-esp32/" target="_blank">
    <img src="https://img.shields.io/badge/Adafruit-Product-red?style=for-the-badge&logo=adafruit" alt="Adafruit" style="margin: 0 10px;">
  </a>
</div>

<div align="center">

[![Discord](https://img.shields.io/badge/Discord-105_members-5865F2?style=flat&logo=discord&logoColor=white)](https://discord.gg/KJWxDPBRUj)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://opensource.org/licenses/MIT)
![Node.js](https://img.shields.io/badge/Node.js-22.13.0-yellow.svg)
![Next.js](https://img.shields.io/badge/Next.js-14.2.7-brightgreen.svg)
![React](https://img.shields.io/badge/React-18.2.0-blue.svg)

</div>


## ⚡️ With SOTA Realtime AI Speech Models on an ESP32

<div align="center" class="flex flex-row gap-4">

<img src="assets/openai.png" alt="OpenAI Realtime API" width="45%">

<img src="assets/gemini.png" alt="Gemini Live API" width="45%">

<img src="assets/humeai.avif" alt="Hume AI EVI4" width="45%">

<img src="assets/elevenlabs.svg" alt="Eleven Labs AI Agents" width="45%">

</div>


## 📽️ Demo Video ([✨ Gemini demo](https://youtu.be/_zUBue3pfVI), [Eleven Labs Demo](https://youtu.be/7LKTIuEW-hg), [Hume AI EVI4 Demo](https://youtu.be/Gtann5pdV0I))

<div align="center">
    <a href="https://www.youtube.com/watch?v=o1eIAwVll5I" target="_blank">
    <img src="https://raw.githubusercontent.com/akdeb/ElatoAI/refs/heads/main/assets/thumbnail.png" alt="Elato AI Demo Video" width="100%" style="border-radius:10px" />
  </a>
</div>

Video links: [OpenAI Demo](https://youtu.be/o1eIAwVll5I) | [Gemini Demo](https://youtu.be/_zUBue3pfVI) | [Eleven Labs Demo](https://youtu.be/7LKTIuEW-hg) | [Hume AI EVI4 Demo](https://youtu.be/Gtann5pdV0I)

## 👷‍♀️ DIY Hardware Design

<img src="assets/pcb-design.png" alt="Hardware Setup" width="100%">

## 📱 App Design

Control your ESP32 AI device from your phone with the Elato AI webapp.

<img src="assets/mockups.png" alt="App Screenshots" width="100%">

| Select from a list of AI characters | Talk to your AI with real-time responses | Create personalized AI characters |
|:--:|:--:|:--:|

## ⭐️ Key Voice AI Features
<img src="assets/features.png" alt="App Screenshots" width="100%">



## 🚀 Quick Start

<a href="https://www.youtube.com/watch?v=bXrNRpGOJWw">
  <img src="https://img.shields.io/badge/Quickstart%20Tutorial-YouTube-yellow?style=for-the-badge&logo=youtube" alt="Watch Demo on YouTube">
</a>

1. **Clone the repository**

```bash
git clone git@github.com:akdeb/ElatoAI.git
```

2. **Start Supabase**

Install [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) and set up your Local Supabase Backend. Make sure you have [Docker Desktop](https://www.docker.com/products/docker-desktop/) set up. Then from the root directory, run:
```bash
brew install supabase/tap/supabase
supabase start # This starts your local Supabase server with the default migrations and seed data.
```

3. **Set up your NextJS Frontend**

([See the Frontend README](frontend-nextjs/README.md)) 

From the `frontend-nextjs` directory, run the following commands. (**Login creds:** Email: `admin@elatoai.com`, Password: `admin`)
```bash
cd frontend-nextjs
npm install
cp .env.example .env.local

# In .env.local, set your environment variables 
# NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
# OPENAI_API_KEY=<your-openai-api-key>

# Run the development server
npm run dev
```

4. **Choose edge server option (FREE USAGE)**

- **ELATO MODE:** Got your own ESP32 DIY hardware device? We offer a fully hosted server for free for up to 30 minutes per month. Register your device on the [settings page](https://www.elatoai.com/home/settings/device) and it will automatically connect to our edge server. Check out our [Pricing page](https://www.elatoai.com/#pricing) for more details.

- **DEV MODE:** Alternatively, you can run your own edge server locally by following the instructions below and in the [Deno server README](server-deno/README.md).

> **Pro Tip:** You can adjust this server setting in the `firmware-arduino/Config.h` file.

5. **If you choose to run your own edge server locally:**


```bash
# Navigate to the server directory
cd server-deno
cp .env.example .env

# In .env, set your environment variables 
# SUPABASE_KEY=<your-supabase-anon-key>
# OPENAI_API_KEY=<your-openai-api-key>
# GEMINI_API_KEY=<your-gemini-api-key>
# ELEVENLABS_API_KEY=<your-elevenlabs-api-key>
# HUME_API_KEY=<your-hume-api-key>

# Run the server at port 8000
deno run -A --env-file=.env main.ts
```

6. **Setup the ESP32 Device firmware**

([See the ESP32 Device README](firmware-arduino/README.md))

In `Config.cpp` set `ws_server` and `backend_server` to your local IP address. Run `ifconfig` in your console and find `en0` -> `inet` -> `192.168.1.100` (it may be different for your Wifi network). This tells the ESP32 device to connect to your NextJS frontend and Deno server running on your local machine. All services should be on the same Wifi network.

7. **Setup the ESP32 Device Wifi**

Build and upload the firmware to your ESP32 device. The ESP32 should open an `ELATO-DEVICE` captive portal to connect to Wifi. Connect to it and go to `http://192.168.4.1` to configure the device wifi.

8. **Turn on your device**

Once your Wifi credentials are configured, turn the device off and on again and it should connect to your Wifi and your server. Now you can talk to your AI Character!

## Project Architecture

ElatoAI consists of three main components:

1. **Frontend Client** (`Next.js` hosted on Vercel) - to create and talk to your AI agents and 'send' it to your ESP32 device
2. **Edge Server Functions** (`Deno` running on Deno/Supabase Edge) - to handle the websocket connections from the ESP32 device and the LLM Provider API calls
3. **ESP32 IoT Client** (`PlatformIO/Arduino`) - to receive the websocket connections from the Edge Server Functions and send audio to the LLM Provider via the Deno edge server.


## 🌟 Full list of features

1. **Realtime Speech-to-Speech**: Instant speech conversion powered by OpenAI's Realtime API, Gemini's Live API, Eleven Labs AI Agents and Hume AI EVI4.
2. **Create Custom AI Agents**: Create custom agents with different personalities and voices.
3. **Customizable Voices**: Choose from a variety of voices and personalities.
4. **Secure WebSockets**: Reliable, encrypted WebSocket communication.
5. **Server VAD Turn Detection**: Intelligent conversation flow handling for smooth interactions.
6. **Opus Audio Compression**: High-quality audio streaming with minimal bandwidth.
7. **Global Edge Performance**: Low latency Deno Edge Functions ensuring seamless global conversations.
8. **ESP32 Arduino Framework**: Optimized and easy-to-use hardware integration.
9. **Conversation History**: View your conversation history.
10. **Device Management and Authentication**: Register and manage your devices.
11. **User Authentication**: Secure user authentication and authorization.
12. **Conversations with WebRTC and Websockets**: Talk to your AI with WebRTC on the NextJS webapp and with websockets on the ESP32.
13. **Volume Control**: Control the volume of the ESP32 speaker from the NextJS webapp.
14. **Realtime Transcripts**: The realtime transcripts of your conversations are stored in the Supabase DB.
15. **OTA Updates**: Over the Air Updates for the ESP32 firmware.
16. **Wifi Management with captive portal**: Connect to your Wifi network from the ESP32 device.
17. **Factory Reset**: Factory reset the ESP32 device from the NextJS webapp.
18. **Button and Touch Support**: Use the button OR touch sensor to control the ESP32 device.
19. **No PSRAM Required**: The ESP32 device does not require PSRAM to run the speech to speech AI.
20. **OAuth for Web client**: OAuth for your users to manage their AI characters and devices.
21. **Pitch Factor**: Control the pitch of the AI's voice from the NextJS webapp to create cartoon-like voices.
22. **Tool calling**: Call tools and functions from the ESP32 device to the Deno Edge Functions for a complete voice AI agent.
23. **Tap to turn on**: Tap the touchpad to turn it on from sleep.

## 🛠 Tech Stack

| Component       | Technology Used                          |
|-----------------|------------------------------------------|
| Frontend        | Next.js, Vercel            |
| Backend         | Supabase DB  |
| Edge Functions  | Deno Edge Functions on Deno/Supabase          |
| IoT Client      | PlatformIO, Arduino Framework, ESP32-S3  |
| Audio Codec     | Opus                                     |
| Communication   | Secure WebSockets                        |
| Libraries       | ArduinoJson, WebSockets, AsyncWebServer, ESP32_Button, Arduino Audio Tools, ArduinoLibOpus        |

## High-Level Flowchart

```mermaid
flowchart TD
  subgraph UserLayer
    UserInput[User Speech Input]
    UserOutput[AI Generated Speech Output]
  end
  
  UserInput --> ESP32
  ESP32[ESP32 Device] -->|WebSocket| Edge[Deno Edge Function]
  Edge -->|OpenAI API| OpenAI[OpenAI Realtime API]
  Edge -->|Gemini API| Gemini[Gemini Live API]
  Edge -->|ElevenLabs API| ElevenLabs[ElevenLabs AI Agents]
  Edge -->|Hume API| Hume[Hume AI EVI4]
  OpenAI --> Edge
  Gemini --> Edge
  ElevenLabs --> Edge
  Hume --> Edge
  Edge -->|WebSocket| ESP32
  ESP32 --> UserOutput
```


## Project Structure

```mermaid
graph TD
  repo[ElatoAI]
  repo --> frontend[Frontend Vercel NextJS]
  repo --> deno[Deno Edge Function]
  repo --> esp32[ESP32 Arduino Client]
  deno --> supabase[Supabase DB]

  frontend --> supabase
  esp32 --> websockets[Secure WebSockets]
  esp32 --> opus[Opus Codec]
  esp32 --> audio_tools[arduino-audio-tools]
  esp32 --> libopus[arduino-libopus]
  esp32 --> ESPAsyncWebServer[ESPAsyncWebServer]
```

## ⚙️ PlatformIO Config

```ini
[env:esp32-s3-devkitc-1]
platform = espressif32 @ 6.10.0
board = esp32-s3-devkitc-1
framework = arduino
monitor_speed = 115200

lib_deps =
    bblanchon/ArduinoJson@^7.1.0
    links2004/WebSockets@^2.4.1
    ESP32Async/ESPAsyncWebServer@^3.7.6
    https://github.com/esp-arduino-libs/ESP32_Button.git#v0.0.1
    https://github.com/pschatzmann/arduino-audio-tools.git#v1.0.1
    https://github.com/pschatzmann/arduino-libopus.git#a1.1.0
```

## Additional Docs
- [⏸️ Using the Eleven Labs API](./docs/ElevenLabs.md)
- [📈 Core Use Cases](./docs/Usecases.md)
- [🤖🤖🤖 Getting Started with multiple devices](./docs/MultipleDevices.md)
- [🚀 Deploying your application](./docs/Deploy.md)

## 📊 Important Stats

- ⚡️ **Latency**: <2s round-trip globally
- 🎧 **Audio Quality**: Opus codec at 12kbps (high clarity) 24kHz sampling rate
- ⏳ **Uninterrupted Conversations**: Up to 15 minutes continuous conversations globally
- 🌎 **Global Availability**: Optimized with edge computing

## 🛡 Security

- Secure WebSockets (WSS) for encrypted data transfers
- Optional: API Key encryption with 256-bit AES
- Supabase DB for secure authentication
- Postgres RLS for all tables

## 🚫 Limitations
- 3-4s Cold start time while connecting to edge server
- Tested with up to 17 minutes of uninterrupted conversations
- Edge server stops when wall clock time is exceeded
- No speech interruption detection on ESP32

## 🤝 Contributing

1. Looking for Speech Interruption detection on ESP32
2. Adding Arduino IDE support
3. ~~Add Hume API client for emotion detection~~
4. Add MCP support on Deno Edge
5. ~~Plug in Eleven Labs API for voice generation~~
6. Add Azure OpenAI Support (easy pickens)
7. Add Cartesia Support (easy pickens)

We welcome contributions
- Fork this repository.
- Create your feature branch (`git checkout -b feature/EpicFeature`).
- Commit your changes (`git commit -m 'Add EpicFeature'`).
- Push to the branch (`git push origin feature/EpicFeature`).
- Open a PR


## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Star History

<div align="center">
   <img src="assets/star-history.png" alt="Star History" width="100%">
</div>


**Check out our hardware offerings at [Elato AI Products](https://www.elatoai.com/). If you find this project interesting or useful, support us by starring this project on GitHub. ⭐**

---