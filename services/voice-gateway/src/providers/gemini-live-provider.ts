import type {VoiceEvent,VoiceProvider} from "./voice-provider.js";
/**
 * Implement against the current official Gemini Live API in Phase 4.
 * Never expose GEMINI_API_KEY to the browser.
 */
export class GeminiLiveProvider implements VoiceProvider{
 private handler?: (e:VoiceEvent)=>void;
 async connect(_context:{systemPrompt:string}){if(!process.env.GEMINI_API_KEY)throw new Error("GEMINI_API_KEY is not configured");throw new Error("Gemini Live adapter not implemented yet")}
 async sendAudio(_data:string){throw new Error("Gemini Live provider not connected")}
 onEvent(h:(e:VoiceEvent)=>void){this.handler=h}
 async close(){this.handler?.({type:"closed"})}
}
