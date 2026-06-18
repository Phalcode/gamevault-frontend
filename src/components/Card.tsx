import { Subheading } from "@tw/heading";
import { ReactNode } from "react";

type CardProps = {
  title: string;
  className?: string;
  surfaceClassName?: string;
  children: ReactNode;
};

export default function Card({
  title,
  children,
  className,
  surfaceClassName = "bg-zinc-100 dark:bg-zinc-800",
}: CardProps) {
  return (
    <div
      className={
        "overflow-hidden rounded-lg shadow-sm mb-4 " +
        surfaceClassName
      }
    >
      <div className="px-4 pt-5 sm:px-6">
        <Subheading>{title}</Subheading>
      </div>
      <div className={"px-4 pb-5 sm:p-6 flex flex-col " + className}>
        {children}
      </div>
    </div>
  );
}
