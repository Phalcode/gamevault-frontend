import clsx from "clsx";
import Markdown from "react-markdown";

type MarkdownContentProps = {
  content: string;
  className?: string;
};

export default function MarkdownContent({
  content,
  className,
}: MarkdownContentProps) {
  const normalizedContent = content
    .replace(/\r\n/g, "\n")
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n");

  return (
    <div
      className={clsx(
        "prose prose-sm max-w-none text-gv-text",
        "prose-headings:font-semibold prose-headings:text-gv-text",
        "prose-p:leading-7 prose-p:text-gv-text",
        "prose-a:text-gv-accent prose-a:no-underline hover:prose-a:text-gv-accent-strong",
        "prose-strong:text-gv-text",
        "prose-code:rounded prose-code:bg-gv-panel-soft prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:text-gv-text",
        "prose-pre:rounded-xl prose-pre:border prose-pre:border-gv-line prose-pre:bg-gv-panel-strong prose-pre:shadow-sm",
        "prose-blockquote:border-l-gv-line prose-blockquote:text-gv-muted",
        "prose-li:text-gv-text prose-li:marker:text-gv-muted",
        className,
      )}
    >
      <Markdown>{normalizedContent}</Markdown>
    </div>
  );
}