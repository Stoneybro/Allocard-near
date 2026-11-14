# Research worker timeout investigation

The live worker is `packages/research-worker`, deployed at `https://allocard-research-worker.vercel.app`. The older Eve/marketplace worker under the ignored `.agent-work` directory is a separate integration and was not the code serving these requests.

Production storage contained two failed research tasks, both with an aborted-timeout message and no saved result. The actual worker claimed each approved job successfully, then its NEAR AI Responses request exceeded the 150-second timeout. Tests using mocked provider responses had not established a completed production run.

The revised request explicitly disables extra reasoning, reduces the output budget from 3,500 to 1,800 tokens, asks for a concise report, and tells the model to mark unverified requirements rather than repeatedly searching for a perfect match. A real provider check completed in 42.6 seconds. Production subsequently completed the research stage in 26.3 seconds with zero reasoning tokens. Those timings are samples; the old timeout did not return token usage, so the contribution of reasoning versus search latency cannot be measured retrospectively.

Only a completed response's final assistant report is accepted. It must include live search activity and source URLs. Completion callbacks atomically persist the immutable call result and visible task outcome, acknowledge identical retries, and reject conflicting results. Worker transport errors and research timeouts now have actionable messages. Permission checks still validate both live grants; independent usage and deduplicated principal-block checks run concurrently. The public app request budget accommodates this authorization and readiness work while research continues asynchronously.

## Production verification

An isolated diagnostic identity, company, delegation placeholder and synthetic approved task exercised the live worker and authenticated production callbacks. This tested execution and persistence independently of a signed-in employee/browser flow. It did not submit a treasury transaction or rerun either failed user task.

- Task `7eb0746a-1389-4723-afa5-5559c1bf623f` reached `delivered` in approximately 28 seconds.
- The task and immutable call record held the same 2,421-character sourced report.
- There was exactly one durable claim. Duplicate submission returned the identical saved report.
- Temporary diagnostic records were deleted after terminal verification. The report and verification logs remain under ignored `.agent-work/agent-run/`.
- Seven worker tests and 30 distinct focused app tests passed. Both type checks and targeted app lint passed.

The production request performed five searches despite requesting at most three. This provider setting is not a hard billing boundary; logs expose actual counts. Admission reservations remain estimates alongside daily/concurrency quotas and the request timeout.

The app deployment is `dpl_ARsUVGtXP1MJTRgwf7yaUpxp5qN2`; the worker deployment is `dpl_BVS9fVYfCe9AGkW8ejBdchMeiTFz`. Both are production-ready and aliased. Existing failed tasks remain historical failures. Reload the dashboard and create a new confirmed task to use the updated worker.
