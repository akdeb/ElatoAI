#include <nvs_flash.h>
#include "Config.h"

// ! define preferences
Preferences preferences;
OtaStatus otaState = OTA_IDLE;
bool factory_reset_status = false;
volatile bool sleepRequested = false;

/**
 * Configuration for Elato Firmware
 * 
 * DEVELOPMENT vs PRODUCTION vs ELATO SETUP:
 * --------------------------------
 * 1. Define `DEV_MODE` in your config.h file to use local development servers
 * 2. `DEV_MODE` requires updating the IP addresses to your local network IP
 * 3. Without `DEV_MODE` defined, the firmware will use your production servers
 *
 * VOICE BACKEND SELECTION:
 * --------------------------------
 * Keep the deployment mode (DEV/PROD/ELATO) separate from the voice backend
 * (`VOICE_SERVER_DENO` vs `VOICE_SERVER_CLOUDFLARE`).
 * This avoids an extra device-side config lookup while still letting us switch
 * websocket backends at build time.
 *
 * The selector only applies to DEV_MODE and PROD_MODE: ELATO_MODE always talks
 * to Elato's hosted server (the FastAPI server in `server/fastapi`, on Railway).
 *
 * DEV SETUP (find your local IP address using ifconfig):
 *   - WebSocket: Your local IP (e.g., 192.168.1.100:8000)
 *   - Backend: Your local IP (e.g., 192.168.1.100:3000)
 *   - No SSL certificates required
 *
 * PROD SETUP:
 *   - WebSocket: <your-websocket-server>.deno.dev (port 443)
 *   - Backend: <your-vercel-backend-server> (port 3000)
 *   - Use your own SSL certificates (set in Config.cpp)
 *
 * ELATO SETUP:
 *   - WebSocket: elato-pyserver-production.up.railway.app (port 443, path /ws/esp32)
 *   - Backend: https://www.elatoai.com (port 3000)
 *   - Uses pre-configured SSL certificates (set in Config.cpp)
 */

#ifdef DEV_MODE
const char *ws_server = "192.168.1.33";
const char *ws_path = "/";

#if defined(VOICE_SERVER_DENO)
const uint16_t ws_port = 8000;
#elif defined(VOICE_SERVER_CLOUDFLARE)
const uint16_t ws_port = 8787;
#endif

// Backend server details
const char *backend_server = "192.168.1.33";
const uint16_t backend_port = 3000;

#elif defined(PROD_MODE)
// PROD - self-hosted. Pick VOICE_SERVER_DENO or VOICE_SERVER_CLOUDFLARE above.
#if defined(VOICE_SERVER_DENO)
const char *ws_server = "<your-edge-server>.deno.dev";
const uint16_t ws_port = 443;
const char *ws_path = "/";
#elif defined(VOICE_SERVER_CLOUDFLARE)
const char *ws_server = "<your-cloudflare-server>.workers.dev";
const uint16_t ws_port = 443;
const char *ws_path = "/ws/esp32";
#else
#error "PROD_MODE requires VOICE_SERVER_DENO or VOICE_SERVER_CLOUDFLARE in Config.h"
#endif
// Backend server details
const char *backend_server = "<your-backend-server-url>"; // like www.facebook.com or facebook.vercel.app
const uint16_t backend_port = 3000;

#elif defined(ELATO_MODE)
// ELATO
// Elato's hosted voice server is the FastAPI server (`server/fastapi`) on Railway.
// This is fixed regardless of the VOICE_SERVER_* selector.
const char *ws_server = "elato-pyserver-production.up.railway.app";
const uint16_t ws_port = 443;
const char *ws_path = "/ws/esp32";
// Backend server details
const char *backend_server = "www.elatoai.com"; // like www.facebook.com or facebook.vercel.app
const uint16_t backend_port = 3000;
#endif

String authTokenGlobal;
volatile DeviceState deviceState = IDLE;

// I2S and Audio parameters
// Output pipeline rate: Opus decodes any incoming stream to this rate, so the
// server's encode rate (24kHz on the Deno/Cloudflare/FastAPI servers) doesn't
// need to match. 48kHz drives the DAC/amp at its best-sounding rate.
const uint32_t SAMPLE_RATE = 48000;
const uint32_t MIC_SAMPLE_RATE = 16000;

