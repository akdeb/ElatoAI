# Deploying guide

If you are ready to launch your next AI venture that helps people in a meaningful way, this is the guide for you. And we're here to support you in that journey. 

If you get stuck, join our Discord channel where AI enthusiasts from all around the world gather to discuss new ideas and help solve problems together. This is your invite: https://discord.gg/KJWxDPBRUj

## How to deploy

1. Elato consists of 4 main parts: the database hosted on supabase, the frontend that runs with NextJS, the server that runs on Deno edge functions and the firmware the runs on your ESP32 Arduino device. 

2. Setup your Supabase db. Follow the instructions here: [Supabase Setup and Usage Guide](../supabase/README.md)

3. Setup your NextJS frontend. Follow the instructions here: [NextJS Frontend Setup and Usage Guide](../frontend-nextjs/README.md)

4. Setup your Deno edge server. Follow the instructions here: [Deno Server Setup and Usage Guide](../server-deno/README.md)

5. Setup your ESP32 Arduino device. Follow the instructions here: [ESP32 Arduino Device Setup and Usage Guide](../firmware-arduino/README.md)

6. Putting it all together. Now you should have all the individual parts working together. For a single device, you can do not need to configure any device code settings on Supabase. For multiple devices, refer to the [Multiple Devices](MultipleDevices.md) guide.

7. For use cases and new ideas, refer to the [Use Cases](Usecases.md) guide.