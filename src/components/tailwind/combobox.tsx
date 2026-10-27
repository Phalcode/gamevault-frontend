"use client";

import * as Headless from "@headlessui/react";
import clsx from "clsx";
import { useState } from "react";

/**
 * Text input with a dropdown of suggestions, backed by Headless UI's Combobox.
 *
 * Unlike the other pickers this one stays free-form: `onQueryChange` receives
 * every keystroke so a value outside the suggestion list can be entered, while
 * picking a suggestion calls `onChange`. Filtering is done here (Headless does
 * not filter on its own), and an empty query always shows every suggestion.
 */
export function Combobox<T>({
  className,
  placeholder,
  autoFocus,
  options,
  displayValue,
  filter,
  onQueryChange,
  "aria-label": ariaLabel,
  children,
  ...props
}: {
  className?: string;
  placeholder?: string;
  autoFocus?: boolean;
  options: T[];
  displayValue: (value: T | null) => string;
  filter?: (option: T, query: string) => boolean;
  onQueryChange?: (query: string) => void;
  "aria-label"?: string;
  children: (options: T[]) => React.ReactNode;
} & Omit<
  Headless.ComboboxProps<T, false>,
  "as" | "multiple" | "children" | "displayValue"
>) {
  const [query, setQuery] = useState("");

  const filteredOptions =
    query === ""
      ? options
      : options.filter((option) =>
          filter
            ? filter(option, query)
            : displayValue(option).toLowerCase().includes(query.toLowerCase()),
        );

  return (
    <Headless.Combobox {...props} multiple={false} onClose={() => setQuery("")}>
      <span
        data-slot="control"
        className={clsx([
          className,
          // Basic layout
          "group relative block w-full",
          // Focus ring — same metrics and radius as Input/Listbox
          "after:pointer-events-none after:absolute after:inset-0 after:rounded-2xl after:ring-transparent after:ring-inset sm:focus-within:after:ring-2 sm:focus-within:after:ring-gv-accent-cool",
          // Disabled state
          "has-data-disabled:opacity-50",
        ])}
      >
        <Headless.ComboboxInput
          autoFocus={autoFocus}
          data-slot="control"
          aria-label={ariaLabel}
          displayValue={(option: T | null) => displayValue(option)}
          onChange={(event) => {
            setQuery(event.target.value);
            onQueryChange?.(event.target.value);
          }}
          placeholder={placeholder}
          className={clsx([
            className,
            // Basic layout — identical metrics to Input and Listbox so rows line up
            "relative block w-full appearance-none rounded-2xl py-[calc(--spacing(2.5)-1px)] sm:py-1.5",
            "min-h-11 sm:min-h-9",
            // Horizontal padding (leaves room for the chevron)
            "pr-[calc(--spacing(7)-1px)] pl-[calc(--spacing(3.5)-1px)] sm:pl-[calc(--spacing(3)-1px)]",
            // Typography
            "text-base/6 text-gv-text placeholder:text-gv-muted sm:text-sm/6",
            // Border + background
            "border border-gv-line bg-gv-panel-strong shadow-sm",
            // Hide default focus styles (the wrapper draws the ring)
            "focus:outline-hidden",
            // Invalid state
            "data-invalid:border-red-500 data-invalid:data-hover:border-red-500 dark:data-invalid:border-red-600 dark:data-invalid:data-hover:border-red-600",
            // Disabled state
            "data-disabled:border-transparent data-disabled:bg-gv-panel-soft data-disabled:shadow-none",
          ])}
        />
        <Headless.ComboboxButton
          aria-label="Show suggestions"
          className="group absolute inset-y-0 right-0 flex items-center pr-2"
        >
          <svg
            className="size-5 stroke-gv-muted group-data-disabled:stroke-gv-muted sm:size-4 forced-colors:stroke-[CanvasText]"
            viewBox="0 0 16 16"
            aria-hidden="true"
            fill="none"
          >
            <path
              d="M5.75 10.75L8 13L10.25 10.75"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d="M10.25 5.25L8 3L5.75 5.25"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </Headless.ComboboxButton>
      </span>
      <Headless.ComboboxOptions
        transition
        anchor="bottom start"
        className={clsx(
          // Anchor positioning
          "[--anchor-gap:--spacing(1.5)] [--anchor-padding:--spacing(4)]",
          // Base styles — matches ListboxOptions
          "isolate w-max min-w-(--input-width) max-w-[calc(100vw-2rem)] scroll-py-1 rounded-[1.25rem] p-1.5 select-none",
          // Invisible border that is only visible in `forced-colors` mode for accessibility purposes
          "outline outline-transparent focus:outline-hidden",
          // Handle scrolling when menu won't fit in viewport
          "overflow-y-scroll overscroll-contain",
          // Popover background
          "surface-panel",
          // Shadows
          "shadow-(--shadow-shell) ring-1 ring-gv-line",
          // Transitions
          "transition-opacity duration-100 ease-in data-closed:data-leave:opacity-0 data-transition:pointer-events-none",
        )}
      >
        {children(filteredOptions)}
      </Headless.ComboboxOptions>
    </Headless.Combobox>
  );
}

