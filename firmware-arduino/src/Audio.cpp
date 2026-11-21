#include "OTA.h"
#include "Audio.h"
#include "PitchShift.h"
#include "CodecBoard.h"
#include <atomic>

// libopus pseudo-stack pointer (diagnostics)
extern "C" char *global_stack;

// WEBSOCKET
SemaphoreHandle_t wsMutex;
WebSocketsClient webSocket;

// TASK HANDLES
TaskHandle_t speakerTaskHandle = NULL;
TaskHandle_t micTaskHandle = NULL;
TaskHandle_t networkTaskHandle = NULL;

// TIMING REGISTERS
volatile bool scheduleListeningRestart = false;
unsigned long scheduledTime = 0;
unsigned long speakingStartTime = 0;
// Live completion is a playback handoff, not a forced one-second restart.
// Only networkTask accesses the IDs; speakerTask publishes its write status.
uint32_t activePlaybackId = 0;
uint32_t pendingPlaybackId = 0;
volatile bool speakerCopyActive = false;
volatile unsigned long lastSpeakerWriteTime = 0;
unsigned long playbackDrainRequestedTime = 0;
unsigned long speakerDrainGuardMs = 250;
std::atomic<bool> speechInterruptRequested{false};
bool interruptedResponse = false; // accessed only by networkTask

#ifdef ELATO_BOARD_VOICE_V1
// Half duplex on one shared I2S port: networkTask requests the rate for the
// next turn, audioStreamTask (the port owner) applies it. Mic frames are only
// sent once the port really runs at MIC_SAMPLE_RATE, speaker frames only at
// SAMPLE_RATE.
volatile uint32_t i2sRateRequested = MIC_SAMPLE_RATE;
volatile uint32_t i2sRateActive = 0;
volatile bool i2sPortReady = false;
static constexpr int VOICE_V1_I2S_DMA_FRAMES = 256;
static inline void requestI2SRate(uint32_t rate) { i2sRateRequested = rate; }
static inline bool speakerRateReady() { return i2sRateActive == SAMPLE_RATE; }
static inline bool micRateReady() { return i2sPortReady && i2sRateActive == MIC_SAMPLE_RATE; }
#else
static inline void requestI2SRate(uint32_t) {}
static inline bool speakerRateReady() { return true; }
static inline bool micRateReady() { return true; }
#endif

void requestSpeechInterrupt() {
    if (!shutdownInProgress && deviceState == SPEAKING) {
        speechInterruptRequested.store(true);
    }
}

// AUDIO SETTINGS
int currentVolume = 70;
float currentPitchFactor = 1.0f;
const int CHANNELS = 1;         // Mono
const int BITS_PER_SAMPLE = 16; // 16-bit audio

// AUDIO OUTPUT
class BufferPrint : public Print {
public:
  explicit BufferPrint(BufferRTOS<uint8_t>& buf) : _buffer(buf) {}

  // networkTask -> webSocket.loop() -> webSocketEvent(WStype_BIN, ...) -> opusDecoder.write() -> bufferPrint.write()
  virtual size_t write(uint8_t data) override {
    if (webSocket.isConnected() && deviceState == SPEAKING) {
        return _buffer.writeArray(&data, 1);
    }
    return 1; //let opusDecoder write, otherwise thread will stuck
  }

  // networkTask -> webSocket.loop() -> webSocketEvent(WStype_BIN, ...) -> opusDecoder.write() -> bufferPrint.write()
  virtual size_t write(const uint8_t *buffer, size_t size) override {
    if (webSocket.isConnected() && deviceState == SPEAKING) {
        return _buffer.writeArray(buffer, size);
    }
    return size; //let opusDecoder write, otherwise thread will stuck
  }

private:
  BufferRTOS<uint8_t>& _buffer;
};

BufferPrint bufferPrint(audioBuffer);
OpusAudioDecoder opusDecoder;  //access guarded by wsmutex
BufferRTOS<uint8_t> audioBuffer(AUDIO_BUFFER_SIZE, AUDIO_CHUNK_SIZE);  //producer: networkTask, consumer: audioStreamTask. Thread safe in single producer->single consumer scenario.
I2SStream i2s; //access from audioStreamTask only

