"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountScope } from "@/hooks/use-account-queries";
import { ADAPTER_NAME, terminal, type ResearchTask, type Candidate } from "@/lib/agent-adapter/shared";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
async function api<T>(url: string, body?: unknown): Promise<T> {
  let response: Response;
  try { response=await fetch(url,{method:body?"POST":"GET",credentials:"same-origin",cache:"no-store",headers:body?{"content-type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)}); }
  catch(error) { const name=error && typeof error==="object" && "name" in error ? error.name : null;throw new Error(name==="TimeoutError"||name==="AbortError"?"The research request timed out. Please retry; any saved proposal will appear in your requests.":"Could not reach the research service. Check your connection and try again."); }
  const data=await response.json().catch(()=>null);if(!response.ok)throw new Error(data?.error||"Research service unavailable");if(data===null)throw new Error("The research service returned an empty response. Please retry.");return data;
}
const examples=["Find three project-management tools for 12 people under $100/month, with time tracking and guest access. Prefer monthly billing.","Compare three support tools for three agents under $75/month, including a shared inbox and public knowledge base.","Compare scheduling tools for five employees under $50/month, with Google Calendar integration and team scheduling."];
export function PurchasingResearchPanel({companyId,delegationId,adapterId,onConfigure}:{companyId:string;delegationId?:string;adapterId?:string;onConfigure:()=>void}){
 const [prompt,setPrompt]=useState("");const [query,setQuery]=useState("");const [proposal,setProposal]=useState<ResearchTask|null>(null);
 const client=useQueryClient();const {key}=useAccountScope();const taskKey=[...key,"research",companyId,delegationId];
 const tasks=useQuery({queryKey:taskKey,queryFn:()=>api<ResearchTask[]>(`/api/agent-adapter?companyId=${companyId}${delegationId?`&delegationId=${encodeURIComponent(delegationId)}`:""}`),refetchInterval:10000});
 const discovery=useQuery({queryKey:[...key,"market-discovery",companyId,query],enabled:query.length>1,queryFn:()=>api<{agents:Candidate[]}>(`/api/agent-adapter?companyId=${companyId}&q=${encodeURIComponent(query)}`),staleTime:60000});
 const prepare=useMutation({retry:false,mutationFn:()=>api<ResearchTask>("/api/agent-adapter",{action:"prepare",task:{companyId,delegationId,prompt,requestId:crypto.randomUUID()}}),onSuccess:task=>{setProposal(task);void client.invalidateQueries({queryKey:taskKey});},onError:error=>{toast.error("Could not prepare research proposal",{description:error.message});console.error("[research proposal]",error.message);}});
 const confirm=useMutation({retry:false,mutationFn:(task:ResearchTask)=>api<ResearchTask>("/api/agent-adapter",{action:"confirm",task:{id:task.id,digest:task.digest}}),onSuccess:()=>{setProposal(null);void client.invalidateQueries({queryKey:taskKey});},onError:error=>toast.error("Could not confirm research task",{description:error.message})});
 return <Card><CardHeader><div className="flex flex-wrap items-center justify-between gap-2"><CardTitle>Research</CardTitle></div><CardDescription>Compare business software and subscriptions. This agent researches options; it cannot make purchases.</CardDescription></CardHeader><CardContent className="space-y-5">
 {!delegationId&&<Alert><AlertDescription>{adapterId?"Create and activate a child permission for the purchasing adapter before running research.":"The adapter signing identity is not configured yet."} <Button variant="outline" size="sm" disabled={!adapterId} onClick={onConfigure}>Configure adapter</Button></AlertDescription></Alert>}
 <div className="space-y-2"><Label htmlFor="research-prompt">What does your team need?</Label><Textarea id="research-prompt" rows={4} maxLength={3000} value={prompt} onChange={e=>setPrompt(e.target.value)} placeholder={examples[0]} /><p className="text-xs text-muted-foreground">The product purchasing budget limits recommendations. No product or agent payment is authorized by this demo.</p></div>
 <div className="flex flex-wrap gap-2">{examples.map((example,index)=><Button key={example} variant="ghost" size="sm" onClick={()=>setPrompt(example)}>Example {index+1}</Button>)}</div>
 <div className="flex flex-wrap gap-2"><Button variant="outline" disabled={prompt.trim().length<20||discovery.isFetching} onClick={()=>setQuery(prompt.trim().slice(0,180))}>Find related marketplace agents</Button><Button disabled={!delegationId||prompt.trim().length<20||prepare.isPending} onClick={()=>prepare.mutate()}>{prepare.isPending?"Preparing proposal…":"Use Allocard demo agent"}</Button></div>
 {(prepare.error||confirm.error)&&<Alert role="alert"><AlertDescription>{prepare.error?.message||confirm.error?.message}</AlertDescription></Alert>}
 {discovery.isFetching&&<Skeleton className="h-16 w-full"/>}
 {discovery.error&&<p role="alert" className="text-sm text-muted-foreground">{discovery.error.message}</p>}
 {discovery.data&&<div className="space-y-2"><p className="text-sm font-medium">Related marketplace agents · Discovery only</p>{discovery.data.agents.length===0&&<p className="text-sm text-muted-foreground">No matching catalog results. The configured demo agent remains available for supported research.</p>}{discovery.data.agents.map(agent=><div key={agent.id} className="rounded-md border p-3 text-sm"><div className="flex flex-wrap items-center justify-between gap-2"><a href={agent.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">{agent.name}</a><Badge variant="outline">Paid execution disabled</Badge></div><p className="mt-1 text-muted-foreground">{agent.description}</p><p className="text-xs text-muted-foreground">{agent.price?`Listed price: ${agent.price}. Verify currency on the listing.`:"See listing for current price."}</p></div>)}</div>}
 <Dialog open={!!proposal} onOpenChange={open=>{if(!open&&!confirm.isPending)setProposal(null);}}><DialogContent><DialogHeader><DialogTitle>Confirm research task</DialogTitle><DialogDescription>{ADAPTER_NAME} will execute directly on Vercel. No marketplace hire, escrow or charge is created. Hosting and model usage still apply.</DialogDescription></DialogHeader>{confirm.error&&<Alert role="alert"><AlertDescription>{confirm.error.message}</AlertDescription></Alert>}<p className="whitespace-pre-wrap break-words text-sm">{proposal?.prompt}</p><p className="text-xs text-muted-foreground">Proposal expires {proposal?new Date(proposal.expiresAt).toLocaleTimeString():""}. Expected execution deadline: 3 minutes after starting.</p><DialogFooter><Button variant="outline" disabled={confirm.isPending} onClick={()=>setProposal(null)}>Cancel</Button><Button disabled={confirm.isPending} onClick={()=>proposal&&confirm.mutate(proposal)}>{confirm.isPending?"Submitting…":"Confirm task"}</Button></DialogFooter></DialogContent></Dialog>
 <div className="space-y-3"><p className="text-sm font-medium">Your research requests</p>{tasks.isPending&&<Skeleton className="h-14 w-full"/>}{tasks.error&&<p role="alert" className="text-sm text-muted-foreground">{tasks.error.message}</p>}{tasks.data?.map(task=><ResearchJob key={task.id} task={task} onReview={()=>setProposal(task)} onUpdate={()=>{void client.invalidateQueries({queryKey:taskKey});}}/>)}{tasks.data?.length===0&&<p className="text-sm text-muted-foreground">No research requests yet.</p>}</div>
 </CardContent></Card>;
}
function ResearchJob({task,onUpdate,onReview}:{task:ResearchTask;onUpdate:()=>void;onReview:()=>void}){
 const {key}=useAccountScope();const [show,setShow]=useState(false);
 const status=useQuery({queryKey:[...key,"research-status",task.id],enabled:!["proposal",...(["delivered","failed","cancelled","expired"])].includes(task.state),queryFn:()=>api<ResearchTask>("/api/agent-adapter",{action:"progress",task:{id:task.id,digest:task.digest}}),refetchInterval:q=>q.state.data&&terminal(q.state.data.state)?false:5000,refetchOnWindowFocus:true});
 const current=status.data??task;
 const cancel=useMutation({retry:false,mutationFn:()=>api<ResearchTask>("/api/agent-adapter",{action:"cancel",task:{id:task.id,digest:task.digest}}),onSuccess:onUpdate});
 return <div className="rounded-md border p-3 space-y-2"><div className="flex flex-wrap justify-between gap-2"><p className="text-sm font-medium break-words">{current.prompt}</p><Badge variant="outline">{current.state.replaceAll("_"," ")}</Badge></div><p className="text-xs text-muted-foreground">{current.message??"Awaiting confirmation"}</p>{(status.error||cancel.error)&&<p role="alert" className="text-xs text-muted-foreground">{status.error?.message||cancel.error?.message}</p>}{current.state==="proposal"&&<Button variant="outline" size="sm" onClick={onReview}>Review proposal</Button>}{["proposal","queued"].includes(current.state)&&<Button variant="ghost" size="sm" disabled={cancel.isPending} onClick={()=>cancel.mutate()}>Cancel request</Button>}{current.result&&<><Button variant="outline" size="sm" onClick={()=>setShow(!show)}>{show?"Hide report":"Read report"}</Button>{show&&<div className="whitespace-pre-wrap break-words rounded-md bg-muted/40 p-4 text-sm">{current.result}</div>}</>}<p className="text-xs text-muted-foreground">Direct demo execution · Marketplace charge: 0</p></div>;
}

export function DelegationResearchActivity({companyId,delegationId}:{companyId:string;delegationId:string}) {
 const {key}=useAccountScope();
 const tasks=useQuery({queryKey:[...key,"delegation-research",companyId,delegationId],queryFn:()=>api<ResearchTask[]>(`/api/agent-adapter?companyId=${encodeURIComponent(companyId)}&view=company&delegationId=${encodeURIComponent(delegationId)}`),refetchInterval:10000});
 return <div className="space-y-3">
 {tasks.isPending&&<Skeleton className="h-20 w-full"/>}
 {tasks.error&&<Alert role="alert"><AlertDescription>{tasks.error.message} <Button variant="outline" size="sm" onClick={()=>void tasks.refetch()}>Retry</Button></AlertDescription></Alert>}
 {tasks.data?.length===0&&<div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">No research runs for this delegation yet.</div>}
 {tasks.data?.map(task=><article key={task.id} className="space-y-3 rounded-lg border border-border/70 p-4">
   <div className="flex flex-wrap items-center justify-between gap-2"><Badge variant="outline">{task.state.replaceAll("_"," ")}</Badge><time dateTime={task.createdAt} className="text-xs text-muted-foreground">{new Date(task.createdAt).toLocaleString()}</time></div>
   <p className="whitespace-pre-wrap break-words text-sm font-medium">{task.prompt}</p>
   {task.message&&<p className="text-xs text-muted-foreground">{task.message}</p>}
   {task.result&&<details className="rounded-md bg-muted/40 p-3"><summary className="cursor-pointer text-xs font-medium">Read report</summary><div className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed">{task.result}</div></details>}
 </article>)}
 </div>;
}
