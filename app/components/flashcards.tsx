import * as React from "react";
import { Link } from "react-router";
import { motion } from "framer-motion";
import { Check, ExternalLink, RotateCcw, Shuffle, X } from "lucide-react";

import type { CardSide, StudyCard } from "~/lib/study-cards";
import { shuffle, studyCardSource } from "~/lib/study-cards";
import { Button } from "~/components/lightswind/button";
import { Badge } from "~/components/lightswind/badge";
import { Tooltip } from "~/components/lightswind/tooltip";
import {
  FRONT_READING_KEY,
  loadPreference,
  REPETITION_KEY,
  savePreference,
} from "~/lib/study-prefs";

// ---------------------------------------------------------------------------
// Per-word study stats (localStorage — works for anonymous visitors too).
// ---------------------------------------------------------------------------

interface WordStat {
  wrong: number;
  correct: number;
  /** Leitner box 0..5 — determines the next review interval. */
  box: number;
  /** Epoch ms when this word is next due for review. */
  dueAt: number;
}

type StatsMap = Record<string, WordStat>;

const STATS_KEY = "jv:study:stats";

/**
 * Spaced repetition (Leitner boxes): each box doubles down on a longer review
 * interval. "Got it" promotes a word to the next box; "Again" sends it back to
 * box 0 (due immediately).
 */
const INTERVALS_MS = [0, 1, 3, 7, 14, 30].map((days) => days * 24 * 60 * 60 * 1000);
const MAX_BOX = INTERVALS_MS.length - 1;

function loadStats(): StatsMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STATS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (parsed && typeof parsed === "object") {
      const out: StatsMap = {};
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (
          value &&
          typeof value === "object" &&
          typeof (value as Partial<WordStat>).wrong === "number" &&
          typeof (value as Partial<WordStat>).correct === "number"
        ) {
          const v = value as Partial<WordStat>;
          // Normalize older stats that predate spaced repetition.
          out[key] = {
            wrong: typeof v.wrong === "number" ? v.wrong : 0,
            correct: typeof v.correct === "number" ? v.correct : 0,
            box: typeof v.box === "number" ? Math.min(Math.max(v.box, 0), MAX_BOX) : 0,
            dueAt: typeof v.dueAt === "number" ? v.dueAt : 0,
          };
        }
      }
      return out;
    }
    return {};
  } catch {
    return {};
  }
}