// OLD with no pitch shift
VolumeStream volume(i2s); //access from audioStreamTask only
QueueStream<uint8_t> queue(audioBuffer); //access from audioStreamTask only
StreamCopy copier(volume, queue);

// NEW for pitch shift (lossy)
PitchShiftFixedOutput pitchShift(i2s);
VolumeStream volumePitch(pitchShift); //access from audioStreamTask only
StreamCopy pitchCopier(volumePitch, queue);

AudioInfo info(SAMPLE_RATE, CHANNELS, BITS_PER_SAMPLE);
volatile bool i2sOutputFlushScheduled = false;

unsigned long getSpeakingDuration() {
    if (deviceState == SPEAKING && speakingStartTime > 0) {
        return millis() - speakingStartTime;
    }
    return 0;
}

// networkTask -> webSocket.loop() -> webSocketEvent(WStype_TEXT, ...) -> transitionToSpeaking()
void transitionToSpeaking() {
    if (shutdownInProgress) return;
    scheduleListeningRestart = false;
    pendingPlaybackId = 0;
    vTaskDelay(50);
    if (shutdownInProgress) return;

    i2sInputFlushScheduled = true;
    requestI2SRate(SAMPLE_RATE);
    
    deviceState = SPEAKING;
    audioBoardSetAmp(true);
    speakingStartTime = millis();
    
    // webSocket.enableHeartbeat(30000, 15000, 3);
    
    Serial.println("Transitioned to speaking mode");
}

// networkTask -> transitionToListening()
// ( networkTask -> webSocket.loop() -> webSocketEvent(WStype_TEXT, ...) -> (sets scheduleListeningRestart) -> networkTask -> transitionToListening() )
void transitionToListening() {
    if (shutdownInProgress) return;
    deviceState = PROCESSING;   
    scheduleListeningRestart = false;
    pendingPlaybackId = 0;
    Serial.println("Transitioning to listening mode");

    i2sInputFlushScheduled = true;
    i2sOutputFlushScheduled = true;

    Serial.println("Transitioned to listening mode");

    requestI2SRate(MIC_SAMPLE_RATE);
    deviceState = LISTENING;
    audioBoardSetAmp(false);
    // webSocket.disableHeartbeat();
}

