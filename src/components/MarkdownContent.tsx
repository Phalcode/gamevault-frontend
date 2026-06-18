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
        "prose prose-sm prose-zinc max-w-none text-zinc-700 dark:prose-invert dark:text-zinc-300",
        "prose-headings:font-semibold prose-headings:text-zinc-950 dark:prose-headings:text-zinc-50",
        "prose-p:leading-7 prose-p:text-zinc-700 dark:prose-p:text-zinc-300",
        "prose-a:text-indigo-600 prose-a:no-underline hover:prose-a:text-indigo-500 dark:prose-a:text-indigo-300 dark:hover:prose-a:text-indigo-200",
        "prose-strong:text-zinc-900 dark:prose-strong:text-zinc-100",
        "prose-code:rounded prose-code:bg-zinc-100 prose-code:px-1.5 prose-code:py-0.5 prose-code:text-[0.9em] prose-code:text-zinc-900 dark:prose-code:bg-zinc-800 dark:prose-code:text-zinc-100",
        "prose-pre:rounded-xl prose-pre:border prose-pre:border-zinc-200 prose-pre:bg-zinc-950 prose-pre:shadow-sm dark:prose-pre:border-zinc-800",
        "prose-blockquote:border-l-zinc-300 prose-blockquote:text-zinc-600 dark:prose-blockquote:border-l-zinc-700 dark:prose-blockquote:text-zinc-300",
        "prose-li:text-zinc-700 prose-li:marker:text-zinc-400 dark:prose-li:text-zinc-300 dark:prose-li:marker:text-zinc-500",
        className,
      )}
    >
      <Markdown>{normalizedContent}</Markdown>
    </div>
  );
}