function saveStats(stats: StatsMap) {
  try {
    window.localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch {
    // Storage unavailable — in-session stats still apply.
  }
}

/** Cards answered "Again" are re-queued this many positions ahead. */
const REQUEUE_DISTANCE = 3;

export function Flashcards({ deck }: { deck: StudyCard[] }) {
  const [repetition, setRepetition] = React.useState(
    () => loadPreference(REPETITION_KEY, "1", ["1", "0"]) === "1"
  );

  /**
   * Whether a card's kana is shown on its question side.
   *
   * Read after the first render, unlike `repetition`: this one decides whether
   * the front carries a line of text, so a preference read during render would
   * make the client's first render disagree *visibly* with the HTML it is
   * hydrating. Only the off-default case pays for that, with one frame of kana.
   */
  const [frontReading, setFrontReading] = React.useState(true);
  React.useEffect(() => {
    setFrontReading(loadPreference(FRONT_READING_KEY, "1", ["1", "0"]) === "1");
  }, []);

  const statsRef = React.useRef<StatsMap>({});
  React.useEffect(() => {
    statsRef.current = loadStats();
  }, []);

  /**
   * Build the session queue (deck indexes). In spaced repetition mode the
   * queue contains only words that are DUE for review (nextDue <= now) plus
   * never-studied words; words scheduled for later are held back.
   *
   * `shuffleOrder` is only set for rebuilds the user asked for. The very first
   * queue is built during render, where a random order would desync the server
   * markup from the hydrated client — and the deck already arrives in random
   * order from the loader, so there is nothing to shuffle anyway.
   */
  const buildQueue = React.useCallback(
    (withRepetition: boolean, shuffleOrder: boolean): number[] => {
      const order = (items: number[]) => (shuffleOrder ? shuffle(items) : items);
      if (!withRepetition) return order(deck.map((_, i) => i));
      const now = Date.now();
      const due: number[] = [];
      const fresh: number[] = [];
      deck.forEach((card, i) => {
        const stat = statsRef.current[card.key];
        if (!stat) fresh.push(i);
        else if (stat.dueAt <= now) due.push(i);
        // else: scheduled for later — skip this session
      });
      return [...order(due), ...order(fresh)];
    },
    [deck]
  );

  const [queue, setQueue] = React.useState<number[]>(() => buildQueue(true, false));
  const [pos, setPos] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [knownCount, setKnownCount] = React.useState(0);
  const [againCount, setAgainCount] = React.useState(0);

  const current = pos < queue.length ? deck[queue[pos]] : undefined;
  const done = !current;

  // Each card leads with a side dealt by the loader, so the first paint after
  // hydration shows exactly what the server rendered — no swap, no mismatch.
  const cardSide: CardSide = current?.side ?? "title";

  /** Cards scheduled for later (not due yet) — only tracked in repetition mode. */
  const scheduledLater =
    repetition
      ? deck.filter((card) => {
          const stat = statsRef.current[card.key];
          return stat && stat.dueAt > Date.now();
        }).length
      : 0;

  const resetSession = (withRepetition: boolean) => {
    setQueue(buildQueue(withRepetition, true));
    setPos(0);
    setFlipped(false);
    setKnownCount(0);
    setAgainCount(0);
  };

  const toggleRepetition = () => {
    const next = !repetition;
    setRepetition(next);
    savePreference(REPETITION_KEY, next ? "1" : "0");
    resetSession(next);
  };

  const answer = React.useCallback(
    (known: boolean) => {
      const index = queue[pos];
      if (index === undefined) return;
      const card = deck[index];

      // Spaced repetition bookkeeping (persisted across sessions).
      const stat = statsRef.current[card.key] ?? {
        wrong: 0,
        correct: 0,
        box: 0,
        dueAt: 0,
      };
      if (known) {
        stat.correct += 1;
        stat.box = Math.min(stat.box + 1, MAX_BOX);
      } else {
        stat.wrong += 1;
        stat.box = 0;
      }
      stat.dueAt = Date.now() + INTERVALS_MS[stat.box];
      statsRef.current[card.key] = stat;
      saveStats(statsRef.current);

      if (known) setKnownCount((c) => c + 1);
      else setAgainCount((c) => c + 1);

      setFlipped(false);

      if (!known && repetition) {
        // Re-queue the card a few positions ahead so it comes back this session.
        setQueue((prev) => {
          const q = [...prev];
          const [item] = q.splice(pos, 1);
          const insertAt = Math.min(pos + REQUEUE_DISTANCE, q.length);
          q.splice(insertAt, 0, item);
          return q;
        });
        return;
      }
      // Next card: it brings its own leading side, so advancing cannot show
      // the previous card's side even for a frame.
      setPos((p) => p + 1);
    },
    [deck, pos, queue, repetition]
  );

  React.useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.code === "Space") {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (event.key === "ArrowRight") {
        answer(true);
      } else if (event.key === "ArrowLeft") {
        answer(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [answer]);

  if (done) {
    return (
      <div>
        <div className="mt-6 flex flex-col items-center gap-6 rounded-[var(--radius)] border border-border p-12 text-center">
          <div className="text-5xl">🎉</div>
          <div>
            <h2 className="text-xl font-semibold">Session complete!</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {knownCount} known · {againCount} needed repetition. Cards you struggle with are
              remembered and will show up more often next time.
            </p>
          </div>
          <Button onClick={() => resetSession(repetition)}>
            <RotateCcw /> Restart
          </Button>
        </div>
      </div>
    );
  }

  const answered = knownCount + againCount;
  const remaining = queue.length - pos;
  const progress = answered + remaining > 0 ? (answered / (answered + remaining)) * 100 : 0;
  const missedBefore = statsRef.current[current.key]?.wrong ?? 0;

  return (
    <div>
      {/*
        The scheduled-for-later count lives in the stats row that is already
        there, and the left side truncates instead of wrapping, so it never
        pushes the card down when it appears.
      */}
      <div className="mb-4 flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span className="min-w-0 truncate">
          {answered} answered · {remaining} to go
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {scheduledLater > 0 && (
            <Tooltip content="They'll return when due">
              <span className="hidden text-xs whitespace-nowrap text-muted-foreground/80 md:inline">
                {scheduledLater} scheduled for later review
              </span>
            </Tooltip>
          )}
          <Badge variant="success">{knownCount} known</Badge>
          <Badge variant="outline" className="text-red-500">
            {againCount} again
          </Badge>
          <button
            type="button"
            className="inline-flex cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted"
            onClick={() => resetSession(repetition)}
          >
            <Shuffle className="h-3.5 w-3.5" /> Restart
          </button>
        </div>
      </div>

      <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primarylw transition-all duration-300"
          style={{ width: `${progress}%` }}
        />
      </div>

      <Flashcard
        key={current.key}
        card={current}
        side={cardSide}
        flipped={flipped}
        missedBefore={missedBefore}
        frontReading={frontReading}
        onFlip={() => setFlipped((f) => !f)}
      />

      <div className="mt-6 flex justify-center gap-3">
        <Button className="flex-1 max-w-56" variant="outline" size="lg" onClick={() => answer(false)}>
          <X className="text-red-500" /> Again <span className="text-xs opacity-50">←</span>
        </Button>
        <Button className="flex-1 max-w-56" size="lg" onClick={() => answer(true)}>
          <Check /> Got it <span className="text-xs opacity-50">→</span>
        </Button>
      </div>
    </div>
  );
}

/** Single 3D flip card. Front/back depend on the chosen side mode. */
function Flashcard({
  card,
  side,
  flipped,
  missedBefore,
  frontReading,
  onFlip,
}: {
  card: StudyCard;
  side: CardSide;
  flipped: boolean;
  missedBefore: number;
  frontReading: boolean;
  onFlip: () => void;
}) {
  /*
    The reading goes on the front only when the front is the Japanese side. A
    meaning-side front is asking for the word, so its kana — and with it the
    kanji — is half the answer, and the flip is what hands that over. The back
    states the card in full either way.
  */
  const front =
    side === "title" ? (
      <>
        <p className="px-4 text-center text-4xl font-bold break-words md:text-6xl">{card.title}</p>
        {frontReading && card.frontKana && (
          <p className="mt-2 text-center text-lg text-muted-foreground">{card.frontKana}</p>
        )}
      </>
    ) : (
      <div className="max-w-md text-center">
        <p className="text-3xl font-bold break-words">{card.meanings[0]}</p>
        {card.meanings.length > 1 && (
          <p className="mt-3 text-sm text-muted-foreground">
            + {card.meanings.length - 1} more meaning{card.meanings.length === 2 ? "" : "s"}
          </p>
        )}
      </div>
    );

  const back = (
    <div className="flex flex-col items-center justify-center gap-3 text-center">
      {side === "title" ? (
        <>
          <p className="max-w-md text-center text-lg leading-relaxed">
            {card.meanings.join(", ")}
          </p>
          {card.reading && (
            <p className="text-lg text-muted-foreground">{card.reading}</p>
          )}
        </>
      ) : (
        <>
          <p className="text-4xl font-bold break-words md:text-5xl">{card.title}</p>
          {card.reading && (
            <p className="text-lg text-muted-foreground">{card.reading}</p>
          )}
        </>
      )}
      {card.examples.length > 0 && (
        <p className="mt-1 text-sm text-muted-foreground">
          {card.examples[0].japanese}
          {card.examples[0].translation ? ` (${card.examples[0].translation})` : ""}
        </p>
      )}
      {missedBefore > 0 && (
        <p className="text-xs text-amber-500/90">
          Missed {missedBefore} time{missedBefore === 1 ? "" : "s"} before. Keep at it!
        </p>
      )}
    </div>
  );

  // A link to the full word/rule page, opened in a new tab so the session keeps
  // its place. This is where the part of speech (and rule context) now lives.
  const source = studyCardSource(card);
  const sourceHref =
    source === null ? null : source.kind === "rule" ? `/rules/${source.id}` : `/words/${source.id}`;
  const sourceLabel = source?.kind === "rule" ? "Open rule page" : "Open word page";

  return (
    <div className="perspective-1000 mx-auto w-full max-w-xl">
      <motion.button
        type="button"
        className="transform-style-3d relative block h-72 w-full cursor-pointer text-left"
        onClick={onFlip}
        initial={false}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: [0.4, 0.2, 0.2, 1] }}
        aria-label={flipped ? "Show question side" : "Reveal answer"}
      >
        <div
          data-slot="flashcard-front"
          className="backface-hidden absolute inset-0 flex flex-col items-center justify-center overflow-y-auto rounded-[var(--radius)] border border-border bg-card p-6 shadow-sm"
        >
          {front}
          <p className="mt-4 text-xs tracking-widest text-muted-foreground uppercase">
            {side === "title"
              ? "Click or press Space to reveal"
              : "Guess the answer, then click to check"}
          </p>
        </div>
        <div
          data-slot="flashcard-back"
          className="backface-hidden rotate-y-180 absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-y-auto rounded-[var(--radius)] border border-primarylw/40 bg-card p-6 shadow-sm"
        >
          {back}
        </div>
      </motion.button>
      {sourceHref ? (
        <div className="mt-3 text-center">
          <Link
            to={sourceHref}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primarylw"
          >
            <ExternalLink className="h-3.5 w-3.5" /> {sourceLabel}
          </Link>
        </div>
      ) : null}
    </div>
  );
}