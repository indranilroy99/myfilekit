import * as React from "react";
import { motion } from "framer-motion";

type AnimatedDownloadButtonProps = {
  label?: string;
  href?: string;
  download?: string | boolean;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit" | "reset";
};

export default function AnimatedDownloadButton({
  label = "Download",
  href,
  download,
  onClick,
  className = "",
  type = "button",
}: AnimatedDownloadButtonProps) {
  const [isHovered, setIsHovered] = React.useState(false);
  const content = (
    <motion.span
      initial={{ width: 48, height: 48 }}
      whileHover={{ width: 184 }}
      onHoverStart={() => setIsHovered(true)}
      onHoverEnd={() => setIsHovered(false)}
      transition={{ duration: 0.28, ease: [0.23, 1, 0.32, 1] }}
      className="relative inline-flex items-center justify-center overflow-hidden bg-[var(--primary)] text-white shadow-[0_18px_44px_rgba(16,24,40,0.18)]"
      style={{ borderRadius: 999 }}
    >
      <motion.span
        aria-hidden="true"
        className="absolute text-2xl leading-none"
        animate={{ opacity: isHovered ? 0 : 1, scale: isHovered ? 0.82 : 1 }}
        transition={{ duration: 0.2 }}
      >
        ↓
      </motion.span>
      <motion.span
        className="flex w-full items-center justify-center px-5 text-sm font-black"
        initial={{ opacity: 0 }}
        animate={{ opacity: isHovered ? 1 : 0 }}
        transition={{ duration: 0.2, delay: isHovered ? 0.08 : 0 }}
      >
        <span className="whitespace-nowrap">{label}</span>
      </motion.span>
    </motion.span>
  );

  if (href) {
    return (
      <a className={`animated-download-button inline-flex items-center justify-center no-underline ${className}`} href={href} download={download} aria-label={label}>
        {content}
      </a>
    );
  }

  return (
    <button className={`animated-download-button inline-flex items-center justify-center ${className}`} type={type} onClick={onClick} aria-label={label}>
      {content}
    </button>
  );
}
