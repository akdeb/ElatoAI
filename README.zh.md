[English](README.md) | 中文

<div align="center">

  <a href="https://elatoai.com"><picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/darkelato.png">
    <source media="(prefers-color-scheme: light)" srcset="assets/lightelato.png">
    <img alt="elato logo" src="assets/lightelato.png" height="70" style="max-width: 100%;">
  </picture></a>
  
<div style="display:flex; flex-direction:row; align-items:center; flex-wrap:wrap; justify-content:center;">
  <a style="display:inline-flex;" href="https://cookbook.openai.com/examples/voice_solutions/running_realtime_api_speech_on_esp32_arduino_edge_runtime_elatoai"><img src="assets/oai.png" height="42" style="width: auto;"></a>  
  <a style="display:inline-flex;" href="https://www.elatoai.com/docs"><img src="assets/docs.png" height="42" style="width: auto;"></a>
  <a style="display:inline-flex;" href="https://discord.gg/KJWxDPBRUj"><img src="assets/discord.png" height="42" style="width: auto;"></a>
      <a style="display:inline-flex;" href="https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices"><img src="assets/ks.png" height="42" style="width: auto;"></a>
</div>
<a href="https://www.kickstarter.com/projects/elatoai/elato-make-toys-talk-with-ai-voices" target="_blank">
 <img src="assets/cover.png" alt="Elato Logo" width="100%">
</a>

<br />
</div>

