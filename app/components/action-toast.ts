import * as React from "react";

import { toast, type ToastVariant } from "~/components/lightswind/toast";

export interface ActionToastMessage {
  title: string;
  description?: string;
  variant?: ToastVariant;
}

/**
 * Fires a Lightswind toast the first time a given React Router action result is
 * observed. The result object identity is used for dedupe, so re-renders never
 * produce duplicate toasts while each new submission gets its own.
 */
export function useActionToast<T extends { ok: boolean; error?: string }>(
  actionData: T | undefined,
  getMessage: (data: T) => ActionToastMessage | null
) {
  const handled = React.useRef<T | undefined>(undefined);
  const getMessageRef = React.useRef(getMessage);
  getMessageRef.current = getMessage;

  React.useEffect(() => {
    if (!actionData || handled.current === actionData) return;
    handled.current = actionData;
    const message = getMessageRef.current(actionData);
    if (message) toast(message);
  }, [actionData]);
}

/** Success toast for `ok` results, error toast otherwise. */
export function okMessage(
  data: { ok: boolean; error?: string },
  success: string | ActionToastMessage
): ActionToastMessage | null {
  if (data.ok) {
    return typeof success === "string" ? { title: success, variant: "success" } : success;
  }
  return data.error ? { title: data.error, variant: "error" } : null;
}
