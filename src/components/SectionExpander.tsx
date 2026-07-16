import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
} from "@headlessui/react";
import { ChevronRightIcon } from "@heroicons/react/24/solid";
import clsx from "clsx";
import { ReactNode } from "react";

interface SectionExpanderProps {
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
  headerRight?: ReactNode;
}

export function SectionExpander({
  title,
  defaultOpen = true,
  children,
  headerRight,
}: SectionExpanderProps) {
  return (
    <Disclosure defaultOpen={defaultOpen}>
      {({ open }) => (
        <div>
          <div className="flex items-center gap-2 py-2 select-none">
            <DisclosureButton className="flex items-center gap-2 text-sm font-semibold text-gv-text hover:text-gv-text transition-colors cursor-pointer">
              <ChevronRightIcon
                className={clsx(
                  "h-4 w-4 transition-transform duration-200",
                  open && "rotate-90",
                )}
              />
              <span>{title}</span>
            </DisclosureButton>
            {headerRight && (
              <div className="ml-auto flex items-center">{headerRight}</div>
            )}
          </div>
          <DisclosurePanel>{children}</DisclosurePanel>
        </div>
      )}
    </Disclosure>
  );
}
