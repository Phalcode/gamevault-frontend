import { Subheading } from "@tw/heading";
import { ReactNode } from "react";

type CardProps = {
  title: string;
  children: ReactNode;
};

export default function Card({ title, children }: CardProps) {
  return (
    <div className="overflow-hidden rounded-lg dark:bg-zinc-800 bg-zinc-100 shadow-sm mb-4">
      <div className="px-4 pt-5 sm:px-6">
        <Subheading>{title}</Subheading>
      </div>
      <div className="px-4 pb-5 sm:p-6 flex flex-col">{children}</div>
    </div>
  );
}
