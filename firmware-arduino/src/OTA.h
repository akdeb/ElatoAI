#ifndef OTA_H
#define OTA_H

#include "Config.h"

void performOTAUpdate();
void markOTAUpdateComplete();
void loopOTA();
void setOTAStatusInNVS(OtaStatus status);
void getOTAStatusFromNVS();

#endif
