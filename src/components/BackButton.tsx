import { ChevronLeftIcon } from "@heroicons/react/24/outline";
import { useNavigate } from "react-router";

interface BackButtonProps {
  /** Override the default `navigate(-1)` behavior (e.g. a drill-down back). */
  onClick?: () => void;
}

/**
 * Shared "Back" navigation button.
 *
 * Wraps the consistent in-app back control: an arrow + "Back" label. By
 * default it uses `useNavigate` to go back one history step, so it must be
 * rendered inside a React Router context. When a custom `onClick` is provided
 * (e.g. returning to a drill-down overview), that takes precedence. Place it
 * at the top-left of a page/section header to keep back navigation consistent
 * across the app.
 */
export default function BackButton({ onClick }: BackButtonProps) {
  const navigate = useNavigate();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else {
      navigate(-1);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Go back"
      className="group flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm/5 text-gv-muted transition-colors hover:text-gv-text"
    >
      <ChevronLeftIcon className="size-4 shrink-0 transition-transform group-hover:-translate-x-0.5" />
      Back
    </button>
  );
}