// ----------------- Pin Definitions -----------------
const i2s_port_t I2S_PORT_IN = I2S_NUM_1;
const i2s_port_t I2S_PORT_OUT = I2S_NUM_0;

const int BLUE_LED_PIN = 13;
const int RED_LED_PIN = 9;
const int GREEN_LED_PIN = 8;

const int I2S_SD = 14;
const int I2S_WS = 4;
const int I2S_SCK = 1;

const int I2S_WS_OUT = 5;
const int I2S_BCK_OUT = 6;
const int I2S_DATA_OUT = 7;
const int I2S_SD_OUT = 10;

const gpio_num_t BUTTON_PIN = GPIO_NUM_2; // Only RTC IO are allowed - ESP32 Pin example


// ----------------- SSL Certificates -----------------


#ifdef PROD_MODE

// add the CA cert for your backend server here `backend_server`
const char *Vercel_CA_cert = R"EOF(
-----BEGIN CERTIFICATE-----
<YOUR VERCEL CERTIFICATE HERE>
-----END CERTIFICATE-----
)EOF";

// Voice websocket CA cert for the selected voice websocket server (`ws_server`).
const char *CA_cert = R"EOF(
-----BEGIN CERTIFICATE-----
<YOUR VOICE SERVER CERTIFICATE HERE>
-----END CERTIFICATE-----
)EOF";


#elif defined(ELATO_MODE)

// CA cert for `www.elatoai.com` (Vercel). The leaf chains up to ISRG Root X1.
const char *Vercel_CA_cert = R"EOF(
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";


