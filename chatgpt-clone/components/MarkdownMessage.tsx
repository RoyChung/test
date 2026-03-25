"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

type Props = {
  content: string;
  className?: string;
};

/** Allow safe HTML blocks inside Markdown (e.g. `<details>`, `<kbd>`) after sanitization. */
const sanitizeSchema = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    "details",
    "summary",
    "kbd",
    "mark",
    "sub",
    "sup",
    "figure",
    "figcaption",
  ],
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
    span: [...(defaultSchema.attributes?.span ?? []), "className", "style"],
    div: [...(defaultSchema.attributes?.div ?? []), "className"],
    a: [...(defaultSchema.attributes?.a ?? []), "target", "rel", "title"],
    img: [...(defaultSchema.attributes?.img ?? []), "src", "alt", "title", "loading"],
  },
};

const mdComponents: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-2 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 list-decimal pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="mb-0.5">{children}</li>,
  a: ({ href, children }) => (
    <a
      href={href}
      className="text-sky-400 underline decoration-sky-400/50 underline-offset-2 hover:text-sky-300"
      target="_blank"
      rel="noopener noreferrer"
    >
      {children}
    </a>
  ),
  strong: ({ children }) => <strong className="font-semibold text-[#f0f3f8]">{children}</strong>,
  em: ({ children }) => <em className="italic text-[#e8eaed]">{children}</em>,
  del: ({ children }) => <del className="text-white/60 line-through">{children}</del>,
  hr: () => <hr className="my-4 border-[#2d3a4d]" />,
  table: ({ children }) => (
    <div className="my-3 max-w-full overflow-x-auto">
      <table className="w-full min-w-[16rem] border-collapse border border-[#2d3a4d] text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-[#1a2332]">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-b border-[#2d3a4d]">{children}</tr>,
  th: ({ children }) => (
    <th className="border border-[#2d3a4d] px-3 py-2 text-left font-semibold text-[#e8eaed]">{children}</th>
  ),
  td: ({ children }) => (
    <td className="border border-[#2d3a4d] px-3 py-2 align-top text-[#e8eaed]">{children}</td>
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = typeof className === "string" && className.includes("language-");
    if (isBlock) {
      return (
        <code
          className={`block overflow-x-auto rounded-lg bg-[#0d1117] p-3 font-mono text-[0.85rem] text-[#e6edf3] ${className ?? ""}`}
          {...props}
        >
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[0.88em] text-[#e8eaed]" {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg bg-[#0d1117] p-0">{children}</pre>,
  h1: ({ children }) => <h1 className="mb-2 text-lg font-semibold text-[#f0f3f8]">{children}</h1>,
  h2: ({ children }) => <h2 className="mb-2 text-base font-semibold text-[#f0f3f8]">{children}</h2>,
  h3: ({ children }) => <h3 className="mb-1 text-sm font-semibold text-[#f0f3f8]">{children}</h3>,
  h4: ({ children }) => <h4 className="mb-1 text-sm font-medium text-[#e8eaed]">{children}</h4>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-[#3d9eff]/50 pl-3 text-[#c8d0dc]">{children}</blockquote>
  ),
};

export function MarkdownMessage({ content, className = "" }: Props) {
  return (
    <div className={`markdown-msg text-[0.95rem] leading-relaxed text-[#e8eaed] ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, sanitizeSchema]]}
        components={mdComponents}
        skipHtml={false}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
