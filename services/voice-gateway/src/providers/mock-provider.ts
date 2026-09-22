import type {VoiceEvent,VoiceProvider} from "./voice-provider.js";
export class MockVoiceProvider implements VoiceProvider{
 private handler?: (e:VoiceEvent)=>void;
 async connect(_context:{systemPrompt:string}){queueMicrotask(()=>this.handler?.({type:"connected"}));queueMicrotask(()=>this.handler?.({type:"text",text:"Mock prospect connected."}))}
 async sendAudio(_data:string){}
 onEvent(h:(e:VoiceEvent)=>void){this.handler=h}
 async close(){this.handler?.({type:"closed"})}
}
