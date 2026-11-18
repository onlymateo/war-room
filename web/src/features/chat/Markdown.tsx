import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Model output rendered as Markdown. Raw HTML is not rendered (react-markdown default), links open in a new tab. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="prose-chat text-[13.5px] leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
