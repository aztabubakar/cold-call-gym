export type Entitlement={freeSecondsRemaining:number;paidCreditsRemaining:number};
export function usableSeconds(e:Entitlement){return Math.max(0,e.freeSecondsRemaining)+Math.max(0,e.paidCreditsRemaining)*60}
export function allocateUsage(e:Entitlement,seconds:number){
 const safe=Math.max(0,Math.floor(seconds));
 const free=Math.min(Math.max(0,e.freeSecondsRemaining),safe);
 const paidSeconds=Math.max(0,safe-free);
 const paid=Math.min(Math.max(0,e.paidCreditsRemaining),Math.ceil(paidSeconds/60));
 return {freeSecondsUsed:free,paidCreditsUsed:paid};
}
