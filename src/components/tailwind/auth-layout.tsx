import type React from "react";
import WindowTitlebar from "../WindowTitlebar";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <WindowTitlebar />
      <main className="relative flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-5 sm:py-6 lg:p-6">
        <div className="relative flex min-h-full grow items-center justify-center">
          <div className="relative w-full max-w-xl">
            <div className="surface-panel relative flex justify-center rounded-[1.75rem] p-6 sm:p-8 lg:p-10 animate-[panel-in_0.18s_ease-out] motion-reduce:animate-none">
              {children}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
