// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach,beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({toast:vi.fn(),prepare:vi.fn()}));
vi.mock("@/hooks/use-account-queries",()=>({useAccountScope:()=>({key:["test","alice"]})}));
vi.mock("sonner",()=>({toast:{error:mocks.toast}}));
import { PurchasingResearchPanel } from "@/components/purchasing-research-panel";
let root:Root,host:HTMLDivElement,client:QueryClient;
const task={id:"11111111-1111-4111-8111-111111111111",companyId:"22222222-2222-4222-8222-222222222222",delegationId:"33333333-3333-4333-8333-333333333333",employeeId:"alice",prompt:"Compare project management tools",digest:"a".repeat(64),state:"proposal",createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+900000).toISOString(),message:null,result:null};
async function flush(){await act(async()=>{await new Promise(resolve=>setTimeout(resolve,15));});}
async function render(){await act(async()=>root.render(<QueryClientProvider client={client}><PurchasingResearchPanel companyId={task.companyId} delegationId={task.delegationId} adapterId="adapter" onConfigure={vi.fn()}/></QueryClientProvider>));await flush();await act(async()=>{[...host.querySelectorAll("button")].find(button=>button.textContent==="Example 1")!.click();});}
async function prepare(){await act(async()=>{[...host.querySelectorAll("button")].find(button=>button.textContent==="Use Allocard demo agent")!.click();});await flush();}
beforeEach(()=>{
 vi.clearAllMocks();Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});host=document.createElement("div");document.body.append(host);root=createRoot(host);client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
 vi.stubGlobal("fetch",vi.fn(async(_url:string,options?:RequestInit)=>options?.method==="POST"?mocks.prepare():Response.json([])));
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();host.remove();vi.unstubAllGlobals();});
it("opens the actual confirmation dialog when a proposal is prepared",async()=>{
 mocks.prepare.mockResolvedValue(Response.json(task));await render();await prepare();
 const dialog=document.querySelector('[role="dialog"]');expect(dialog?.textContent).toContain("Confirm research task");expect(dialog?.textContent).toContain(task.prompt);expect(mocks.toast).not.toHaveBeenCalled();
});
it("shows preparation errors beside the action and in a toast instead of silently resetting",async()=>{
 mocks.prepare.mockResolvedValue(Response.json({error:"The research service is not deployed at its configured address."},{status:503}));await render();await prepare();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("not deployed");expect(mocks.toast).toHaveBeenCalledWith("Could not prepare research proposal",{description:expect.stringContaining("not deployed")});expect(document.querySelector('[role="dialog"]')).toBeNull();
});
it("shows an actionable timeout error when the request cannot complete",async()=>{
 mocks.prepare.mockRejectedValue(new DOMException("Timed out","TimeoutError"));await render();await prepare();
 expect(host.querySelector('[role="alert"]')?.textContent).toContain("timed out");expect(mocks.toast).toHaveBeenCalled();
});
