import { Button } from "@tw/button";
import { useSound } from "@/hooks/useSound";

export default function NotFound() {
  const { isPlaying, toggle } = useSound("wellerman");

  return (
    <div className="flex flex-col items-center justify-center h-dvh w-dvw">
      <img
        src="/ships.png"
        alt="Ships Background"
        className={`absolute inset-0 w-full h-full object-cover ${
          isPlaying
            ? "opacity-100 transition-opacity duration-10000"
            : "opacity-0"
        }`}
      />
      <div className="relative z-10 flex flex-col items-center text-center px-4">
        <img
          src="/crackpipe.png"
          alt="Dead End Roadsign"
          width={160}
          height={160}
          className={`mb-4 h-40 cursor-pointer motion-reduce:animate-none ${
            isPlaying ? "animate-[spin_7s_linear_infinite]" : ""
          }`}
          onClick={toggle}
        />
        <h1 className="text-xl">404 - Page Not Found</h1>
        <h2 className="text-2xl sm:text-4xl mb-4 font-bold text-balance">
          „Arr... ye've taken a wrong turn at the seven seas!“
        </h2>
        <Button href="/">Sail Back Home</Button>
      </div>
    </div>
  );
}
