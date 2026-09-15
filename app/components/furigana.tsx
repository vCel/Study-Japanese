import * as React from "react";
import { Languages } from "lucide-react";

import { parseFurigana, stripFurigana } from "~/lib/furigana";
import { cn } from "~/lib/utils";

/**
 * Whether the kana readings are shown, for the whole quiz.
 *
 * Context rather than props: the readings appear in the prompt, the sentence,
 * every option, the answer, the explanation and the results review — six
 * components deep in places. Threading a boolean through all of them would put
 * `showFurigana` in the signature of every component that happens to render
 * Japanese, which is most of them, for one leaf-level decision.
 *
 * Defaults to `true`, including outside a provider: the reader who cannot read
 * kanji is the one this whole feature is for, so the failure mode of a missing
 * provider should be "shows the readings" rather than "hides them".
 */
interface FuriganaControls {
  show: boolean;
  setShow: (value: boolean) => void;
}

const FuriganaContext = React.createContext<FuriganaControls>({
  show: true,
  setShow: () => {},
});

/** Survives a reload — a preference that resets every quiz is not a preference. */
const STORAGE_KEY = "jv:show-furigana";

export function FuriganaProvider({ children }: { children: React.ReactNode }) {
  const [show, setShow] = React.useState(true);

  // Read *after* the first render, not during it: the server has no
  // localStorage, so reading it up front would make the client's first render
  // disagree with the HTML it is hydrating.
  React.useEffect(() => {
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored !== null) setShow(stored !== "0");
    } catch {
      // Private mode, or storage disabled. The default stands.
    }
  }, []);

  const setShowAndRemember = React.useCallback((value: boolean) => {
    setShow(value);
    try {
      window.localStorage.setItem(STORAGE_KEY, value ? "1" : "0");
    } catch {
      // Ditto — the toggle still works for this session.
    }
  }, []);

  const value = React.useMemo(
    () => ({ show, setShow: setShowAndRemember }),
    [show, setShowAndRemember]
  );

  return <FuriganaContext.Provider value={value}>{children}</FuriganaContext.Provider>;
}

export function useFurigana(): FuriganaControls {
  return React.useContext(FuriganaContext);
}

/**
 * Render annotated Japanese, with the readings above the kanji.
 *
 * With the readings off this is the plain text, so call sites do not need a
 * second branch — every place that showed `question.prompt` before now shows
 * `<Ruby>{question.prompt}</Ruby>` and gets both behaviours.
 */
export function Ruby({ children }: { children?: string | null }) {
  const { show } = React.useContext(FuriganaContext);

  if (!children) return null;
  // Nothing annotated: skip the parse entirely, which is the common case for
  // English prompts and for the kana-only options.
  if (!show) return <>{stripFurigana(children)}</>;

  const segments = parseFurigana(children);
  if (segments.length === 1 && !segments[0].reading) return <>{children}</>;

  return (
    <>
      {segments.map((segment, index) =>
        segment.reading ? (
          <ruby key={index} className="furigana">
            {segment.text}
            <rt>{segment.reading}</rt>
          </ruby>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        )
      )}
    </>
  );
}

/**
 * The toggle itself.
 *
 * Labelled in English, not Japanese: the person who needs this cannot read the
 * Japanese label, which would be a small joke at their expense.
 */
export function FuriganaToggle({ className }: { className?: string }) {
  const { show, setShow } = useFurigana();

  return (
    <button
      type="button"
      onClick={() => setShow(!show)}
      aria-pressed={show}
      title={show ? "Hide the kana readings" : "Show the kana readings above each kanji"}
      className={cn(
        "inline-flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium transition-colors",
        show
          ? "border-primarylw/50 bg-primarylw/10 text-primarylw"
          : "border-border text-muted-foreground hover:text-foreground",
        className
      )}
    >
      <Languages className="h-3.5 w-3.5" />
      Furigana
      <span className="text-xs opacity-70">{show ? "on" : "off"}</span>
    </button>
  );
}
