# Elato AI WebSocket Server (Deno)

This directory contains the WebSocket server implementation for Elato AI, built with Deno.

## Prerequisites

- [Deno](https://deno.land/) installed on your system
- Network access (for both local development and deployment)

## Configuration

### Environment Variables

Create a `.env` file with the following variables:

```env
# Supabase Configuration
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_KEY=<YOUR-SUPABASE-ANON-KEY>

# OpenAI Configuration
OPENAI_API_KEY=<OPENAI_API_KEY>

# Azure OpenAI Configuration (for azure-openai provider)
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com
AZURE_OPENAI_API_KEY=<YOUR_AZURE_API_KEY>
AZURE_OPENAI_DEPLOYMENT_NAME=gpt-4o-realtime-preview

# Gemini Configuration
GEMINI_API_KEY=<GEMINI_API_KEY>

# Local Development
HOST=0.0.0.0
PORT=8000
DEV_MODE=True
```

### Provider Support

The server supports multiple AI providers:
- `openai` - Standard OpenAI Realtime API
- `azure-openai` - Azure OpenAI Realtime API (East US 2, Sweden Central)
- `gemini` - Google Gemini Live API

Set the provider in your personality configuration in the database.

## Running the Server

### Local Development

1. **Start the server**:
   ```bash
   # Navigate to the server-deno directory
   cd server-deno
   
   # Run the server (replace server.ts with your main file if different)
   deno run -A --env-file=.env main.ts
   ```

2. **Verify the server**:
   - The server should be running on port 8000 (default)
   - You should see a message confirming the server is listening

### Production Deployment

1. **Deploy to Deno Deploy**:
   - Create an account on [Deno Deploy](https://deno.com/deploy)
   - Create a new project
   - Connect your GitHub repository or upload your server code
   - Deploy to a custom domain (e.g., `your-app.deno.dev`)

2. **Update firmware configuration**:
   - In the firmware project, make sure `DEV_MODE` is NOT defined in Config.cpp
   - The WebSocket server will be set to your Deno Deploy URL

3. **Get the Root CA Certificate using terminal**:
   - To get the full certificate chain with the root CA:
   ```bash
   openssl s_client -showcerts -connect your-app.deno.dev:443 </dev/null
   ```
   - Copy the last certificate in the chain (the root CA certificate) including the BEGIN and END lines
   - Paste this into the `CA_cert` variable in Config.cpp

## Troubleshooting

### Connection Issues
- Ensure your ESP32 device and development computer are on the same network
- Check if any firewalls are blocking port 8000
- Verify your local IP address hasn't changed (dynamic IPs can change after reconnecting)

### Server Errors
- Check the server logs for error messages
- Ensure Deno has proper permissions to access network resources

## Additional Resources

- [Deno Documentation](https://docs.deno.com/runtime/)
- [Deno Deploy Documentation](https://docs.deno.com/deploy/manual/)
- [WebSocket API Reference](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
