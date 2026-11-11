export const demoGuideStorageKey = (scope: string) => `allocard:demo-guide:v2:${scope}`;
export const employeeDemoScope = (accountId: string, companyId: string) => `employee:${accountId}:${companyId}`;

/** Arm the employee walkthrough only after a newly accepted invitation. */
export function prepareEmployeeDemo(accountId: string, companyId: string) {
  const key = demoGuideStorageKey(employeeDemoScope(accountId, companyId));
  try {
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, JSON.stringify({ enabled: true, seenStep: 0, openedHelp: false }));
    }
  } catch { /* A storage restriction must not prevent joining a company. */ }
}
