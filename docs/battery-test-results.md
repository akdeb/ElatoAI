# Connected PCB test — 24 October 2026 (India time)

Tested the physical gauge board over CH340 USB serial, with a LiPo attached
and USB 5 V connected. This is the local development build in this checkout.

- Flashing and boot: passed at 115200 baud, with flash hashes verified.
  Higher-speed serial backup attempts were unreliable, so upload speed was
  reduced. The original boot/partition/app0 flash region (2,162,688 bytes) is
  backed up under `firmware-arduino/.pio/backups/received-board-before-battery.bin`.
  That ignored backup may contain device settings; keep it private.
- Gauge communication: real MAX17048 readings on GPIO18 SDA / GPIO17 SCL,
  100 kHz. Initial readings included 83.2% / 4181 mV and 84.0% / 4181 mV.
- Wi-Fi: provisioned through the board's existing setup API; credentials were
  stored on the device, without adding them to committed source files.
- Upload: board received HTTP 200 from `192.168.1.3:3100/api/device/battery`.
- Persistence: local `public.devices` stored 84.0078% / 4181 mV and a server
  timestamp; a subsequent startup reported 85.0547% / 4179 mV.
- Periodic sync: the next update arrived 299.619 seconds after the previous
  upload, storing 87.4922% / 4180 mV at `2026-10-23T18:44:48.114Z`.
  Settings refreshed to 87%, 4.18 V, and "Last reported just now."
- Settings: browser displayed 84%, then 85%, 4.18 V, and the reading's age.
- Browser edge cases: 0%, 100%, missing readings, old readings, and failed
  refresh preserving the previous value passed using temporary browser-only
  response fixtures. The real device reading was restored after the checks;
  fixtures were never written to the database.
- Software: PlatformIO build, TypeScript check, Next production build, and all
  six API tests passed.

The battery database migration was applied to **local Supabase**. The updated
frontend runs on port 3100; port 3000 belongs to `elato-client-prod`.

This battery test does not validate battery-only operation, charging temperature,
or sleep current. The old voice address `172.20.10.4:8000` was unreachable during
the initial battery test. In the subsequent voice test, Deno was started at
`192.168.1.3:8000`, the firmware voice address was updated and flashed, and Batman
(`openai`, voice `echo`) was selected for the development user. The server
confirmed an OpenAI connection, a completed response with output audio, incoming
PCB microphone frames, and a saved Batman user transcript. The Deno server binds
the LAN address because an unrelated Docker service occupies localhost:8000.

Initial battery-test application SHA-256 (before the voice address update):
`a39f52ab5c57dceac680072b1beef6870881594801a85b03183955df1e23933a`

## Hosted Elato follow-up — 25 October 2026 (India time)

- Confirmed a cached development token caused hosted authentication failures.
  Tokens now record their backend; legacy tokens and backend changes trigger
  fresh registration without clearing saved Wi-Fi settings.
- Flashed the physical-button build using `esp32-s3-n16r8`. The board detected
  approximately 8 MB PSRAM, authenticated with the hosted voice server using its
  cached hosted token after reboot, and completed an AI response without the
  Opus allocation crash observed with PSRAM disabled. The server then ended the
  session and the board entered sleep.
- The hosted battery endpoint is not deployed: it returned HTML with HTTP 200.
  Firmware now requires a JSON success acknowledgement and disables unsupported
  telemetry uploads for that boot while continuing local gauge readings.
- Firmware builds, all 11 battery/voice regression tests, button gesture tests,
  and whitespace checks passed. The production repository was not modified.

When deploying this branch, apply the battery migration and deploy the matching
API/frontend together. Hosted battery persistence remains unverified until that
deployment is available. Personal deployment/input selections in `Config.h`
are not included in the shared connection fixes.
