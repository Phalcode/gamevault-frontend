import type React from "react";

export function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden px-3 py-4 sm:px-5 sm:py-6 lg:p-6">
      <div className="relative flex min-h-full grow items-center justify-center">
        <div className="relative w-full max-w-xl">
          <div className="surface-panel relative flex justify-center rounded-[1.75rem] p-6 sm:p-8 lg:p-10">
            {children}
          </div>
        </div>
      </div>
    </main>
  );
}
