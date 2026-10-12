#include "OTA.h"
#include "Audio.h"
#include "PitchShift.h"

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
    
    deviceState = SPEAKING;
    digitalWrite(I2S_SD_OUT, HIGH);
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

    deviceState = LISTENING;
    digitalWrite(I2S_SD_OUT, LOW);
    // webSocket.disableHeartbeat();
}

// audioStreamTask -> copier.copy() (conditional on webSocket.isConnected())
void audioStreamTask(void *parameter) {
    Serial.println("Starting I2S stream pipeline...");
    
    pinMode(I2S_SD_OUT, OUTPUT);

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
    // Cover all configured DMA samples plus an acoustic tail after the last
    // blocking write. Queue-empty alone does not mean I2S finished playing.
    speakerDrainGuardMs = 250 +
        (1000UL * config.buffer_count * config.buffer_size + SAMPLE_RATE - 1) / SAMPLE_RATE;
    i2s.begin(config);  

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
        if ( i2sOutputFlushScheduled) {
            i2sOutputFlushScheduled = false;
            i2s.flush();
            volume.flush();
            volumePitch.flush();
            queue.flush();
        }

        if (webSocket.isConnected() && deviceState == SPEAKING) {
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
        
        xSemaphoreTake(wsMutex, portMAX_DELAY);
        if (!shutdownInProgress && webSocket.isConnected() && deviceState == LISTENING) webSocket.sendBIN(buffer, size);
        xSemaphoreGive(wsMutex);
        return size;
    }
};

WebsocketStream wsStream; //guard with wsMutex
I2SStream i2sInput; //access from micTask only
StreamCopy micToWsCopier(wsStream, i2sInput);
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

        if (deviceState == LISTENING && webSocket.isConnected()) {
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
                Serial.println("Received RESPONSE.CREATED, transitioning to speaking");
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
    const String headers =
        "Authorization: Bearer " + String(authTokenGlobal) + "\r\n" +
        "X-Wifi-Rssi: " + String(WiFi.RSSI()) + "\r\n" +
        "X-Elato-Playback-Ack: 1\r\n" +
        "X-Device-Mac: " + WiFi.macAddress();

    xSemaphoreTake(wsMutex, portMAX_DELAY);
    if (shutdownInProgress) {
        xSemaphoreGive(wsMutex);
        return;
    }

    webSocket.setExtraHeaders(headers.c_str());
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

        // Check to see if a transition to listening mode is scheduled.
        if (scheduleListeningRestart && (long)(millis() - scheduledTime) >= 0) {
            transitionToListening();
        }

        webSocket.loop();
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