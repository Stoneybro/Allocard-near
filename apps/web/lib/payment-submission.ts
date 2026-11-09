import type { PendingPayment } from "./pending-payment";
/** Track actual submission, rather than treating validation or a signature prompt as broadcast. */
export function paymentSubmission(account: string, treasury: string, requestId: string) {
  const key=`allocard-payment:${treasury}:${account}`;
  const read=():PendingPayment|null=>typeof localStorage==="undefined"?null:JSON.parse(localStorage.getItem(key)||"null");
  const initial=read();const tracked=initial?.request.request_id===requestId;
  return (submitted:boolean)=>{
    if(!tracked)return;
    const current=read();
    if(current?.request.request_id!==requestId){if(submitted)throw new Error("Payment details changed while approving. No transaction was submitted.");return;}
    localStorage.setItem(key,JSON.stringify({...current,attempted:true,submissionAttempted:submitted}));
  };
}
export class TransactionNotSubmittedError extends Error {
  constructor(message:string){super(message);this.name="TransactionNotSubmittedError";}
}
