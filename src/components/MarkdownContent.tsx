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
  return (
    <div
      className={clsx(
        "prose prose-sm prose-zinc max-w-none dark:prose-invert",
        className,
      )}
    >
      <Markdown>{content}</Markdown>
    </div>
  );
}