## 新闻
- **2026 年 4 月 17 日：** 现在可以用 Cloudflare Voice Agents 和 Durable Objects 构建全球化的设备/玩具语音网络。Cloudflare Workers AI 原生提供 Deepgram STT/TTS，因此你只需要提供一个 LLM API Key，就能搭建可扩展、低延迟的语音 AI 流水线。
- **2026 年 4 月 15 日：** 现在你可以通过基于 Pipecat 的 FastAPI 服务器部署 100 多种 STT、LLM、TTS 语音流水线系统。
- **2026 年 3 月 14 日：** Elato 在 Pi Day 发布了 Local AI Toys。你的 ESP32 设备现在可以通过 MLX 运行本地 AI 模型和语音生成，支持 Qwen、Mistral 等本地前沿 LLM 和 TTS 模型。点击[这里](https://www.github.com/akdeb/local-ai-toys)查看。

# 👾 ElatoAI：在 Arduino ESP32 上运行实时语音 AI 模型

ElatoAI 让你在 ESP32 上运行由 100 多种语音 AI 模型驱动的实时语音系统，并通过安全 WebSocket 与边缘函数实现全球范围内 20 分钟以上的不间断对话。

- [🚀 快速开始](https://www.elatoai.com/docs/quickstart)
- [使用 PlatformIO 构建](https://www.elatoai.com/docs/platformio)
- [在 Arduino IDE 中构建](https://www.elatoai.com/docs/arduino)
- [全球部署](https://www.elatoai.com/docs/blog/deploying-globally)
- [🤖🤖🤖 部署多台设备](https://www.elatoai.com/docs/blog/multiple-devices)

## 📽️ 演示视频

<div align="center">
    <a href="https://www.youtube.com/watch?v=o1eIAwVll5I" target="_blank">
    <img src="https://raw.githubusercontent.com/akdeb/ElatoAI/refs/heads/main/assets/thumbnail.png" alt="ElatoAI Demo Video" width="100%" style="border-radius:10px" />
  </a>
</div>

视频链接：[OpenAI 演示](https://youtu.be/o1eIAwVll5I) | [Gemini 演示](https://youtu.be/_zUBue3pfVI) | [Eleven Labs 演示](https://youtu.be/7LKTIuEW-hg) | [Hume AI EVI-4 演示](https://youtu.be/Gtann5pdV0I)

## 🧠 模型

### Deno Edge
1. [OpenAI Realtime API](https://github.com/akdeb/ElatoAI/tree/main/server/deno/models/openai)
2. [Gemini Live API](https://github.com/akdeb/ElatoAI/tree/main/server/deno/models/gemini)
3. [xAI Grok Voice Agent API](https://github.com/akdeb/ElatoAI/tree/main/server/deno/models/grok)
4. [Eleven Labs Conversational AI Agents](https://github.com/akdeb/ElatoAI/tree/main/server/deno/models/elevenlabs)
5. [Hume AI EVI-4](https://github.com/akdeb/ElatoAI/tree/main/server/deno/models/hume)

### Cloudflare Workers
1. LLM - [80 多种模型](https://developers.cloudflare.com/workers-ai/models/?tasks=Text+Generation)，包括 OpenAI、Gemini、xAI 等。
2. TTS - [10 多种模型](https://developers.cloudflare.com/workers-ai/models/?tasks=Text-to-Speech)，包括 Deepgram、MeloTTS 等。
3. STT - [5 种模型](https://developers.cloudflare.com/workers-ai/models/?tasks=Automatic+Speech+Recognition)，包括 Whisper、Deepgram 等。

## 👷‍♀️ DIY 硬件设计

<img src="assets/pcb-design.png" alt="Hardware Setup" width="100%">

## 📱 应用设计

通过 ElatoAI Web 应用，你可以直接在手机上控制自己的 ESP32 AI 设备。

<img src="assets/mockups.png" alt="App Screenshots" width="100%">

## 🌟 完整功能列表

1. **实时语音转语音**：由 OpenAI Realtime API、Gemini Live API、xAI Grok Voice Agent API、Eleven Labs Conversational AI Agents 和 Hume AI EVI4 驱动的即时语音转换。
2. **创建自定义 AI 智能体**：创建具有不同人格和声音的 AI 智能体。
3. **可自定义语音**：从多种声音和人格配置中进行选择。
4. **安全 WebSocket**：可靠且加密的 WebSocket 通信。
5. **服务端 VAD 轮次检测**：智能对话轮次处理，让交互更自然。
6. **Opus 音频压缩**：以极低带宽实现高质量音频流传输。
7. **全球边缘性能**：低延迟的 Deno Edge Functions 确保全球范围内的顺畅对话。
8. **ESP32 Arduino 框架**：经过优化且易于集成的硬件方案。
9. **对话历史**：查看历史对话记录。
10. **设备管理与认证**：注册并管理你的设备。
11. **用户认证**：安全的用户身份认证与授权。
12. **通过 WebRTC 和 WebSocket 对话**：在 NextJS Web 应用中用 WebRTC 与 AI 对话，在 ESP32 上通过 WebSocket 对话。
13. **音量控制**：通过 NextJS Web 应用控制 ESP32 扬声器音量。
14. **实时转录**：对话实时转录结果存储在 Supabase 数据库中。
15. **OTA 更新**：支持 ESP32 固件空中更新。
16. **通过 captive portal 管理 Wi-Fi**：直接在 ESP32 设备上连接 Wi-Fi 或热点。
17. **恢复出厂设置**：通过 NextJS Web 应用对 ESP32 设备执行恢复出厂设置。
18. **按钮和触摸支持**：可以通过按钮或触摸传感器控制 ESP32 设备。
19. **无需 PSRAM**：设备无需 PSRAM 即可运行语音转语音 AI。
20. **Web 客户端 OAuth**：让用户管理自己的 AI 角色和设备。
21. **音高控制**：在 NextJS Web 应用中调整 AI 声音音高，做出更卡通化的声音。
22. **工具调用**：从 ESP32 设备调用边缘函数中的工具和函数，构建完整的语音 AI 智能体。
23. **轻触唤醒**：轻触触摸板即可从休眠中唤醒。
24. **部署到 Cloudflare**：借助 Cloudflare Voice Agents 和 Durable Objects 连接任意 LLM、TTS、STT 服务。

## 项目架构

ElatoAI 由三个主要组件组成：

1. **前端客户端**（部署在 Vercel 上的 `Next.js`）- 用于创建并与 AI 智能体对话，并将其“发送”到你的 ESP32 设备
2. **边缘服务函数**（`Deno Edge` 或 `Cloudflare Workers`）- 用于处理来自 ESP32 设备的 WebSocket 连接以及对模型提供商 API 的调用
3. **ESP32 IoT 客户端**（`PlatformIO/Arduino`）- 接收来自边缘服务函数的 WebSocket 连接，并通过 Deno 边缘服务器或 Cloudflare Durable Objects 把音频发送给模型提供商

## 🛠 技术栈

| 组件 | 使用技术 |
|-----------------|------------------------------------------|
| 前端 | Next.js, Vercel |
| 后端 | Supabase DB |
| 边缘函数 | Deno Edge 或 Cloudflare Workers |
| IoT 客户端 | PlatformIO, Arduino Framework, ESP32-S3 |
| 音频编解码 | Opus |
| 通信 | 安全 WebSockets |
| 库 | [ArduinoJson](https://github.com/bblanchon/ArduinoJson), [WebSockets](https://github.com/Links2004/arduinoWebSockets), [AsyncWebServer](https://github.com/ESP32Async/ESPAsyncWebServer), [ESP32_Button](https://github.com/esp-arduino-libs/ESP32_Button), [Arduino Audio Tools](https://github.com/pschatzmann/arduino-audio-tools), [ArduinoLibOpus](https://github.com/pschatzmann/arduino-libopus) |

## 高层流程图

```mermaid
flowchart TD
  subgraph UserLayer
    UserInput[用户语音输入]
    UserOutput[AI 生成的语音输出]
  end
  
  UserInput --> ESP32
  ESP32[ESP32 设备] -->|WebSocket| Edge[Deno Edge / Cloudflare Workers]
  Edge -->|OpenAI API| OpenAI[OpenAI Realtime API]
  Edge -->|Gemini API| Gemini[Gemini Live API]
  Edge -->|xAI API| xAI[xAI Grok Voice Agent API]
  Edge -->|ElevenLabs API| ElevenLabs[ElevenLabs AI Agents]
  Edge -->|Hume API| Hume[Hume AI EVI4]
  OpenAI --> Edge
  Gemini --> Edge
  xAI --> Edge
  ElevenLabs --> Edge
  Hume --> Edge
  Edge -->|WebSocket| ESP32
  ESP32 --> UserOutput
```

## 项目结构

```mermaid
graph TD
  repo[ElatoAI]
  repo --> frontend[Frontend Vercel NextJS]
  repo --> server[Deno Edge Function / Cloudflare Workers]
  repo --> esp32[ESP32 Arduino Client]
  server --> supabase[Supabase DB]

  frontend --> supabase
  esp32 --> websockets[Secure WebSockets]
  esp32 --> opus[Opus Codec]
  esp32 --> audio_tools[arduino-audio-tools]
  esp32 --> libopus[arduino-libopus]
  esp32 --> ESPAsyncWebServer[ESPAsyncWebServer]
```

## 📊 关键指标

- **延迟**：全球往返延迟小于 2 秒
- **音频质量**：12kbps Opus 编码（高清晰度）+ 24kHz 采样率
- **不间断对话**：全球范围内最长可达 20 分钟连续对话
- **全球可用性**：通过边缘计算优化

## 🛡 安全性

- 使用安全 WebSocket（WSS）进行加密数据传输
- 可选：使用 256 位 AES 加密 API Key
- 使用 Supabase DB 进行安全认证
- 所有表均采用 Postgres RLS

## 🚫 限制
- 连接边缘服务器时有 3-4 秒冷启动时间
- 已测试最长连续对话约为 17 分钟
- 超过 wall clock time 后边缘服务器会停止
- ESP32 上尚未支持语音打断检测

## 🙌 贡献

欢迎贡献。你可以从这些方向开始：
1. ESP32 上的语音打断（已支持 OpenAI）
2. ~~添加 Arduino IDE 支持~~
3. ~~添加 Hume API 客户端用于情绪检测~~
4. 在 Deno Edge 上添加 MCP 支持
5. ~~接入 Eleven Labs API 进行语音生成~~
6. 添加 Azure OpenAI 支持（容易上手）- 审核中
7. 添加 Cartesia 支持
8. 添加 Amazon Nova 支持
9. 添加 Deepgram 支持
10. ~~添加 Cloudflare Workers 支持~~

## 许可证

本项目基于 MIT License 发布，详情请查看 [LICENSE](LICENSE)。

**欢迎查看我们的硬件产品：[ElatoAI Products](https://www.elatoai.com/)。如果你觉得这个项目有趣或有帮助，欢迎在 GitHub 上给它点个 Star。⭐**
