-- Telemetry belongs to the physical device; null means it has not reported yet.
ALTER TABLE public.devices
  ADD COLUMN battery_percent real CHECK (battery_percent BETWEEN 0 AND 100),
  ADD COLUMN battery_voltage_mv integer CHECK (battery_voltage_mv BETWEEN 2500 AND 4500),
  ADD COLUMN battery_updated_at timestamptz;

COMMENT ON COLUMN public.devices.battery_updated_at IS
  'Server receipt time of the latest successful MAX17048 reading; not an online indicator.';
