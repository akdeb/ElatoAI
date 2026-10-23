# MAX17048 battery reporting

The gauge PCB connects MAX17048 SDA to GPIO18 and SCL to GPIO17. Firmware
uses address `0x36` at 100 kHz. GPIO3/ALRT is not used for polling.

The firmware reads the gauge's state-of-charge and voltage registers once a
minute while awake, keeps the latest valid reading in RAM, and sends it to
`POST /api/device/battery` as soon as Wi-Fi and the existing auth token are
available. Successful uploads are spaced five minutes apart; failed uploads
retry after one minute. This request runs in a separate low-priority task so
it does not block the WebSocket/audio loop, and works with every voice backend.
It does not initiate a Wi-Fi connection or wake the device from deep sleep.

The gauge is not reset or quick-started when the ESP32 wakes. Before deep sleep,
the firmware releases SDA/SCL to their external pull-ups and leaves the gauge
tracking the battery with its default automatic hibernate behavior. Missing
or invalid gauge reads do not overwrite the previous cloud reading with zero.
The default gauge battery model and temperature compensation are unchanged.

## Set up the database and app

1. Apply `supabase/migrations/20261023000000_add_device_battery.sql` to the
   database used by the frontend. For a running local Supabase installation,
   run `supabase migration list --local`, review pending migrations, then run
   `supabase migration up --local` from the repository root. Docker must be
   running. For a hosted installation, apply this migration through your usual
   reviewed migration process. It adds nullable `battery_percent`,
   `battery_voltage_mv`, and `battery_updated_at` columns to `public.devices`.
2. Run/deploy the updated frontend (it also hosts the new API route). The route
   uses the existing `JWT_SECRET_KEY`, Supabase URL, and anon key. No new secret
   or voice-server deployment is required.
3. Ensure a device record has the ESP32's Wi-Fi MAC address (uppercase colon
   format) and is linked to the same user that the firmware's auth token belongs
   to. This is required even with `NEXT_PUBLIC_SKIP_DEVICE_REGISTRATION=True`:
   that option supplies a development user but does not create a device record.
   The API requires both the token's user ID and the registered MAC to match.
4. Build/upload `firmware-arduino` to the test PCB. Keep your existing input-mode
   and server settings in `src/Config.h`/`src/Config.cpp`. The current checkout
   uses **DEV_MODE**, so it calls the configured local frontend over HTTP;
   production uses HTTPS and the existing backend CA certificate.
   For the connected-board test, the development backend is
   `192.168.1.3:3100` because port 3000 is occupied by `elato-client-prod`.
   Upload speed is 115200 after higher-speed serial reads proved unreliable.

```sh
cd firmware-arduino
pio run
pio run --target upload --upload-port <your-serial-port>
pio device monitor --port <your-serial-port> --baud 115200
```

## Test on the new board

1. Connect a LiPo and power the board. Look for `[Battery] 64.5%, 3875 mV`
   (example values) in the serial monitor, followed by `[Battery] sync HTTP 200`.
   The gauge needs about one second after battery insertion before the first
   SOC estimate; the task waits 1.5 seconds before its first read.
2. Open **Settings → Device settings → Device battery**. It shows percentage,
   voltage, and when the reading was last reported. Settings refreshes every
   30 seconds while visible. A never-reported battery displays a dash, not 0%.
3. Leave a voice session running for more than five minutes; confirm another
   successful upload and a newer `devices.battery_updated_at` value.
4. Put the ESP32 to sleep. The last reading should remain visible and become
   older; no battery-only wakeups are scheduled. Wake it and confirm a fresh
   upload. A reading older than 15 minutes prompts you to wake the device.
5. On an original board without the gauge, expect a read-failure log once a
   minute, normal voice operation, and no fabricated battery upload.

`HTTP 403` means the MAC/user mapping does not match the token; `401` means
the token is invalid; `500` can indicate the migration is missing. A negative
HTTP status indicates a transport failure (check Wi-Fi, frontend address,
and the HTTPS certificate in production). Gauge read failures mean check the
battery supply, SDA/SCL wiring, pull-ups, and soldering.

## Software checks

```sh
cd frontend-nextjs
node --test tests/device-battery.test.cjs
npx tsc --noEmit --incremental false
npm run build
```

API tests use real signed test tokens and a local PostgREST stand-in, without
writing to a real database. They cover telemetry validation, 0%/100%, expired
and forged tokens, owner/MAC filters, unmatched devices, and database failures.

Register definitions and conversions follow the
[MAX17048 datasheet, register summary](https://www.analog.com/media/en/technical-documentation/data-sheets/MAX17048-MAX17049.pdf).
An actual battery/gauge read and sleep-current measurements require the PCB.
