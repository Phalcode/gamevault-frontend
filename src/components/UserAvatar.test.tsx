// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserAvatar } from "./UserAvatar";
import { createDicebearAvatar } from "@/utils/dicebearAvatar";

vi.mock("@/components/Media", () => ({
  Media: ({ alt }: { alt?: string }) => (
    <div data-testid="media" data-alt={alt} />
  ),
}));

vi.mock("@/utils/streamerMode", () => ({
  useStreamerMode: vi.fn(() => false),
}));

vi.mock("@/utils/dicebearAvatar", () => ({
  createDicebearAvatar: vi.fn((seed: string) =>
    `data:image/svg+xml;base64,${seed}`,
  ),
}));

import { useStreamerMode } from "@/utils/streamerMode";

const mockUseStreamerMode = vi.mocked(useStreamerMode);
const mockCreateDicebearAvatar = vi.mocked(createDicebearAvatar);

describe("UserAvatar", () => {
  beforeEach(() => {
    mockUseStreamerMode.mockReset();
    mockCreateDicebearAvatar.mockClear();
    mockUseStreamerMode.mockReturnValue(false);
  });

  it("renders the real media when not in streamer mode and an avatar exists", () => {
    const { container } = render(
      <UserAvatar media={{ id: 7 }} size={40} alt="Real Name" />,
    );
    expect(screen.getByTestId("media")).toBeInTheDocument();
    expect(container.querySelector("img")).toBeNull();
    expect(mockCreateDicebearAvatar).not.toHaveBeenCalled();
  });

  it("shows a dicebear avatar when streamer mode is on, hiding the real photo", () => {
    mockUseStreamerMode.mockReturnValue(true);
    const { container } = render(
      <UserAvatar media={{ id: 7 }} size={40} alt="Real Name" seed="99" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/svg+xml;base64,99",
    );
    expect(mockCreateDicebearAvatar).toHaveBeenCalledWith("99");
    expect(screen.queryByTestId("media")).not.toBeInTheDocument();
  });

  it("shows a dicebear avatar by default when the user has no avatar", () => {
    const { container } = render(
      <UserAvatar media={null} size={40} alt="" seed="7" />,
    );
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "data:image/svg+xml;base64,7",
    );
    expect(screen.queryByTestId("media")).not.toBeInTheDocument();
  });

  it("falls back to alt (then 'anonymous') when no seed is provided", () => {
    render(<UserAvatar media={null} size={40} alt="Fallback Name" />);
    expect(mockCreateDicebearAvatar).toHaveBeenCalledWith("Fallback Name");

    mockCreateDicebearAvatar.mockClear();
    render(<UserAvatar media={null} size={40} />);
    expect(mockCreateDicebearAvatar).toHaveBeenCalledWith("anonymous");
  });
});
