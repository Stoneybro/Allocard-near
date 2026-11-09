import { createHash, timingSafeEqual } from "node:crypto";
export function serviceAuthorized(request:Request,secret:string|undefined) {
 if(!secret||secret.length<32)return false;
 const hash=(value:string)=>createHash("sha256").update(value).digest();
 return timingSafeEqual(hash(request.headers.get("authorization")||""),hash(`Bearer ${secret}`));
}
