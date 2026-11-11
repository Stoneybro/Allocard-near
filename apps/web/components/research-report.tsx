"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Table, TableHead, TableCell } from "@/components/ui/table";

export function ResearchReport({ children }: { children: string }) {
  return <div className="space-y-4 break-words text-sm leading-7 [overflow-wrap:anywhere] [&_h1]:mt-6 [&_h1]:text-xl [&_h1]:font-semibold [&_h1]:tracking-tight [&_h2]:mt-6 [&_h2]:text-lg [&_h2]:font-medium [&_h2]:tracking-tight [&_h3]:mt-5 [&_h3]:font-medium [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5 [&_li>p]:inline [&_blockquote]:border-l-2 [&_blockquote]:pl-4 [&_blockquote]:text-muted-foreground [&_pre]:overflow-x-auto [&_pre]:rounded-lg [&_pre]:bg-muted/40 [&_pre]:p-4 [&_code]:text-xs [&_hr]:border-border/60 [&_strong]:font-semibold">
    <Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
      a: ({ href, children: label }) => <a href={href} target="_blank" rel="noopener noreferrer" className="underline decoration-muted-foreground/50 underline-offset-4 hover:decoration-foreground">{label}</a>,
      img: () => null,
      table: ({ children: content }) => <div className="overflow-hidden rounded-lg border border-border/70"><Table className="text-xs leading-5">{content}</Table></div>,
      th: ({ children: content }) => <TableHead className="min-w-32 whitespace-normal bg-muted/30 p-3 text-xs">{content}</TableHead>,
      td: ({ children: content }) => <TableCell className="min-w-32 whitespace-normal p-3 align-top">{content}</TableCell>,
    }}>{children}</Markdown>
  </div>;
}
