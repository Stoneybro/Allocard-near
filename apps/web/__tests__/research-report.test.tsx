// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ResearchReport } from "@/components/research-report";
it("renders report headings, source links and comparison tables without executing supplied HTML", () => {
  const html = renderToStaticMarkup(<ResearchReport>{`## Recommendations

[Source](https://example.com/pricing)

| Product | Monthly cost |
| --- | --- |
| Tool A | $20 |

<script>alert('unsafe')</script>

[Bad link](javascript:alert(1))`}</ResearchReport>);
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelector("h2")?.textContent).toBe("Recommendations");
  expect(doc.querySelector("table")?.textContent).toContain("Tool A");
  expect(doc.querySelector('a[href="https://example.com/pricing"]')?.getAttribute("rel")).toBe("noopener noreferrer");
  expect(doc.querySelector("script")).toBeNull();
  expect(doc.querySelector('a[href^="javascript:"]')).toBeNull();
});