// Voice websocket CA bundle for `elato-pyserver-production.up.railway.app`
// (the FastAPI server in `server/fastapi`, deployed on Railway).
// The wildcard leaf is issued by Let's Encrypt "YE1" (ECDSA P-384). The S3 has
// no ECC accelerator, so every P-384 signature verify costs ~1s of CPU; pinning
// the issuing intermediate lets mbedTLS stop after verifying just the leaf.
// The certs further up the chain stay in the bundle so the connection survives
// an LE intermediate rotation (it just verifies more of the chain again):
//   1. YE1 (Let's Encrypt intermediate)   - expires Sep  2 2028
//   2. Root YE (ISRG root)                - expires Sep  2 2032
//   3. ISRG Root X2 (ECDSA)               - expires Sep 17 2040
//   4. ISRG Root X1 (RSA)                 - expires Jun  4 2035
const char *CA_cert = R"EOF(
-----BEGIN CERTIFICATE-----
MIICizCCAhGgAwIBAgIQXd1w3TH4AchcGGp6BLgK/jAKBggqhkjOPQQDAzAuMQsw
CQYDVQQGEwJVUzENMAsGA1UEChMESVNSRzEQMA4GA1UEAxMHUm9vdCBZRTAeFw0y
NTA5MDMwMDAwMDBaFw0yODA5MDIyMzU5NTlaMDMxCzAJBgNVBAYTAlVTMRYwFAYD
VQQKEw1MZXQncyBFbmNyeXB0MQwwCgYDVQQDEwNZRTEwdjAQBgcqhkjOPQIBBgUr
gQQAIgNiAAQHZVB1/mimla2hfSurylScjPMZaOJXLz/NnAc2sylm8WDyhU9Ccp+z
ASQi5vSwGGJjSGklkD9fdPR8GpyDIOIjCEfrnbt/v+ZSEPLLEGbaM6EccDbN7p9x
teIm2Avf+ryjge4wgeswDgYDVR0PAQH/BAQDAgGGMBMGA1UdJQQMMAoGCCsGAQUF
BwMBMBIGA1UdEwEB/wQIMAYBAf8CAQAwHQYDVR0OBBYEFLsgykcL/tflnPmPCSqj
jDdFsbzYMB8GA1UdIwQYMBaAFKPIJlqOoUzQNWP8myPIOq5W809WMDIGCCsGAQUF
BwEBBCYwJDAiBggrBgEFBQcwAoYWaHR0cDovL3llLmkubGVuY3Iub3JnLzATBgNV
HSAEDDAKMAgGBmeBDAECATAnBgNVHR8EIDAeMBygGqAYhhZodHRwOi8veWUuYy5s
ZW5jci5vcmcvMAoGCCqGSM49BAMDA2gAMGUCMQDgjUEahFT/h3DRakqiPZpLvPgf
Zwkt6K2EOMmh1nvEzl83eMLYcod4GCl3b0J1Nn0CMBNYmEQJb4CEG5WoOe7aRn/L
VKu6saHmHEynI7ysIPd8zQsK1HdmhlHKlw9Z5GpGvA==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICpjCCAiugAwIBAgIRAIchZfw0tuX7qK3Vs3BftTowCgYIKoZIzj0EAwMwTzEL
MAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2VhcmNo
IEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDIwHhcNMjYwNTEzMDAwMDAwWhcN
MzIwOTAyMjM1OTU5WjAuMQswCQYDVQQGEwJVUzENMAsGA1UEChMESVNSRzEQMA4G
A1UEAxMHUm9vdCBZRTB2MBAGByqGSM49AgEGBSuBBAAiA2IABDwS/6vhrcVqcbBo
+wgdI3fwn9x7DNJJOY/lTOti0vkwuRN87RhEhTH17E7XyFjWsPYhIPt/wzOqxTd2
b+4ZJNy9ID04YywF9U5zasDVyGSNErVNtz8uSGh5izW87j77GaOB6zCB6DAOBgNV
HQ8BAf8EBAMCAQYwEwYDVR0lBAwwCgYIKwYBBQUHAwEwDwYDVR0TAQH/BAUwAwEB
/zAdBgNVHQ4EFgQUo8gmWo6hTNA1Y/ybI8g6rlbzT1YwHwYDVR0jBBgwFoAUfEKW
rt5LSDv6kviejM9ti6lyN5UwMgYIKwYBBQUHAQEEJjAkMCIGCCsGAQUFBzAChhZo
dHRwOi8veDIuaS5sZW5jci5vcmcvMBMGA1UdIAQMMAowCAYGZ4EMAQIBMCcGA1Ud
HwQgMB4wHKAaoBiGFmh0dHA6Ly94Mi5jLmxlbmNyLm9yZy8wCgYIKoZIzj0EAwMD
aQAwZgIxAMU19WCtmxVND8UHBZRoma49Z7jPs64Dma0eTu1OChVbB/2J7GV3nvYK
Ax54uk1G9QIxAO0miLVJu8PLNiXXXkiE/gsK3CTRTF/aeo4bMX42Zw40csRU6AC2
6hSW1/IWaas6dg==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICGzCCAaGgAwIBAgIQQdKd0XLq7qeAwSxs6S+HUjAKBggqhkjOPQQDAzBPMQsw
CQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJuZXQgU2VjdXJpdHkgUmVzZWFyY2gg
R3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBYMjAeFw0yMDA5MDQwMDAwMDBaFw00
MDA5MTcxNjAwMDBaME8xCzAJBgNVBAYTAlVTMSkwJwYDVQQKEyBJbnRlcm5ldCBT
ZWN1cml0eSBSZXNlYXJjaCBHcm91cDEVMBMGA1UEAxMMSVNSRyBSb290IFgyMHYw
EAYHKoZIzj0CAQYFK4EEACIDYgAEzZvVn4CDCuwJSvMWSj5cz3es3mcFDR0HttwW
+1qLFNvicWDEukWVEYmO6gbf9yoWHKS5xcUy4APgHoIYOIvXRdgKam7mAHf7AlF9
ItgKbppbd9/w+kHsOdx1ymgHDB/qo0IwQDAOBgNVHQ8BAf8EBAMCAQYwDwYDVR0T
AQH/BAUwAwEB/zAdBgNVHQ4EFgQUfEKWrt5LSDv6kviejM9ti6lyN5UwCgYIKoZI
zj0EAwMDaAAwZQIwe3lORlCEwkSHRhtFcP9Ymd70/aTSVaYgLXTWNLxBo1BfASdW
tL4ndQavEi51mI38AjEAi/V3bNTIZargCyzuFJ0nN6T5U6VR5CmD1/iQMVtCnwr1
/q4AaOeMSQ+2b1tbFfLn
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFazCCA1OgAwIBAgIRAIIQz7DSQONZRGPgu2OCiwAwDQYJKoZIhvcNAQELBQAw
TzELMAkGA1UEBhMCVVMxKTAnBgNVBAoTIEludGVybmV0IFNlY3VyaXR5IFJlc2Vh
cmNoIEdyb3VwMRUwEwYDVQQDEwxJU1JHIFJvb3QgWDEwHhcNMTUwNjA0MTEwNDM4
WhcNMzUwNjA0MTEwNDM4WjBPMQswCQYDVQQGEwJVUzEpMCcGA1UEChMgSW50ZXJu
ZXQgU2VjdXJpdHkgUmVzZWFyY2ggR3JvdXAxFTATBgNVBAMTDElTUkcgUm9vdCBY
MTCCAiIwDQYJKoZIhvcNAQEBBQADggIPADCCAgoCggIBAK3oJHP0FDfzm54rVygc
h77ct984kIxuPOZXoHj3dcKi/vVqbvYATyjb3miGbESTtrFj/RQSa78f0uoxmyF+
0TM8ukj13Xnfs7j/EvEhmkvBioZxaUpmZmyPfjxwv60pIgbz5MDmgK7iS4+3mX6U
A5/TR5d8mUgjU+g4rk8Kb4Mu0UlXjIB0ttov0DiNewNwIRt18jA8+o+u3dpjq+sW
T8KOEUt+zwvo/7V3LvSye0rgTBIlDHCNAymg4VMk7BPZ7hm/ELNKjD+Jo2FR3qyH
B5T0Y3HsLuJvW5iB4YlcNHlsdu87kGJ55tukmi8mxdAQ4Q7e2RCOFvu396j3x+UC
B5iPNgiV5+I3lg02dZ77DnKxHZu8A/lJBdiB3QW0KtZB6awBdpUKD9jf1b0SHzUv
KBds0pjBqAlkd25HN7rOrFleaJ1/ctaJxQZBKT5ZPt0m9STJEadao0xAH0ahmbWn
OlFuhjuefXKnEgV4We0+UXgVCwOPjdAvBbI+e0ocS3MFEvzG6uBQE3xDk3SzynTn
jh8BCNAw1FtxNrQHusEwMFxIt4I7mKZ9YIqioymCzLq9gwQbooMDQaHWBfEbwrbw
qHyGO0aoSCqI3Haadr8faqU9GY/rOPNk3sgrDQoo//fb4hVC1CLQJ13hef4Y53CI
rU7m2Ys6xt0nUW7/vGT1M0NPAgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNV
HRMBAf8EBTADAQH/MB0GA1UdDgQWBBR5tFnme7bl5AFzgAiIyBpY9umbbjANBgkq
hkiG9w0BAQsFAAOCAgEAVR9YqbyyqFDQDLHYGmkgJykIrGF1XIpu+ILlaS/V9lZL
ubhzEFnTIZd+50xx+7LSYK05qAvqFyFWhfFQDlnrzuBZ6brJFe+GnY+EgPbk6ZGQ
3BebYhtF8GaV0nxvwuo77x/Py9auJ/GpsMiu/X1+mvoiBOv/2X/qkSsisRcOj/KK
NFtY2PwByVS5uCbMiogziUwthDyC3+6WVwW6LLv3xLfHTjuCvjHIInNzktHCgKQ5
ORAzI4JMPJ+GslWYHb4phowim57iaztXOoJwTdwJx4nLCgdNbOhdjsnvzqvHu7Ur
TkXWStAmzOVyyghqpZXjFaH3pO3JLF+l+/+sKAIuvtd7u+Nxe5AW0wdeRlN8NwdC
jNPElpzVmbUq4JUagEiuTDkHzsxHpFKVK7q4+63SM1N95R1NbdWhscdCb+ZAJzVc
oyi3B43njTOQ5yOf+1CceWxG1bQVs5ZufpsMljq4Ui0/1lvh+wjChP4kqKOJ2qxq
4RgqsahDYVvTH9w7jXbyLeiNdd8XM2w9U/t7y0Ff/9yi0GE44Za4rF2LN9d11TPA
mRGunUHBcnWEvgJBQl9nJEiU0Zsnvgc/ubhPgXRR4Xq37Z0j4r7g1SgEEzwxA57d
emyPxgcYxn/eR44/KJ4EBs+lVDR3veyJm+kXQ99b21/+jh5Xos1AnX5iItreGCc=
-----END CERTIFICATE-----
)EOF";

#endif
