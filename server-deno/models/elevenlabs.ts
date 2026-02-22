import { Buffer } from "node:buffer";
import type { RawData } from "npm:@types/ws";
// @ts-ignore
import {
	WebSocketConnection,
	type SessionConfig,
	type IncomingSocketEvent,
	type DisconnectionDetails
} from "npm:@elevenlabs/client";
import { addConversation, getDeviceInfo } from "../supabase.ts";
import {
	createOpusPacketizer,
	isDev,
	elevenLabsApiKey,
	SAMPLE_RATE,
} from "../utils.ts";

// Calculate audio level for debugging
function calculateAudioLevel(audioData: any): number {
	if (!audioData || audioData.length === 0) return 0;

	// Convert to 16-bit samples
	const samples = new Int16Array(audioData.buffer || audioData);
	let sum = 0;

	for (let i = 0; i < samples.length; i++) {
		sum += Math.abs(samples[i]);
	}

	return Math.round(sum / samples.length);
}

// Resample mono PCM16 little-endian audio with linear interpolation.
function resamplePcm16Mono(
	inputBytes: Buffer,
	fromRate: number,
	toRate: number,
): Buffer {
	if (fromRate === toRate || inputBytes.length === 0) {
		return inputBytes;
	}

	const inputSamples = inputBytes.length / 2;
	const outputSamples = Math.max(1, Math.floor((inputSamples * toRate) / fromRate));
	const output = Buffer.alloc(outputSamples * 2);

	for (let i = 0; i < outputSamples; i++) {
		const sourcePos = (i * fromRate) / toRate;
		const leftIndex = Math.floor(sourcePos);
		const rightIndex = Math.min(leftIndex + 1, inputSamples - 1);
		const frac = sourcePos - leftIndex;

		const left = inputBytes.readInt16LE(leftIndex * 2);
		const right = inputBytes.readInt16LE(rightIndex * 2);
		const sample = Math.round(left + (right - left) * frac);
		output.writeInt16LE(sample, i * 2);
	}

	return output;
}

