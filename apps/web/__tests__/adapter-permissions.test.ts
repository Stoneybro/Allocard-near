import { beforeEach,describe,expect,it,vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({select:vi.fn(),guard:vi.fn(),path:vi.fn(),config:vi.fn(),view:vi.fn()}));
vi.mock("@/lib/db",()=>({db:{select:mocks.select}}));
vi.mock("@/lib/auth-guard",()=>({requireEmployeeAgentDelegation:mocks.guard}));
vi.mock("@/lib/near-server",()=>({verifyTreasuryOwner:mocks.config,treasuryReader:()=>({getPermissionPath:mocks.path,caller:{viewFunction:mocks.view},contractId:"treasury.testnet"})}));
import {authorizeAdapter} from "@/lib/agent-adapter/permissions";
import {ADAPTER_NAME} from "@/lib/agent-adapter/shared";
const account="a".repeat(64);
const permission=(id:string,delegate:string,issuer:string,parent_id:string|null)=>({id,delegate,issuer,parent_id,revoked:false,epoch:"1",valid_from_ms:"0",expires_at_ms:null,max_executions:null});
beforeEach(()=>{
 vi.clearAllMocks();vi.stubEnv("NEAR_ADAPTER_ACCOUNT_ID",account);
 const rows=[[{id:"adapter",name:ADAPTER_NAME,isActive:true,smartAccountAddress:account,signerAddress:account}],[{id:"company",ownerId:"owner",smartAccountAddress:"treasury.testnet"}],[{nearAccountId:"owner.testnet",embeddedWalletAddress:"owner.testnet"}]];
 mocks.select.mockImplementation(()=>({from:()=>({where:()=>({limit:async()=>rows.shift()})})}));
 mocks.guard.mockResolvedValue({delegation:{delegateeId:"adapter",delegationHash:"2",treasuryReference:"treasury.testnet"},parentDelegation:{delegatorId:"company",delegationHash:"1"}});
 mocks.config.mockResolvedValue({paused:false,authority_epoch:"1"});mocks.path.mockResolvedValue([permission("2",account,"alice.testnet","1"),permission("1","alice.testnet","owner.testnet",null)]);mocks.view.mockResolvedValue(false);
});
describe("shared adapter signer isolation",()=>{
 it("rejects a blocked company owner",async()=>{mocks.view.mockImplementation(async({args}:{args:{account:string}})=>args.account==="owner.testnet");await expect(authorizeAdapter("alice","alice.testnet","company","child")).rejects.toThrow("blocked principal");});
 it("allows only the chain path belonging to the requesting employee",async()=>{await expect(authorizeAdapter("alice","alice.testnet","company","child")).resolves.toMatchObject({account});});
 it("rejects Bob's chain permission selected by Alice",async()=>{mocks.path.mockResolvedValue([permission("2",account,"bob.testnet","1"),permission("1","bob.testnet","owner.testnet",null)]);await expect(authorizeAdapter("alice","alice.testnet","company","child")).rejects.toThrow("ancestry");});
 it("rejects a permission from another company before chain reads",async()=>{await expect(authorizeAdapter("alice","alice.testnet","other-company","child")).rejects.toThrow("another company");expect(mocks.path).not.toHaveBeenCalled();});
 it("rejects a revoked ancestor",async()=>{mocks.path.mockResolvedValue([permission("2",account,"alice.testnet","1"),{...permission("1","alice.testnet","owner.testnet",null),revoked:true}]);await expect(authorizeAdapter("alice","alice.testnet","company","child")).rejects.toThrow("revoked");});
 it("rejects a wallet that is not the configured adapter",async()=>{mocks.path.mockResolvedValue([permission("2","evil.testnet","alice.testnet","1"),permission("1","alice.testnet","owner.testnet",null)]);await expect(authorizeAdapter("alice","alice.testnet","company","child")).rejects.toThrow("ancestry");});
});
