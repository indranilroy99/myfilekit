import { animate, type AnimationPlaybackControls, useMotionValue, useReducedMotion } from "framer-motion";
import { type CSSProperties, type ReactNode, useEffect, useId, useRef } from "react";

interface ResponsiveImage {
  src: string;
  alt?: string;
  srcSet?: string;
}

interface AnimationConfig {
  preview?: boolean;
  scale: number;
  speed: number;
}

interface NoiseConfig {
  opacity: number;
  scale: number;
}

interface ShadowOverlayProps {
  type?: "preset" | "custom";
  presetIndex?: number;
  customImage?: ResponsiveImage;
  sizing?: "fill" | "stretch";
  color?: string;
  animation?: AnimationConfig;
  noise?: NoiseConfig;
  style?: CSSProperties;
  className?: string;
  children?: ReactNode;
}

function mapRange(value: number, fromLow: number, fromHigh: number, toLow: number, toHigh: number): number {
  if (fromLow === fromHigh) return toLow;
  const percentage = (value - fromLow) / (fromHigh - fromLow);
  return toLow + percentage * (toHigh - toLow);
}

const useInstanceId = (): string => {
  const id = useId();
  return `shadowoverlay-${id.replace(/:/g, "")}`;
};

export function Component({
  sizing = "fill",
  color = "rgba(185, 185, 176, .28)",
  animation,
  noise,
  style,
  className,
  children,
}: ShadowOverlayProps) {
  const id = useInstanceId();
  const shouldReduceMotion = useReducedMotion();
  const animationEnabled = Boolean(animation && animation.scale > 0 && !shouldReduceMotion);
  const feColorMatrixRef = useRef<SVGFEColorMatrixElement>(null);
  const hueRotateMotionValue = useMotionValue(180);
  const hueRotateAnimation = useRef<AnimationPlaybackControls | null>(null);

  const displacementScale = animation ? mapRange(animation.scale, 1, 100, 10, 56) : 0;
  const animationDuration = animation ? mapRange(animation.speed, 1, 100, 1000, 80) : 1;

  useEffect(() => {
    if (!feColorMatrixRef.current || !animationEnabled) return undefined;
    hueRotateAnimation.current?.stop();
    hueRotateMotionValue.set(0);
    hueRotateAnimation.current = animate(hueRotateMotionValue, 360, {
      duration: animationDuration / 25,
      repeat: Infinity,
      repeatType: "loop",
      repeatDelay: 0,
      ease: "linear",
      delay: 0,
      onUpdate: (value: number) => {
        feColorMatrixRef.current?.setAttribute("values", String(value));
      },
    });

    return () => {
      hueRotateAnimation.current?.stop();
    };
  }, [animationEnabled, animationDuration, hueRotateMotionValue]);

  return (
    <div
      className={className}
      aria-hidden={!children}
      style={{
        overflow: "hidden",
        position: "relative",
        width: "100%",
        height: "100%",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: -displacementScale,
          filter: animationEnabled ? `url(#${id}) blur(4px)` : "blur(10px)",
        }}
      >
        {animationEnabled && (
          <svg style={{ position: "absolute" }}>
            <defs>
              <filter id={id}>
                <feTurbulence
                  result="undulation"
                  numOctaves="2"
                  baseFrequency={`${mapRange(animation?.scale || 0, 0, 100, 0.001, 0.0005)},${mapRange(animation?.scale || 0, 0, 100, 0.004, 0.002)}`}
                  seed="7"
                  type="turbulence"
                />
                <feColorMatrix ref={feColorMatrixRef} in="undulation" type="hueRotate" values="180" />
                <feColorMatrix
                  in="undulation"
                  result="circulation"
                  type="matrix"
                  values="4 0 0 0 1  4 0 0 0 1  4 0 0 0 1  1 0 0 0 0"
                />
                <feDisplacementMap in="SourceGraphic" in2="circulation" scale={displacementScale} result="dist" />
                <feDisplacementMap in="dist" in2="undulation" scale={displacementScale} result="output" />
              </filter>
            </defs>
          </svg>
        )}
        <div
          style={{
            background:
              sizing === "stretch"
                ? `linear-gradient(118deg, transparent 0 18%, ${color} 18% 72%, transparent 72%)`
                : `radial-gradient(circle at 22% 18%, ${color}, transparent 34%), radial-gradient(circle at 82% 20%, rgba(195, 195, 186, .16), transparent 30%), radial-gradient(circle at 62% 82%, rgba(70, 70, 68, .22), transparent 38%)`,
            maskImage:
              "radial-gradient(circle at 30% 25%, #000 0 18%, transparent 48%), radial-gradient(circle at 64% 46%, #000 0 32%, transparent 68%), radial-gradient(circle at 42% 76%, #000 0 24%, transparent 58%)",
            maskSize: sizing === "stretch" ? "100% 100%" : "cover",
            maskRepeat: "no-repeat",
            maskPosition: "center",
            width: "100%",
            height: "100%",
          }}
        />
      </div>

      {children && <div style={{ position: "relative", zIndex: 10 }}>{children}</div>}

      {noise && noise.opacity > 0 && (
        <div
          className="wabi-noise"
          style={{
            position: "absolute",
            inset: 0,
            backgroundSize: `${noise.scale * 180}px ${noise.scale * 180}px`,
            opacity: noise.opacity / 2,
          }}
        />
      )}
    </div>
  );
}

export const EtherealShadow = Component;
