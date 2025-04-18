# 🚀 ElatoAI: Realtime AI Speech for ESP32

**Realtime AI Speech powered by OpenAI Realtime API, ESP32, Secure WebSockets, and Deno Edge Functions for >10-minute uninterrupted global conversations**

## 📺 Demo Video

https://github.com/user-attachments/assets/aa60e54c-5847-4a68-80b5-5d6b1a5b9328

<a href="https://www.youtube.com/watch?v=o1eIAwVll5I">
  <img src="https://img.shields.io/badge/Watch%20Demo-YouTube-red?style=for-the-badge&logo=youtube" alt="Watch Demo on YouTube">
</a>


## Getting Started

1. Set up your Local Supabase Backend. From the root directory, run:
```bash
supabase start # Starts your local Supabase server with the default migrations and seed data.
```

2. Set up your NextJS Frontend. From the `frontend-nextjs` directory, run:
```bash
npm install
npm run dev
```

3. Add your ESP32-S3 Device MAC Address to the Settings page in the NextJS Frontend. (Remove colons and convert to lowercase, useful for adding friendly user codes when registering multiple devices)
```bash
# Example 

# 12:34:56:78:9A:BC -> 123456789abc
# 12:34:56:78:9A:BD -> 123456789abd
```
> **Tip:** To find your ESP32-S3 Device's MAC Address, build and upload `test/print_mac_address_test.cpp` using PlatformIO.

4. Add your OpenAI API Key in the `server-deno/.env` and `frontend-nextjs/.env.local` file.
```
OPENAI_API_KEY=your_openai_api_key
```

5. Set up your ESP32 Arduino Client. On PlatformIO, first `Build` the project, then `Upload` the project to your ESP32.


## 🌟 Features

- **Realtime Speech-to-Speech**: Instant speech conversion powered by OpenAI's Realtime APIs.
- **Create Custom AI Agents**: Create custom agents with different personalities and voices.
- **Secure WebSockets**: Reliable, encrypted WebSocket communication.
- **Server Turn Detection**: Intelligent conversation flow handling for smooth interactions.
- **Opus Audio Compression**: High-quality audio streaming with minimal bandwidth.
- **Global Edge Performance**: Low latency Deno Edge Functions ensuring seamless global conversations.
- **ESP32 Arduino Framework**: Optimized and easy-to-use hardware integration.


## 📌 Project Architecture

ElatoAI consists of three main components:

1. **Frontend Client** (`Next.js` hosted on Vercel)
2. **Edge Server Functions** (`Deno` running on Deno/Supabase Edge)
3. **ESP32 IoT Client** (`PlatformIO/Arduino`)


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


## 🗺️ High-Level Flow

```mermaid
flowchart TD
  User[User Speech] --> ESP32
  ESP32[ESP32 Device] -->|WebSocket| Edge[Deno Edge Function]
  Edge -->|OpenAI API| OpenAI[OpenAI Realtime API]
  OpenAI --> Edge
  Edge -->|WebSocket| ESP32
  ESP32 --> User[AI Generated Speech]
```


## 📂 Project Structure

```mermaid
graph TD
  repo[ElatoAI]
  repo --> frontend[Frontend - Next.js]
  repo --> deno[Deno Edge Function]
  repo --> esp32[ESP32 Arduino Client]

  frontend --> supabase[Supabase DB]
  esp32 --> websockets[Secure WebSockets]
  esp32 --> opus[Opus Codec]
  esp32 --> audio_tools[arduino-audio-tools]
```

## ⚙️ PlatformIO Configuration

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


## 📊 Important Stats

- ⚡️ **Latency**: <1s round-trip globally
- 🎧 **Audio Quality**: Opus codec at 24kbps (high clarity)
- ⏳ **Uninterrupted Conversations**: Up to 10 minutes continuous conversations
- 🌎 **Global Availability**: Optimized with edge computing with Deno


## 🛡 Security

- Secure WebSockets (WSS) for encrypted data transfers
- Edge validation and error handling for robust, secure deployment


## 🤝 Contributing

We welcome contributions

- Fork this repository.
- Create your feature branch (`git checkout -b feature/EpicFeature`).
- Commit your changes (`git commit -m 'Add EpicFeature'`).
- Push to the branch (`git push origin feature/EpicFeature`).
- Open a PR


## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

🎉 **Give a ⭐️ if you found this project interesting :)**

