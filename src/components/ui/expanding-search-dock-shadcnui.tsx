import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Search, X } from "lucide-react";
import { type FormEvent, useState } from "react";

type ExpandingSearchDockProps = {
  onSearch?: (query: string) => void;
  placeholder?: string;
};

export function ExpandingSearchDock({
  onSearch,
  placeholder = "Search...",
}: ExpandingSearchDockProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const shouldReduceMotion = useReducedMotion();

  const handleExpand = () => {
    setIsExpanded(true);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    setQuery("");
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (onSearch && query) {
      onSearch(query);
    }
  };

  return (
    <div className="relative">
      <AnimatePresence mode="wait">
        {!isExpanded ? (
          <motion.button
            key="icon"
            initial={shouldReduceMotion ? false : { scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { scale: 0, opacity: 0 }}
            onClick={handleExpand}
            aria-label="Open tool search"
            className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card transition-colors hover:bg-muted"
          >
            <Search className="h-5 w-5" />
          </motion.button>
        ) : (
          <motion.form
            key="input"
            initial={shouldReduceMotion ? false : { width: 48, opacity: 0 }}
            animate={{ width: 320, opacity: 1 }}
            exit={shouldReduceMotion ? undefined : { width: 48, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 300,
              damping: 30,
            }}
            onSubmit={handleSubmit}
            className="relative"
            role="search"
          >
            <motion.div
              initial={shouldReduceMotion ? false : { backdropFilter: "blur(0px)" }}
              animate={{ backdropFilter: "blur(12px)" }}
              className="relative flex items-center gap-2 overflow-hidden rounded-full border border-border bg-card/80 backdrop-blur-md"
            >
              <div className="ml-4">
                <Search className="h-4 w-4 text-muted-foreground" />
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={placeholder}
                autoFocus
                className="h-12 flex-1 bg-transparent pr-4 text-sm outline-none placeholder:text-muted-foreground"
              />
              <motion.button
                type="button"
                onClick={handleCollapse}
                initial={shouldReduceMotion ? false : { scale: 0 }}
                animate={{ scale: 1 }}
                whileHover={shouldReduceMotion ? undefined : { scale: 1.1 }}
                whileTap={shouldReduceMotion ? undefined : { scale: 0.9 }}
                aria-label="Close tool search"
                className="mr-2 flex h-8 w-8 items-center justify-center rounded-full hover:bg-muted"
              >
                <X className="h-4 w-4" />
              </motion.button>
            </motion.div>
          </motion.form>
        )}
      </AnimatePresence>
    </div>
  );
}