// audioStreamTask -> copier.copy() (conditional on webSocket.isConnected())
void audioStreamTask(void *parameter) {
    Serial.println("Starting I2S stream pipeline...");
    
    audioBoardSetAmp(false);

    OpusSettings cfg;
    cfg.sample_rate = SAMPLE_RATE;
    cfg.channels = CHANNELS;
    cfg.bits_per_sample = BITS_PER_SAMPLE;
    // A 120ms Opus frame decoded at 48kHz mono s16 is 11520 bytes; 6144 only
    // fit the old 24kHz pipeline.
    cfg.max_buffer_size = 16384;

    xSemaphoreTake(wsMutex, portMAX_DELAY);
    opusDecoder.setOutput(bufferPrint);
    opusDecoder.begin(cfg);
    // libopus (NONTHREADSAFE_PSEUDOSTACK) mallocs a 60 KB scratch block on
    // its first decode and keeps it. Without PSRAM, after the TLS handshake
    // the largest free block can be smaller than that, ALLOC returns NULL and
    // the first server reply crashes in silk_decode_frame. Decode one empty
    // (lost) packet now so the scratch is taken while the heap is contiguous.
    Serial.printf("[Opus] before warm-up: scratch=%p free=%u largest=%u\n", global_stack,
                  (unsigned)ESP.getFreeHeap(), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    {
        // A throwaway decoder: the scratch block is global to libopus. Must be
        // a valid PLC frame size (multiple of 2.5 ms), or opus_decode returns
        // OPUS_BAD_ARG before it allocates anything.
        int size = opus_decoder_get_size(1);
        OpusDecoder *warm = (OpusDecoder *)malloc(size);
        if (warm && opus_decoder_init(warm, 48000, 1) == OPUS_OK) {
            static int16_t pcm[960];  // 20 ms at 48 kHz
            opus_decode(warm, nullptr, 0, pcm, 960, 0);
        }
        free(warm);
    }
    Serial.printf("[Opus] after warm-up:  scratch=%p free=%u largest=%u\n", global_stack,
                  (unsigned)ESP.getFreeHeap(), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
    xSemaphoreGive(wsMutex);

    audioBuffer.setReadMaxWait(0);
    
    queue.begin();

    auto config = i2s.defaultConfig(TX_MODE);
    config.bits_per_sample = BITS_PER_SAMPLE;
    config.sample_rate = SAMPLE_RATE;
    config.channels = CHANNELS;
    config.pin_bck = I2S_BCK_OUT;
    config.pin_ws = I2S_WS_OUT;
    config.pin_data = I2S_DATA_OUT;
    config.port_no = I2S_PORT_OUT;

    config.copyFrom(info);  
#ifdef ELATO_BOARD_VOICE_V1
    // One full-duplex port for ES8311 (out) and ES7210 (in). Stays mono
    // 16-bit like the MAX98357A path; I2SStream expands/reduces the two slots.
    config.rx_tx_mode = RXTX_MODE;
    config.pin_mck = I2S_MCLK_PIN;
    config.pin_data_rx = I2S_DIN_PIN;
    config.i2s_format = I2S_STD_FORMAT;
    // One port carries both DMA directions in stereo (24 KB at the default
    // 6 x 512 frames vs 18 KB on the two-port MAX98357A/INMP441 board).
    // Without PSRAM that RAM is needed by WiFi RX buffers: at 6 x 512 the
    // heap left during a reply was ~3 KB largest block and the TCP stream
    // stalled. 6 x 256 frames = 32 ms of DMA, 12 KB total.
    config.buffer_size = VOICE_V1_I2S_DMA_FRAMES;
#endif
    // Cover all configured DMA samples plus an acoustic tail after the last
    // blocking write. Queue-empty alone does not mean I2S finished playing.
    speakerDrainGuardMs = 250 +
        (1000UL * config.buffer_count * config.buffer_size + SAMPLE_RATE - 1) / SAMPLE_RATE;
    i2s.begin(config);  
#ifdef ELATO_BOARD_VOICE_V1
    i2sRateActive = SAMPLE_RATE;
    audioBoardBeginCodecs();  // codecs need MCLK running first
    {
        // Bring-up: 0.6 s, 1 kHz beep straight to I2S (bypasses server/Opus).
        Serial.println("[Beep] playing 1 kHz test tone");
        audioBoardSetAmp(true);
        static int16_t tone[480];
        for (int i = 0; i < 480; ++i)
            tone[i] = (int16_t)(8000.0f * sinf(2.0f * PI * 1000.0f * i / 48000.0f));
        for (int n = 0; n < 60; ++n) i2s.write((uint8_t *)tone, sizeof(tone));  // 60 x 10 ms
        delay(100);
        audioBoardSetAmp(false);
        Serial.println("[Beep] done");
    }
    i2sPortReady = true;
#endif

    // Initialize both volume streams once
    auto vcfg = volume.defaultConfig();
    vcfg.copyFrom(info);
    vcfg.allow_boost = true;
    volume.begin(vcfg);
    
    auto vcfgPitch = volumePitch.defaultConfig();
    vcfgPitch.copyFrom(info);
    vcfgPitch.allow_boost = true;
    volumePitch.begin(vcfgPitch);

    while (1) {
        if (shutdownInProgress) {
            // Drain a producer already inside the decoder so shutdown can
            // acquire wsMutex, but never write more data to the speaker.
            while (queue.available() > 0) queue.read();
            vTaskDelay(1);
            continue;
        }
#ifdef ELATO_BOARD_VOICE_V1
        if (i2sRateRequested != i2sRateActive) {
            uint32_t rate = i2sRateRequested;
            i2s.setAudioInfo(AudioInfo(rate, CHANNELS, BITS_PER_SAMPLE));
            i2sInputFlushScheduled = true;  // drop samples taken at the old rate
            i2sRateActive = rate;
            Serial.printf("[I2S] rate -> %lu Hz\n", (unsigned long)rate);
        }
#endif
        if ( i2sOutputFlushScheduled) {
            i2sOutputFlushScheduled = false;
            i2s.flush();
            volume.flush();
            volumePitch.flush();
            // QueueStream::flush() does not empty its buffer. Drain on the
            // consumer task so interrupted PCM cannot leak into the next turn,
            // and a producer blocked in the decoder can finish safely.
            uint8_t discarded[256];
            while (queue.available() > 0) {
                queue.readBytes(discarded, min(int(sizeof(discarded)), queue.available()));
            }
        }

        if (webSocket.isConnected() && deviceState == SPEAKING && speakerRateReady()) {
            speakerCopyActive = true;
            size_t copied = 0;
            if (currentPitchFactor != 1.0f) {
                copied = pitchCopier.copy();
            } else {
                copied = copier.copy();
            }
            if (copied > 0) lastSpeakerWriteTime = millis();
            speakerCopyActive = false;
        }
        else {
            //we should always read from audioBuffer, otherwise writing thread can stuck
            queue.read();
        }
        vTaskDelay(1); 
    }
}


class WebsocketStream : public Print {
public:
    // micTask -> micToWsCopier.copyBytes() -> wsStream.write()
    virtual size_t write(uint8_t b) override {
        if (shutdownInProgress || !webSocket.isConnected() || deviceState != LISTENING) {
            return 1;
        }
        
        xSemaphoreTake(wsMutex, portMAX_DELAY);
        if (!shutdownInProgress && webSocket.isConnected() && deviceState == LISTENING) webSocket.sendBIN(&b, 1);
        xSemaphoreGive(wsMutex);
        return 1;
    }
    
    // micTask -> micToWsCopier.copyBytes() -> wsStream.write()
    virtual size_t write(const uint8_t *buffer, size_t size) override {
        if (shutdownInProgress || size == 0 || !webSocket.isConnected() || deviceState != LISTENING) {
            return size;
        }
        
#ifdef ELATO_BOARD_VOICE_V1
        // Bring-up: mic level once per second of audio sent.
        {
            static double sumSq = 0; static int32_t peak = 0; static uint32_t n = 0;
            const int16_t *smp = (const int16_t *)buffer;
            for (size_t i = 0; i < size / 2; ++i) {
                int32_t v = smp[i]; sumSq += (double)v * v;
                if (abs(v) > peak) peak = abs(v);
            }
            n += size / 2;
            if (n >= MIC_SAMPLE_RATE) {
                Serial.printf("[Mic] rms=%d peak=%d (sent %lu samples)\n",
                              (int)sqrt(sumSq / n), (int)peak, (unsigned long)n);
                sumSq = 0; peak = 0; n = 0;
            }
        }
#endif
        xSemaphoreTake(wsMutex, portMAX_DELAY);
        if (!shutdownInProgress && webSocket.isConnected() && deviceState == LISTENING) webSocket.sendBIN(buffer, size);
        xSemaphoreGive(wsMutex);
        return size;
    }
};

WebsocketStream wsStream; //guard with wsMutex
I2SStream i2sInput; //access from micTask only
#ifdef ELATO_BOARD_VOICE_V1
// Shared port: the mic reads the same I2SStream the speaker task started.
StreamCopy micToWsCopier(wsStream, i2s);
#else
StreamCopy micToWsCopier(wsStream, i2sInput);
#endif
volatile bool i2sInputFlushScheduled = false;
const int MIC_COPY_SIZE = 64;
size_t micDiscardLimit = 0;

// I2SStream::flush() is a no-op in the bundled audio-tools version. Drain RX
// with zero timeout so recorded speaker echo cannot survive a mic handoff.
void discardMicAudio() {
    uint8_t scratch[256];
    size_t discarded = 0;
    while (discarded < micDiscardLimit) {
        size_t bytesRead = 0;
        if (i2s_read(I2S_PORT_IN, scratch, sizeof(scratch), &bytesRead, 0) != ESP_OK ||
            bytesRead == 0) break;
        discarded += bytesRead;
    }
}

void micTask(void *parameter) {
#ifdef ELATO_BOARD_VOICE_V1
    // audioStreamTask owns and starts the shared port.
    while (!i2sPortReady) vTaskDelay(pdMS_TO_TICKS(10));
    {
        auto c = i2s.defaultConfig(RXTX_MODE);
        micDiscardLimit = c.buffer_count * VOICE_V1_I2S_DMA_FRAMES * 4;
    }
#else
    // Configure and start I2S input stream.
    auto i2sConfig = i2sInput.defaultConfig(RX_MODE);
    i2sConfig.bits_per_sample = BITS_PER_SAMPLE;
    i2sConfig.sample_rate = MIC_SAMPLE_RATE;
    i2sConfig.channels = CHANNELS;
    i2sConfig.i2s_format = I2S_LEFT_JUSTIFIED_FORMAT;
    i2sConfig.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
    // Configure your I2S input pins appropriately here:
    i2sConfig.pin_bck = I2S_SCK;
    i2sConfig.pin_ws  = I2S_WS;
    i2sConfig.pin_data = I2S_SD;
    i2sConfig.port_no = I2S_PORT_IN;
    micDiscardLimit = i2sConfig.buffer_count * i2sConfig.buffer_size * 4;
    i2sInput.begin(i2sConfig);
#endif

    micToWsCopier.setDelayOnNoData(0);

    while (1) {
        if (shutdownInProgress) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        if (i2sInputFlushScheduled) {
            i2sInputFlushScheduled = false;
            discardMicAudio();
        }

        if (deviceState == LISTENING && webSocket.isConnected() && micRateReady()) {
            // Use smaller chunk size to avoid blocking too long
            micToWsCopier.copyBytes(MIC_COPY_SIZE);
            
            // Yield more frequently
            vTaskDelay(1);
        } else {
            discardMicAudio();
            vTaskDelay(10);
        }
    }
}

// WEBSOCKET EVENTS
// networkTask -> webSocket.loop() -> webSocketEvent()
void webSocketEvent(WStype_t type, const uint8_t *payload, size_t length)
{
    if (shutdownInProgress) return;
    switch (type)
    {
    case WStype_DISCONNECTED:
        interruptedResponse = false;
        speechInterruptRequested.store(false);
        Serial.printf("[WSc] Disconnected!\n");
        deviceState = IDLE;
        scheduleListeningRestart = false;
        activePlaybackId = pendingPlaybackId = 0;
        i2sOutputFlushScheduled = true;
        break;
    case WStype_CONNECTED:
        Serial.printf("[WSc] Connected to url: %s\n", payload);
        deviceState = PROCESSING;
        break;
    case WStype_TEXT:
    {
        Serial.printf("[WSc] get text: %s\n", payload);

        JsonDocument doc;
        DeserializationError error = deserializeJson(doc, (char *)payload);

        if (error)
        {
            Serial.println("Error deserializing JSON");
            deviceState = IDLE;
            return;
        }

        String type = doc["type"];

        // auth messages
        if (strcmp((char*)type.c_str(), "auth") == 0) {
            Serial.println("[Auth] Voice server authenticated the device");
            currentVolume = doc["volume_control"].as<int>();
            currentPitchFactor = doc["pitch_factor"].as<float>();

            bool is_ota = doc["is_ota"].as<bool>();
            bool is_reset = doc["is_reset"].as<bool>();

            // Update volumes on both streams
            volume.setVolume(currentVolume / 100.0f);
            volumePitch.setVolume(currentVolume / 100.0f);
            
            // Only initialize pitch shift if needed
            if (currentPitchFactor != 1.0f) {
                auto pcfg = pitchShift.defaultConfig();
                pcfg.copyFrom(info);
                pcfg.pitch_shift = currentPitchFactor;
                pcfg.buffer_size = 512;
                pitchShift.begin(pcfg);
            }

            if (is_ota) {
                Serial.println("OTA update received");
                setOTAStatusInNVS(OTA_IN_PROGRESS);
                ESP.restart();
            }

            if (is_reset) {
                Serial.println("Factory reset received");
                // setFactoryResetStatusInNVS(true);
                ESP.restart();
            }
        }

        // oai messages
        if (strcmp((char*)type.c_str(), "server") == 0) {
            String msg = doc["msg"];
            Serial.println(msg);

            if (strcmp((char*)msg.c_str(), "RESPONSE.COMPLETE") == 0 || strcmp((char*)msg.c_str(), "RESPONSE.ERROR") == 0) {
                if (interruptedResponse) break;
                // A playback_id means the server wants a handoff: finish playing the
                // queued audio, then ack with PLAYBACK.COMPLETE before listening.
                uint32_t playbackId = doc["playback_id"] | 0UL;
                if (msg == "RESPONSE.COMPLETE" && playbackId != 0) {
                    if (playbackId == activePlaybackId &&
                        (deviceState == SPEAKING || deviceState == LISTENING)) {
                        pendingPlaybackId = playbackId;
                        playbackDrainRequestedTime = millis();
                    }
                    break;
                }
                Serial.println("Received RESPONSE.COMPLETE or RESPONSE.ERROR, starting listening again");
                pendingPlaybackId = 0;

                // Check if volume_control is included in the message
                if (doc.containsKey("volume_control")) {
                    int newVolume = doc["volume_control"].as<int>();
                    volume.setVolume(newVolume / 100.0f);
                }

                scheduleListeningRestart = true;
                scheduledTime = millis() + 1000; // 1 second delay
            } else if (strcmp((char*)msg.c_str(), "AUDIO.COMMITTED") == 0) {
                deviceState = PROCESSING; 
            } else if (strcmp((char*)msg.c_str(), "RESPONSE.CREATED") == 0) {
                Serial.printf("[Opus] at RESPONSE.CREATED: scratch=%p free=%u largest=%u\n", global_stack,
                              (unsigned)ESP.getFreeHeap(), (unsigned)heap_caps_get_largest_free_block(MALLOC_CAP_8BIT));
                interruptedResponse = false;
                Serial.println("Received RESPONSE.CREATED, transitioning to speaking");
                // Production sends live volume changes on RESPONSE.CREATED.
                if (doc["volume_control"].is<int>()) {
                    int newVolume = constrain(doc["volume_control"].as<int>(), 0, 100);
                    volume.setVolume(newVolume / 100.0f);
                    volumePitch.setVolume(newVolume / 100.0f);
                }
                transitionToSpeaking();
                activePlaybackId = doc["playback_id"] | 0UL;
            } else if (strcmp((char*)msg.c_str(), "SESSION.END") == 0) {
                Serial.println("Received SESSION.END, going to sleep");
                sleepRequested = true;
            }
        }
    }
        break;
    case WStype_BIN:
    {
        if (scheduleListeningRestart || deviceState != SPEAKING) {
            Serial.println("Skipping audio data due to touch interrupt.");
            break;
        }

        // Otherwise process the audio data normally
        size_t processed = opusDecoder.write(payload, length);
        if (processed != length) {
            Serial.printf("Warning: Only processed %d/%d bytes\n", processed, length);
        }
        break;
      }
    case WStype_ERROR:
        Serial.printf("[WSc] Error: %s\n", payload);    
        break;
    case WStype_FRAGMENT_TEXT_START:
    case WStype_FRAGMENT_BIN_START:
    case WStype_FRAGMENT:
    case WStype_PONG:
    case WStype_PING:
    case WStype_FRAGMENT_FIN:
        break;
    }
}

// wifiTask -> WIFIMANAGER::loop() -> WIFIMANAGER::tryConnect() -> connectCb() -> websocketSetup()
void websocketSetup(const String& server_domain, int port, const String& path)
{
    if (shutdownInProgress) return;
    static String wsExtraHeaders;
    wsExtraHeaders =
        "Authorization: Bearer " + String(authTokenGlobal) + "\r\n" +
        "X-Wifi-Rssi: " + String(WiFi.RSSI()) + "\r\n" +
        "X-Elato-Playback-Ack: 1\r\n" +
        "X-Device-Mac: " + WiFi.macAddress();

    xSemaphoreTake(wsMutex, portMAX_DELAY);
    if (shutdownInProgress) {
        xSemaphoreGive(wsMutex);
        return;
    }

    webSocket.setExtraHeaders(wsExtraHeaders.c_str());
    webSocket.onEvent(webSocketEvent);
    webSocket.setReconnectInterval(1000);
    webSocket.disableHeartbeat();

    // webSocket.enableHeartbeat(30000, 15000, 3); // 30s ping interval, 15s timeout, 3 retries

    #ifdef DEV_MODE
    webSocket.begin(server_domain.c_str(), port, path.c_str());
    #else
    webSocket.beginSslWithCA(server_domain.c_str(), port, path.c_str(), CA_cert);
    #endif

    xSemaphoreGive(wsMutex);
}

// networkTask -> webSocket.loop()
void networkTask(void *parameter) {
    while (1) {
        if (shutdownInProgress) {
            vTaskDelay(pdMS_TO_TICKS(10));
            continue;
        }
        xSemaphoreTake(wsMutex, portMAX_DELAY);
        if (shutdownInProgress) {
            xSemaphoreGive(wsMutex);
            continue;
        }

        if (speechInterruptRequested.exchange(false) && deviceState == SPEAKING) {
            unsigned long playedMs = getSpeakingDuration();
            interruptedResponse = true;
            // Mute immediately, discard queued playback, and resume listening.
            transitionToListening();
            JsonDocument interrupt;
            interrupt["type"] = "instruction";
            interrupt["msg"] = "INTERRUPT";
            interrupt["audio_end_ms"] = playedMs;
            String text;
            serializeJson(interrupt, text);
            if (webSocket.isConnected()) webSocket.sendTXT(text);
            Serial.printf("Input short press: interrupted speech at %lu ms\n", playedMs);
        }

        // Check to see if a transition to listening mode is scheduled.
        if (scheduleListeningRestart && (long)(millis() - scheduledTime) >= 0) {
            transitionToListening();
        }

        webSocket.loop();
#ifdef ELATO_BOARD_VOICE_V1
        {   // Bring-up: why is playback not handing back to listening?
            static unsigned long lastDbg = 0;
            if (deviceState == SPEAKING && millis() - lastDbg >= 1000) {
                lastDbg = millis();
                Serial.printf("[Drain] active=%lu pending=%lu copyActive=%d buf=%d sinceWrite=%lu sinceReq=%lu guard=%lu rate=%lu\n",
                    (unsigned long)activePlaybackId, (unsigned long)pendingPlaybackId, (int)speakerCopyActive,
                    audioBuffer.available(), millis() - lastSpeakerWriteTime,
                    millis() - playbackDrainRequestedTime, speakerDrainGuardMs, (unsigned long)i2sRateActive);
            }
        }
#endif
        if (pendingPlaybackId != 0 &&
            (deviceState == SPEAKING || deviceState == LISTENING) &&
            !speakerCopyActive && audioBuffer.available() == 0 &&
            millis() - lastSpeakerWriteTime >= speakerDrainGuardMs &&
            millis() - playbackDrainRequestedTime >= speakerDrainGuardMs) {
            uint32_t completedId = pendingPlaybackId;
            // Turn the amp off and flush input before permitting mic frames.
            transitionToListening();
            JsonDocument ack;
            ack["type"] = "instruction";
            ack["msg"] = "PLAYBACK.COMPLETE";
            ack["playback_id"] = completedId;
            String text;
            serializeJson(ack, text);
            webSocket.sendTXT(text);
        }
        xSemaphoreGive(wsMutex);

        vTaskDelay(1);
    }
}
