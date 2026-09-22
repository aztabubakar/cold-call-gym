export type VoiceEvent={type:"connected"}|{type:"text";text:string}|{type:"audio";data:string}|{type:"error";message:string}|{type:"closed"};
export interface VoiceProvider{
 connect(context:{systemPrompt:string}):Promise<void>;
 sendAudio(base64:string):Promise<void>;
 onEvent(handler:(event:VoiceEvent)=>void):void;
 close():Promise<void>;
}
