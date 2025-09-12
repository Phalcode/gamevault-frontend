import logoPng from "../assets/icons/gamevaultlogo.png";

export function TopIcon() {
  return (
    <img
      src={logoPng}
      alt="GameVault Logo"
      style={imgStyle}
      draggable={false}
      loading="eager"
      onError={(e) => {
        e.currentTarget.style.opacity = "0.3";
        e.currentTarget.title = "Logo failed to load";
      }}
    />
  );
}

const imgStyle: React.CSSProperties = {
  position: "fixed",
  top: -30,
  right: 16,
  width: 340,
  height: 140,
  objectFit: "contain",
  userSelect: "none",
  pointerEvents: "none",
  display: "block",
  imageRendering: "auto",
  zIndex: 2500,
};
