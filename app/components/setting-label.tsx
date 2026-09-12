import * as React from "react";
import { CircleHelp } from "lucide-react";

import { Tooltip } from "~/components/lightswind/tooltip";

/**
 * A setting's name with a small `?` that explains it on hover, so a settings
 * row can stay one line instead of carrying a paragraph of help text under the
 * control. Used by the study options and the settings page.
 */
export function SettingLabel({ label, hint }: { label: string; hint: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-sm font-medium">
      {label}
      <Tooltip content={hint}>
        <button
          type="button"
          aria-label={`About ${label}`}
          className="inline-flex h-4 w-4 cursor-help items-center justify-center rounded-full text-muted-foreground/70 transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:outline-none"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </Tooltip>
    </span>
  );
}
