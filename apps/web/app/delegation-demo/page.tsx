"use client";

import React, { useState } from "react";
import {
  SDK_VERSION,
  parseTokenAmount,
  formatTokenAmount,
  generateRequestId,
  computeExecuteHash,
  type Permission,
  type ExecuteRequest,
  type PreviewResult,
  type Execution,
} from "@allocard/delegation-sdk";

type UserRole = "owner" | "manager" | "agent" | "approver";

interface MockPermissionRecord extends Permission {
  settled: string;
}

export default function Home() {
  const [simulationError, setSimulationError] = useState<string | null>(null);
  const [activeRole, setActiveRole] = useState<UserRole>("owner");
  const [contractId, setContractId] = useState("treasury.allocard.testnet");
  const [networkDomain] = useState("near:testnet");
  const [treasuryBalance, setTreasuryBalance] = useState("10.00");
  const [pendingOutgoing, setPendingOutgoing] = useState("0.00");
  const [authorityEpoch, setAuthorityEpoch] = useState("1");
  const [isPaused, setIsPaused] = useState(false);

  // Active permissions
  const [permissions, setPermissions] = useState<MockPermissionRecord[]>([
    {
      id: "1",
      parent_id: undefined,
      issuer: "owner.testnet",
      delegate: "manager.testnet",
      epoch: "1",
      depth: 0,
      valid_from_ms: "0",
      expires_at_ms: "2000000000000",
      max_executions: 50,
      redelegation_depth: 2,
      revoked: false,
      rules: [
        {
          asset: { type: "NativeNear" },
          recipients: { type: "Any" },
          min_per_action: "10000000000000000000000",
          max_per_action: "5000000000000000000000000",
          lifetime_limit: "10000000000000000000000000", // 10 NEAR
          acknowledge_unbounded_budget: false,
        },
      ],
      settled: "2.50",
    },
    {
      id: "2",
      parent_id: "1",
      issuer: "manager.testnet",
      delegate: "ai-agent.testnet",
      epoch: "1",
      depth: 1,
      valid_from_ms: "0",
      expires_at_ms: "2000000000000",
      max_executions: 10,
      redelegation_depth: 0,
      revoked: false,
      rules: [
        {
          asset: { type: "NativeNear" },
          recipients: { type: "Only", accounts: ["hotel-vendor.testnet", "airline.testnet"] },
          min_per_action: "50000000000000000000000",
          max_per_action: "2000000000000000000000000",
          lifetime_limit: "3000000000000000000000000", // 3 NEAR
          acknowledge_unbounded_budget: false,
        },
      ],
      settled: "1.20",
    },
  ]);

  // Form states
  const [newDelegate, setNewDelegate] = useState("ai-agent.testnet");
  const [newMaxPerAction, setNewMaxPerAction] = useState("1.5");
  const [newLifetime, setNewLifetime] = useState("3.0");
  const [newMaxExecutions, setNewMaxExecutions] = useState("10");

  // Execution states
  const [execPermissionId, setExecPermissionId] = useState("2");
  const [execRecipient, setExecRecipient] = useState("hotel-vendor.testnet");
  const [execAmount, setExecAmount] = useState("0.8");
  const [previewOutcome, setPreviewOutcome] = useState<PreviewResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [history, setHistory] = useState<Execution[]>([
    {
      id: "1",
      actor: "ai-agent.testnet",
      request_id: "a000000000000000000000000000000000000000000000000000000000000001",
      request_hash: "1349d7047d8f44b5f5ea2ec182812d3aa0f40363d5add7e9dae19ac7e0b1ecd6",
      authority_mode: "Delegated",
      permission_id: "2",
      epoch: "1",
      action: {
        type: "Transfer",
        asset: { type: "NativeNear" },
        receiver: "hotel-vendor.testnet",
        amount: "800000000000000000000000",
      },
      created_at_ms: "1700000000000",
      status: "Succeeded",
      needs_reconciliation: false,
      reservations: [],
    },
  ]);

  // Handlers
  const handlePreview = () => {
    setSimulationError(null);
    try {
    const selectedPerm = permissions.find((p) => p.id === execPermissionId);
    if (!selectedPerm) {
      setPreviewOutcome({
        allowed: false,
        error_code: "ALLOCARD_PERMISSION_NOT_FOUND",
        error_message: "Permission ID does not exist",
        requested_amount: parseTokenAmount(execAmount),
      });
      return;
    }

    if (selectedPerm.revoked) {
      setPreviewOutcome({
        allowed: false,
        error_code: "ALLOCARD_PERMISSION_REVOKED",
        error_message: "This permission has been revoked by an ancestor authority",
        requested_amount: parseTokenAmount(execAmount),
      });
      return;
    }

    const rule = selectedPerm.rules[0];
    if (rule.recipients.type === "Only" && !rule.recipients.accounts.includes(execRecipient)) {
      setPreviewOutcome({
        allowed: false,
        error_code: "ALLOCARD_RECIPIENT_NOT_ALLOWED",
        error_message: `Recipient ${execRecipient} is not allowed by this permission's strict recipient list`,
        offending_permission_id: selectedPerm.id,
        requested_amount: parseTokenAmount(execAmount),
      });
      return;
    }

    const reqAmtUnits = BigInt(parseTokenAmount(execAmount));
    const maxPerActionUnits = BigInt(rule.max_per_action || "0");
    if (rule.max_per_action && reqAmtUnits > maxPerActionUnits) {
      setPreviewOutcome({
        allowed: false,
        error_code: "ALLOCARD_PER_ACTION_LIMIT",
        error_message: `Requested ${execAmount} NEAR exceeds per-action ceiling of ${formatTokenAmount(maxPerActionUnits.toString())} NEAR`,
        offending_permission_id: selectedPerm.id,
        requested_amount: reqAmtUnits.toString(),
      });
      return;
    }

    setPreviewOutcome({
      allowed: true,
      error_code: undefined,
      error_message: undefined,
      requested_amount: reqAmtUnits.toString(),
      available_budget: rule.lifetime_limit,
    });

    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Invalid simulation input");
      setIsExecuting(false);
    }
  };

  const handleExecute = async () => {
    setSimulationError(null);
    try {
    const units = BigInt(parseTokenAmount(execAmount));
    if (isPaused || units <= BigInt(0) || units > BigInt(parseTokenAmount(treasuryBalance))) {
      throw new Error("Simulation paused, amount invalid, or sample funds insufficient");
    }

    setIsExecuting(true);
    const reqId = generateRequestId();
    const req: ExecuteRequest = {
      api_version: 1,
      request_id: reqId,
      permission_id: execPermissionId,
      action: {
        type: "Transfer",
        asset: { type: "NativeNear" },
        receiver: execRecipient,
        amount: parseTokenAmount(execAmount),
      },
      deadline_ms: (Date.now() + 300000).toString(),
    };

    const hash = computeExecuteHash(networkDomain, contractId, activeRole === "agent" ? "ai-agent.testnet" : "manager.testnet", req);

    // Simulate 2-phase dispatch: 1st phase locks pending reservations
    setPendingOutgoing(execAmount);
    await new Promise((r) => setTimeout(r, 800));

    // 2nd phase settlement: callback completes
    const newExec: Execution = {
      id: (history.length + 1).toString(),
      actor: activeRole === "agent" ? "ai-agent.testnet" : "manager.testnet",
      request_id: reqId,
      request_hash: hash,
      authority_mode: "Delegated",
      permission_id: execPermissionId,
      epoch: authorityEpoch,
      action: req.action,
      created_at_ms: "1700000000000",
      status: "Succeeded",
      needs_reconciliation: false,
      reservations: [],
    };

    setHistory([newExec, ...history]);
    setPendingOutgoing("0.00");
    setTreasuryBalance(formatTokenAmount((BigInt(parseTokenAmount(treasuryBalance)) - BigInt(parseTokenAmount(execAmount))).toString()));

    // Update permission settled usage
    setPermissions((prev) =>
      prev.map((p) =>
        p.id === execPermissionId
          ? { ...p, settled: formatTokenAmount((BigInt(parseTokenAmount(p.settled)) + BigInt(parseTokenAmount(execAmount))).toString()) }
          : p
      )
    );

    setIsExecuting(false);

    } catch (error) {
      setSimulationError(error instanceof Error ? error.message : "Invalid simulation input");
      setIsExecuting(false);
    }
  };

  const handleRevoke = (id: string) => {
    setPermissions((prev) =>
      prev.map((p) => (p.id === id ? { ...p, revoked: true } : p))
    );
  };

  const handleEpochAdvance = () => {
    const next = (BigInt(authorityEpoch) + BigInt(1)).toString();
    setAuthorityEpoch(next);
    // Advancing epoch invalidates old permissions immediately in O(1)
    setPermissions([]);
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white">
      <div role="status" className="bg-amber-950 px-6 py-3 text-sm text-amber-200">
        Local simulation — no wallet connected. Balances, approvals and payment outcomes are sample data; no funds move.
      </div>
      {simulationError && <p role="alert" className="px-6 py-3 text-rose-300">{simulationError}</p>}
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-900/50 backdrop-blur sticky top-0 z-50 px-6 py-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-violet-500 flex items-center justify-center font-bold text-xl shadow-lg shadow-indigo-500/20">
            A
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="font-bold text-lg tracking-tight">Allocard</h1>
              <span className="px-2 py-0.5 rounded text-xs font-mono font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                v{SDK_VERSION} Native NEAR
              </span>
            </div>
            <p className="text-xs text-zinc-400">Programmable Corporate Treasury & Delegation Engine</p>
          </div>
        </div>

        {/* Role Switcher */}
        <div className="flex items-center gap-2 bg-zinc-900 border border-zinc-800 p-1 rounded-xl">
          {(["owner", "manager", "agent", "approver"] as UserRole[]).map((role) => (
            <button
              key={role}
              onClick={() => setActiveRole(role)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                activeRole === role
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              }`}
            >
              {role}
            </button>
          ))}
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">
        {/* Treasury Health & Liquidity Cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Spendable Available</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">{treasuryBalance}</span>
              <span className="text-sm font-semibold text-indigo-400">NEAR</span>
            </div>
            <span className="text-xs text-zinc-500 mt-1 block">Physically solvency verified</span>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Pending Reservations</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-amber-400">{pendingOutgoing}</span>
              <span className="text-sm font-semibold text-zinc-400">NEAR</span>
            </div>
            <span className="text-xs text-zinc-500 mt-1 block">Locked during 2-phase dispatch</span>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800">
            <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Authority Epoch</span>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-3xl font-extrabold text-white">#{authorityEpoch}</span>
            </div>
            <span className="text-xs text-zinc-500 mt-1 block">O(1) Global invalidation epoch</span>
          </div>

          <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 flex flex-col justify-between">
            <div>
              <span className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Treasury State</span>
              <div className="mt-2 flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${isPaused ? "bg-rose-500" : "bg-emerald-400 animate-pulse"}`} />
                <span className="text-xl font-bold">{isPaused ? "PAUSED" : "ACTIVE"}</span>
              </div>
            </div>
            {activeRole === "owner" && (
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => setIsPaused(!isPaused)}
                  className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium"
                >
                  {isPaused ? "Unpause" : "Pause"}
                </button>
                <button
                  onClick={handleEpochAdvance}
                  className="px-2.5 py-1 text-xs rounded bg-rose-950/40 text-rose-300 border border-rose-800/50 hover:bg-rose-900/50 font-medium"
                >
                  Advance Epoch
                </button>
              </div>
            )}
          </div>
        </section>

        {/* Content Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Left: Permission Hierarchy & Tree */}
          <section className="lg:col-span-7 space-y-6">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold tracking-tight">Active Delegation Chain</h2>
                <p className="text-sm text-zinc-400">Strict hierarchical authority with non-monotonic narrowing</p>
              </div>
            </div>

            {/* Permissions List */}
            <div className="space-y-4">
              {permissions.length === 0 ? (
                <div className="p-8 text-center rounded-2xl border border-dashed border-zinc-800 text-zinc-500">
                  All past permissions invalidated by epoch advancement. Create a new root permission to restart.
                </div>
              ) : (
                permissions.map((perm) => (
                  <div
                    key={perm.id}
                    className={`p-5 rounded-2xl border transition-all ${
                      perm.revoked
                        ? "bg-rose-950/10 border-rose-900/30 opacity-75"
                        : "bg-zinc-900/40 border-zinc-800 hover:border-zinc-700"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="px-2 py-0.5 rounded text-xs font-mono font-semibold bg-zinc-800 text-zinc-300">
                            #{perm.id} {perm.depth === 0 ? "ROOT" : `DEPTH ${perm.depth}`}
                          </span>
                          {perm.revoked && (
                            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-500/20 text-rose-400 border border-rose-500/30">
                              REVOKED
                            </span>
                          )}
                          <span className="text-xs font-mono text-zinc-400">
                            Issuer: <span className="text-zinc-200">{perm.issuer}</span> → Delegate:{" "}
                            <span className="text-indigo-400 font-semibold">{perm.delegate}</span>
                          </span>
                        </div>

                        {/* Rules Overview */}
                        <div className="pt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <span className="text-zinc-500 block">Cap / Action</span>
                            <span className="font-medium text-zinc-300">
                              {formatTokenAmount(perm.rules[0]?.max_per_action || "0")} NEAR
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Lifetime Budget</span>
                            <span className="font-medium text-zinc-300">
                              {formatTokenAmount(perm.rules[0]?.lifetime_limit || "0")} NEAR
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Spent / Settled</span>
                            <span className="font-medium text-emerald-400">{perm.settled} NEAR</span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Recipients</span>
                            <span className="font-mono text-zinc-300">
                              {perm.rules[0]?.recipients.type === "Any"
                                ? "Any (*)"
                                : `Strict (${(perm.rules[0]?.recipients as any).accounts.length})`}
                            </span>
                          </div>
                          <div>
                            <span className="text-zinc-500 block">Max Executions</span>
                            <span className="font-mono text-zinc-300">{perm.max_executions || "Unlimited"}</span>
                          </div>
                        </div>
                      </div>

                      {/* Action buttons */}
                      {!perm.revoked && (activeRole === "owner" || activeRole === "manager") && (
                        <button
                          onClick={() => handleRevoke(perm.id)}
                          className="px-2.5 py-1 text-xs rounded bg-zinc-800 hover:bg-rose-950/60 hover:text-rose-400 text-zinc-400 border border-zinc-700 transition"
                        >
                          Revoke
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Quick Creation Form (for owner or manager) */}
            {(activeRole === "owner" || activeRole === "manager") && (
              <div className="p-5 rounded-2xl bg-zinc-900/80 border border-zinc-800 space-y-4">
                <h3 className="text-sm font-semibold text-zinc-200">
                  {activeRole === "owner" ? "Issue Root Permission" : "Delegate Sub-Permission"}
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <label className="text-zinc-400 mb-1 block">Delegate Account</label>
                    <input
                      type="text"
                      value={newDelegate}
                      onChange={(e) => setNewDelegate(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-400 mb-1 block">Max Per Action (NEAR)</label>
                    <input
                      type="text"
                      value={newMaxPerAction}
                      onChange={(e) => setNewMaxPerAction(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-400 mb-1 block">Lifetime Limit (NEAR)</label>
                    <input
                      type="text"
                      value={newLifetime}
                      onChange={(e) => setNewLifetime(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                  <div>
                    <label className="text-zinc-400 mb-1 block">Maximum Executions</label>
                    <input
                      type="number"
                      value={newMaxExecutions}
                      onChange={(e) => setNewMaxExecutions(e.target.value)}
                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                    />
                  </div>
                </div>
                <button
                  onClick={() => {
                    try {
                    const newId = (permissions.length + 1).toString();
                    setPermissions([
                      ...permissions,
                      {
                        id: newId,
                        parent_id: activeRole === "owner" ? undefined : "1",
                        issuer: activeRole === "owner" ? "owner.testnet" : "manager.testnet",
                        delegate: newDelegate,
                        epoch: authorityEpoch,
                        depth: activeRole === "owner" ? 0 : 1,
                        valid_from_ms: "0",
                        expires_at_ms: "2000000000000",
                        max_executions: parseInt(newMaxExecutions) || undefined,
                        redelegation_depth: activeRole === "owner" ? 2 : 0,
                        revoked: false,
                        rules: [
                          {
                            asset: { type: "NativeNear" },
                            recipients: { type: "Any" },
                            max_per_action: parseTokenAmount(newMaxPerAction),
                            lifetime_limit: parseTokenAmount(newLifetime),
                            acknowledge_unbounded_budget: false,
                          },
                        ],
                        settled: "0.00",
                      },
                    ]);
                    setSimulationError(null);
                    } catch (error) {
                      setSimulationError(error instanceof Error ? error.message : "Invalid amount");
                    }
                  }}
                  className="w-full py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 font-medium text-xs text-white transition shadow-lg shadow-indigo-600/20"
                >
                  Add Sample Permission
                </button>
              </div>
            )}
          </section>

          {/* Right: Delegated Execution & Simulation Console */}
          <section className="lg:col-span-5 space-y-6">
            <div>
              <h2 className="text-xl font-bold tracking-tight">Execution Console</h2>
              <p className="text-sm text-zinc-400">Pure preflight evaluation & atomic 2-phase dispatch</p>
            </div>

            <div className="p-5 rounded-2xl bg-zinc-900/60 border border-zinc-800 space-y-4">
              <div className="space-y-3 text-xs">
                <div>
                  <label className="text-zinc-400 mb-1 block">Permission ID</label>
                  <select
                    value={execPermissionId}
                    onChange={(e) => setExecPermissionId(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  >
                    {permissions.map((p) => (
                      <option key={p.id} value={p.id}>
                        #{p.id} ({p.delegate}) - Cap: {formatTokenAmount(p.rules[0]?.max_per_action || "0")} NEAR
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-zinc-400 mb-1 block">Recipient Account</label>
                  <input
                    type="text"
                    value={execRecipient}
                    onChange={(e) => setExecRecipient(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div>
                  <label className="text-zinc-400 mb-1 block">Transfer Amount (NEAR)</label>
                  <input
                    type="text"
                    value={execAmount}
                    onChange={(e) => setExecAmount(e.target.value)}
                    className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-zinc-100 font-mono text-xs focus:outline-none focus:border-indigo-500"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handlePreview}
                  className="flex-1 py-2 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium text-xs transition"
                >
                  Illustrative Policy Check
                </button>
                <button
                  onClick={handleExecute}
                  disabled={isExecuting}
                  className="flex-1 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-medium text-xs transition disabled:opacity-50"
                >
                  {isExecuting ? "Simulating..." : "Simulate Payment"}
                </button>
              </div>

              {/* Preflight Result Box */}
              {previewOutcome && (
                <div
                  className={`p-3 rounded-xl border text-xs space-y-1 ${
                    previewOutcome.allowed
                      ? "bg-emerald-950/20 border-emerald-800/40 text-emerald-300"
                      : "bg-rose-950/20 border-rose-800/40 text-rose-300"
                  }`}
                >
                  <div className="flex items-center gap-2 font-semibold">
                    <span>{previewOutcome.allowed ? "✓ SAMPLE CHECK PASSED" : "✗ SAMPLE CHECK FAILED"}</span>
                    {previewOutcome.error_code && (
                      <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-rose-900/40">
                        {previewOutcome.error_code}
                      </span>
                    )}
                  </div>
                  {previewOutcome.error_message && (
                    <p className="text-zinc-400 text-[11px]">{previewOutcome.error_message}</p>
                  )}
                </div>
              )}
            </div>

            {/* Execution Audit Trail */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-zinc-300">Simulated Payments</h3>
              <div className="space-y-2">
                {history.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-zinc-900/40 border border-zinc-800 text-xs flex items-center justify-between"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-zinc-300">EXEC #{item.id}</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] bg-emerald-500/10 text-emerald-400 font-medium">
                          {item.status}
                        </span>
                      </div>
                      <span className="font-mono text-[11px] text-zinc-400 mt-1 block">
                        {item.action.receiver}: {formatTokenAmount(item.action.amount)} NEAR
                      </span>
                    </div>
                    <span className="text-[10px] font-mono text-zinc-500 truncate max-w-[120px]">
                      {item.request_hash.slice(0, 10)}...
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