export function ComboboxOption<T>({
  children,
  className,
  ...props
}: { className?: string; children?: React.ReactNode } & Omit<
  Headless.ComboboxOptionProps<"div", T>,
  "as" | "className"
>) {
  let sharedClasses = clsx(
    // Base
    "flex min-w-0 items-center",
    // Icons
    "*:data-[slot=icon]:size-5 *:data-[slot=icon]:shrink-0 sm:*:data-[slot=icon]:size-4",
    "*:data-[slot=icon]:text-gv-muted group-data-focus/option:*:data-[slot=icon]:text-white",
    "forced-colors:*:data-[slot=icon]:text-[CanvasText] forced-colors:group-data-focus/option:*:data-[slot=icon]:text-[Canvas]",
    // Avatars
    "*:data-[slot=avatar]:-mx-0.5 *:data-[slot=avatar]:size-6 sm:*:data-[slot=avatar]:size-5",
  );

  return (
    <Headless.ComboboxOption
      {...props}
      className={clsx(
        // Basic layout
        "group/option grid w-full cursor-pointer grid-cols-[--spacing(5)_1fr] items-baseline gap-x-2 rounded-xl py-2.5 pr-3.5 pl-2.5 sm:grid-cols-[--spacing(4)_1fr] sm:py-1.5 sm:pr-3 sm:pl-2",
        // Typography
        "text-base/6 text-gv-text sm:text-sm/6 forced-colors:text-[CanvasText]",
        // Focus
        "outline-hidden data-focus:bg-gv-accent data-focus:text-white transition-colors duration-150",
        // Forced colors mode
        "forced-color-adjust-none forced-colors:data-focus:bg-[Highlight] forced-colors:data-focus:text-[HighlightText]",
        // Disabled
        "data-disabled:opacity-50",
      )}
    >
      <svg
        className="relative hidden size-5 self-center stroke-current group-data-selected/option:inline sm:size-4"
        viewBox="0 0 16 16"
        fill="none"
        aria-hidden="true"
      >
        <path
          d="M4 8.5l3 3L12 4"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={clsx(className, sharedClasses, "col-start-2")}>
        {children}
      </span>
    </Headless.ComboboxOption>
  );
}

export function ComboboxLabel({
  className,
  ...props
}: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        "ml-2.5 truncate first:ml-0 sm:ml-2 sm:first:ml-0",
      )}
    />
  );
}

export function ComboboxDescription({
  className,
  children,
  ...props
}: React.ComponentPropsWithoutRef<"span">) {
  return (
    <span
      {...props}
      className={clsx(
        className,
        "flex flex-1 overflow-hidden text-gv-muted group-data-focus/option:text-white before:w-2 before:min-w-0 before:shrink",
      )}
    >
      <span className="flex-1 truncate">{children}</span>
    </span>
  );
}
