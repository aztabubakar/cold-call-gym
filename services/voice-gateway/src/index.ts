import Fastify from "fastify";
import websocket from "@fastify/websocket";
import {MockVoiceProvider} from "./providers/mock-provider.js";
import {GeminiLiveProvider} from "./providers/gemini-live-provider.js";
import type {VoiceProvider} from "./providers/voice-provider.js";

const app=Fastify({logger:true});
await app.register(websocket);
app.get("/health",async()=>({status:"ok",service:"voice-gateway",provider:process.env.VOICE_PROVIDER??"mock"}));
app.get("/ws",{websocket:true},socket=>{
 const provider:VoiceProvider=(process.env.VOICE_PROVIDER??"mock")==="gemini"?new GeminiLiveProvider():new MockVoiceProvider();
 provider.onEvent(e=>{if(socket.readyState===1)socket.send(JSON.stringify(e))});
 void provider.connect({systemPrompt:"You are a synthetic sales prospect in a cold-call training simulation. Behave realistically. Do not coach the caller during the call."}).catch((e:Error)=>{socket.send(JSON.stringify({type:"error",message:String(e.message??e)}));socket.close()});
 socket.on("message",(raw:Buffer)=>{try{const m=JSON.parse(raw.toString());if(m.type==="audio"&&typeof m.data==="string")void provider.sendAudio(m.data);if(m.type==="end"){void provider.close();socket.close()}}catch{socket.send(JSON.stringify({type:"error",message:"Invalid message"}))}});
 socket.on("close",()=>void provider.close());
});
await app.listen({port:Number(process.env.PORT??8787),host:"0.0.0.0"});
