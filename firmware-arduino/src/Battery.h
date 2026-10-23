#pragma once

// MAX17048 on the gauge PCB: SDA GPIO18, SCL GPIO17, address 0x36.
// Polling does not use the ALRT/GPIO3 pin.
void setupBattery();
void prepareBatteryForSleep();