export const connectToElevenLabs = async ({
	ws,
	payload,
	connectionPcmFile,
	firstMessage,
	closeHandler,
}: ProviderArgs) => {
	const agentId = payload.user.personality?.voice?.config?.config_id ??
		payload.user.personality?.oai_voice;
	const apiKey = elevenLabsApiKey;

	if (!agentId || !apiKey) {
		throw new Error("Agent ID or API key is missing");
	}

	const { user, supabase } = payload;
	const opus = createOpusPacketizer((packet) => ws.send(packet));

	// Queue messages until ElevenLabs connection is ready.
	const messageQueue: Array<{ data: RawData; isBinary: boolean }> = [];
	let isElevenLabsConnected = false;
	let elevenLabsConnection: WebSocketConnection | null = null;
	let hasResponseStarted = false;
	let elevenInputSampleRate = 16000;
	let elevenOutputSampleRate = 24000;

	// Handle messages from ESP32 ws client.
	const handleClientMessage = async (data: any, isBinary: boolean) => {
		try {
			if (isBinary) {
				if (isDev && connectionPcmFile) {
					await connectionPcmFile.write(data);
				}

				// Send audio to ElevenLabs using the expected input sample rate.
				if (isElevenLabsConnected && elevenLabsConnection) {
					const sourceBuffer = Buffer.from(data);
					const pcmForEleven = resamplePcm16Mono(
						sourceBuffer,
						SAMPLE_RATE,
						elevenInputSampleRate,
					);
					const base64Data = pcmForEleven.toString("base64");

					const audioLevel = calculateAudioLevel(data);
					console.log(
						`Sending audio chunk to ElevenLabs: raw=${data.length} bytes, resampled=${pcmForEleven.length} bytes, inRate=${SAMPLE_RATE}, elevenInRate=${elevenInputSampleRate}, level=${audioLevel}`,
					);

					try {
						elevenLabsConnection.sendMessage({
							user_audio_chunk: base64Data,
						});
					} catch (error) {
						console.error("Error sending audio to ElevenLabs:", error);
					}
				} else {
					console.log(
						`Cannot send audio - ElevenLabs connected: ${isElevenLabsConnected}, connection exists: ${!!elevenLabsConnection}`,
					);
				}
			} else {
				const message = JSON.parse(data.toString("utf-8"));

				if (message.type === "instruction") {
					switch (message.msg) {
						case "INTERRUPT":
							console.log("Interrupt detected");
							if (elevenLabsConnection) {
								elevenLabsConnection.sendMessage({
									type: "user_activity",
								});
							}
							break;

						case "END_SESSION":
							console.log("End session requested");
							if (elevenLabsConnection) {
								elevenLabsConnection.close();
							}
							break;
					}
				}
			}
		} catch (error) {
			console.error("Error handling client message:", error);
		}
	};

	// Register handlers immediately so early ESP32 audio is not dropped while ElevenLabs connects.
	ws.on("message", (data: any, isBinary: boolean) => {
		if (!isElevenLabsConnected) {
			messageQueue.push({ data, isBinary });
		} else {
			handleClientMessage(data, isBinary);
		}
	});

	ws.on("error", (error: any) => {
		console.error("ESP32 WebSocket error:", error);
		opus.close();
		elevenLabsConnection?.close();
	});

	ws.on("close", async (code: number, reason: string) => {
		console.log(`ESP32 WebSocket closed with code ${code}, reason: ${reason}`);
		await closeHandler();
		opus.close();
		elevenLabsConnection?.close();

		if (isDev && connectionPcmFile) {
			connectionPcmFile.close();
			console.log("Closed debug audio file.");
		}
	});

	try {
		// For server-side usage, we need to get a signed URL first.
		const signedUrlResponse = await fetch(
			`https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${agentId}`,
			{
				headers: {
					"xi-api-key": apiKey,
				},
			},
		);

		if (!signedUrlResponse.ok) {
			throw new Error(
				`Failed to get signed URL: ${signedUrlResponse.status} ${signedUrlResponse.statusText}`,
			);
		}

		const { signed_url } = await signedUrlResponse.json();

		const sessionConfig: SessionConfig = {
			signedUrl: signed_url,
			connectionType: "websocket",
		};

		elevenLabsConnection = await WebSocketConnection.create(sessionConfig);
		elevenInputSampleRate = elevenLabsConnection.inputFormat.sampleRate;
		elevenOutputSampleRate = elevenLabsConnection.outputFormat.sampleRate;

		console.log("Connected to ElevenLabs successfully!");
		console.log(
			`ElevenLabs formats: input=${elevenLabsConnection.inputFormat.format}_${elevenInputSampleRate}, output=${elevenLabsConnection.outputFormat.format}_${elevenOutputSampleRate}`,
		);
		isElevenLabsConnected = true;
		console.log(
			"ElevenLabs connection ready - conversation_initiation_metadata already processed by SDK",
		);

		elevenLabsConnection.onMessage(async (event: IncomingSocketEvent) => {
			console.log("ElevenLabs message type:", event);

			switch (event.type) {
				case "conversation_initiation_metadata":
					console.log("ElevenLabs conversation initiated (metadata received)");
					break;

				case "ping":
					console.log("Received ping from ElevenLabs, sending pong");
					if (event.ping_event?.event_id) {
						elevenLabsConnection?.sendMessage({
							type: "pong",
							event_id: event.ping_event.event_id,
						});
					}
					break;

				case "audio":
					if (event.audio_event?.audio_base_64) {
						if (!hasResponseStarted) {
							console.log(
								"Sending RESPONSE.CREATED to ESP32 (agent audio starting)",
							);
							opus.reset();
							ws.send(JSON.stringify({
								type: "server",
								msg: "RESPONSE.CREATED",
							}));
							hasResponseStarted = true;
						}

						const audioBuffer = Buffer.from(
							event.audio_event.audio_base_64,
							"base64",
						);
						const pcmForEsp32 = resamplePcm16Mono(
							audioBuffer,
							elevenOutputSampleRate,
							SAMPLE_RATE,
						);
						opus.push(pcmForEsp32);
					}
					break;

				case "user_transcript":
					if (event.user_transcription_event?.user_transcript) {
						console.log(
							"User transcript:",
							event.user_transcription_event.user_transcript,
						);
						addConversation(
							supabase,
							"user",
							event.user_transcription_event.user_transcript,
							user,
						);
					}
					break;

				case "agent_response":
					if (event.agent_response_event?.agent_response) {
						console.log("Agent response:", event.agent_response_event.agent_response);
						addConversation(
							supabase,
							"assistant",
							event.agent_response_event.agent_response,
							user,
						);

						console.log("Sending RESPONSE.COMPLETE to ESP32");
						opus.flush(true);
						hasResponseStarted = false;
						try {
							const device = await getDeviceInfo(supabase, user.user_id);
							ws.send(JSON.stringify({
								type: "server",
								msg: "RESPONSE.COMPLETE",
								volume_control: device?.volume ?? 100,
							}));
						} catch (error) {
							console.error("Error fetching updated device info:", error);
							ws.send(JSON.stringify({
								type: "server",
								msg: "RESPONSE.COMPLETE",
							}));
						}
					}
					break;

				case "vad_score":
					if (event.vad_score_event?.vad_score) {
						console.log("VAD score:", event.vad_score_event.vad_score);
					}
					break;

				case "internal_tentative_agent_response":
					if (
						event.tentative_agent_response_internal_event
							?.tentative_agent_response
					) {
						console.log(
							"Tentative response:",
							event.tentative_agent_response_internal_event
								.tentative_agent_response,
						);
					}
					break;

				case "conversation_end":
					console.log("ElevenLabs conversation ended");
					ws.send(JSON.stringify({
						type: "server",
						msg: "SESSION.END",
					}));
					break;

				default:
					console.log("Unknown ElevenLabs message:", event.type, event);
			}
		});

		elevenLabsConnection.onDisconnect((details: DisconnectionDetails) => {
			console.log("ElevenLabs connection closed:", details);
			opus.close();
			ws.close();
		});

		// Match OpenAI/Gemini flow by triggering the first assistant turn immediately.
		if (firstMessage?.trim()) {
			console.log("Sending initial user_message to ElevenLabs to start first turn");
			elevenLabsConnection.sendMessage({
				type: "user_message",
				text: firstMessage,
			});
		}

		// Process queued messages.
		while (messageQueue.length > 0) {
			const queuedMessage = messageQueue.shift();
			if (queuedMessage) {
				handleClientMessage(queuedMessage.data, queuedMessage.isBinary);
			}
		}
	} catch (error) {
		console.error("Failed to connect to ElevenLabs:", error);
		opus.close();

		let errorMessage = "RESPONSE.ERROR";
		if (error instanceof Error) {
			console.error("Error details:", error.message);
			if (error.message.includes("signed URL")) {
				errorMessage = "AUTH.ERROR";
			}
		}

		ws.send(JSON.stringify({
			type: "server",
			msg: errorMessage,
		}));
	}
};
