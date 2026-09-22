import {describe,it,expect} from "vitest";
import {allocateUsage,usableSeconds} from "./entitlement";
describe("entitlement",()=>{
 it("uses free first",()=>expect(allocateUsage({freeSecondsRemaining:300,paidCreditsRemaining:5},360)).toEqual({freeSecondsUsed:300,paidCreditsUsed:1}));
 it("never exceeds paid balance",()=>expect(allocateUsage({freeSecondsRemaining:0,paidCreditsRemaining:2},999)).toEqual({freeSecondsUsed:0,paidCreditsUsed:2}));
 it("computes usable seconds",()=>expect(usableSeconds({freeSecondsRemaining:120,paidCreditsRemaining:3})).toBe(300));
});
