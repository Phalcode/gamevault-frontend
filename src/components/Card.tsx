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
  surfaceClassName = "surface-panel",
}: CardProps) {
  return (
    <div
      className={
        "overflow-hidden rounded-[1.5rem] mb-6 border border-gv-line " +
        surfaceClassName
      }
    >
      <div className="border-b border-gv-line px-5 py-4 sm:px-6">
        <Subheading>{title}</Subheading>
      </div>
      <div className={"px-5 py-5 sm:p-6 flex flex-col " + className}>
        {children}
      </div>
    </div>
  );
}
